import type { PrincipalContext, PlatformAdminPrincipal } from "../../../platform/authorization/principal.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  calculateObjectSha256,
  createMediaKey,
  type ObjectStorage,
} from "../../../platform/storage/object-storage.ts";
import {
  mediaIntakeInputSchema,
  type MediaIntakeInput,
  type MediaIntakeResult,
} from "../contracts.ts";
import { MediaAssetError } from "../domain/media-asset-error.ts";
import type { MediaAssetRepository } from "./ports/media-asset-repository.ts";

export interface MediaIntakeDependencies {
  storage: ObjectStorage;
  runInTransaction<TResult>(
    principal: PrincipalContext,
    execute: (transaction: DatabaseTransaction) => Promise<TResult>,
  ): Promise<TResult>;
  createRepository(transaction: DatabaseTransaction): MediaAssetRepository;
}

function requireMediaAdmin(principal: PrincipalContext): PlatformAdminPrincipal {
  if (principal.kind !== "platform-admin") {
    throw new MediaAssetError("MEDIA_ADMIN_ACCESS_DENIED");
  }
  return principal;
}

export function createMediaIntakeService(dependencies: MediaIntakeDependencies) {
  return async function intakeMedia(
    principal: PrincipalContext,
    rawInput: MediaIntakeInput,
  ): Promise<MediaIntakeResult> {
    const actor = requireMediaAdmin(principal);
    const input = mediaIntakeInputSchema.parse(rawInput);
    const sha256 = calculateObjectSha256(input.body);

    const existing = await dependencies.runInTransaction(principal, async (transaction) => {
      const repository = dependencies.createRepository(transaction);
      if (!await repository.projectExists(input.organizationId, input.projectId)) {
        throw new MediaAssetError("MEDIA_PROJECT_NOT_FOUND");
      }
      return repository.findByDigest(input.projectId, sha256);
    });
    if (existing) return { asset: existing, deduplicated: true };

    const storageKey = createMediaKey(sha256);
    if (!await dependencies.storage.head(storageKey)) {
      await dependencies.storage.put({
        key: storageKey,
        body: input.body,
        contentType: input.contentType,
        sha256,
      });
    }

    const metadata = {
      organizationId: input.organizationId,
      projectId: input.projectId,
      contentType: input.contentType,
      originalFileName: input.originalFileName,
      rightsBasis: input.rightsBasis,
      source: input.source,
      license: input.license,
    };
    const asset = await dependencies.runInTransaction(principal, async (transaction) => {
      const repository = dependencies.createRepository(transaction);
      const persisted = await repository.upsert({
        ...metadata,
        sha256,
        storageKey,
        byteSize: input.body.byteLength,
        uploadedBy: actor.userId,
      });
      await repository.appendAudit({
        actorId: actor.userId,
        organizationId: input.organizationId,
        assetId: persisted.id,
        projectId: input.projectId,
        sha256,
        correlationId: actor.correlationId,
      });
      return persisted;
    });

    return { asset, deduplicated: false };
  };
}
