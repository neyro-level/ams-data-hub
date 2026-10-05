import type { PrincipalContext, ProjectJobPrincipal } from "../../../platform/authorization/principal.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  calculateObjectSha256,
  createMediaKey,
  type ObjectStorage,
} from "../../../platform/storage/object-storage.ts";
import {
  MAX_MEDIA_BYTES,
  MEDIA_CONTENT_TYPES,
  mediaMirrorBatchInputSchema,
  type MediaMirrorBatchInput,
  type MediaMirrorBatchResult,
} from "../contracts.ts";
import {
  canonicalizeMediaSourceUrl,
  isMirroredMediaPubliclyPublishable,
} from "../domain/media-source.ts";
import { assertDecodedImage } from "../domain/media-image-validation.ts";
import type { MediaMirrorRepository } from "./ports/media-mirror-repository.ts";

export interface MediaMirrorDependencies {
  storage: ObjectStorage;
  fetchMedia(url: string, policy: {
    purpose: "media";
    allowedContentTypes: readonly string[];
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
  }): Promise<{ status: number; contentType: string; body: Uint8Array; finalUrl: URL }>;
  runInTransaction<TResult>(principal: PrincipalContext, execute: (transaction: DatabaseTransaction) => Promise<TResult>): Promise<TResult>;
  createRepository(transaction: DatabaseTransaction): MediaMirrorRepository;
}

function requireScopedProjectJob(principal: PrincipalContext, input: { organizationId: string; projectId: string }): ProjectJobPrincipal {
  if (principal.kind !== "project-job" || principal.organizationId !== input.organizationId || principal.projectId !== input.projectId) {
    throw new Error("MEDIA_MIRROR_PROJECT_JOB_REQUIRED");
  }
  return principal;
}

function warningCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return `OUTBOUND_${error.code}`.slice(0, 80);
  }
  if (error instanceof Error && /^MEDIA_[A-Z_]+$/u.test(error.message)) return error.message;
  return "MEDIA_MIRROR_FAILED";
}

function originalFileName(url: URL): string {
  const candidate = decodeURIComponent(url.pathname.split("/").pop() || "remote-image").trim();
  return candidate.slice(0, 255) || "remote-image";
}

export function createMediaMirrorService(dependencies: MediaMirrorDependencies) {
  return async function mirrorMediaBatch(principal: PrincipalContext, rawInput: MediaMirrorBatchInput): Promise<MediaMirrorBatchResult> {
    const input = mediaMirrorBatchInputSchema.parse(rawInput);
    const job = requireScopedProjectJob(principal, input);
    const scope = {
      organizationId: input.organizationId,
      projectId: input.projectId,
      sourceId: input.sourceId,
      sourceRevisionId: input.sourceRevisionId,
      observedAt: new Date(input.observedAt),
    };
    const exists = await dependencies.runInTransaction(principal, (transaction) => dependencies.createRepository(transaction).scopeExists(scope));
    if (!exists) throw new Error("MEDIA_MIRROR_SOURCE_NOT_FOUND");

    const results = [];
    for (const item of input.items) {
      const canonicalSourceUrl = canonicalizeMediaSourceUrl(item.sourceUrl);
      const common = { ...scope, ...item, canonicalSourceUrl };
      try {
        const fetched = await dependencies.fetchMedia(item.sourceUrl, {
          purpose: "media",
          allowedContentTypes: MEDIA_CONTENT_TYPES,
          maxBytes: MAX_MEDIA_BYTES,
          maxRedirects: 3,
          timeoutMs: 10_000,
        });
        await assertDecodedImage(fetched.contentType, fetched.body);
        const sha256 = calculateObjectSha256(fetched.body);
        const storageKey = createMediaKey(sha256);
        if (!await dependencies.storage.head(storageKey)) {
          await dependencies.storage.put({ key: storageKey, body: fetched.body, contentType: fetched.contentType, sha256 });
        }
        const persisted = await dependencies.runInTransaction(principal, (transaction) => dependencies.createRepository(transaction).persistMirrored({
          ...common,
          sha256,
          storageKey,
          contentType: fetched.contentType.split(";", 1)[0]!.trim().toLowerCase(),
          byteSize: fetched.body.byteLength,
          originalFileName: originalFileName(fetched.finalUrl),
          license: item.license ?? null,
          uploadedBy: job.jobName,
        }));
        results.push({
          canonicalSourceUrl,
          entityType: item.entityType,
          entityUid: item.entityUid,
          kind: item.kind,
          position: item.position,
          status: "MIRRORED" as const,
          warningCode: null,
          assetId: persisted.assetId,
          publiclyPublishable: isMirroredMediaPubliclyPublishable(item.kind, persisted.agent),
        });
      } catch (error) {
        const code = warningCode(error);
        const persisted = await dependencies.runInTransaction(principal, (transaction) => dependencies.createRepository(transaction).persistWarning({
          ...common,
          warningCode: code,
        }));
        results.push({
          canonicalSourceUrl,
          entityType: item.entityType,
          entityUid: item.entityUid,
          kind: item.kind,
          position: item.position,
          status: "WARNING" as const,
          warningCode: code,
          assetId: persisted.assetId,
          publiclyPublishable: Boolean(persisted.assetId) && isMirroredMediaPubliclyPublishable(item.kind, persisted.agent),
        });
      }
    }
    return {
      importStatus: "UNCHANGED",
      mediaStatus: results.some((item) => item.status === "WARNING") ? "WARNING" : "COMPLETE",
      items: results,
    };
  };
}
