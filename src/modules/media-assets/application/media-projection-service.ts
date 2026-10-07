import { mediaPublicV1Schema } from "@ams-data-hub/realty-contracts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { type ObjectStorage, type ObjectStorageObject } from "../../../platform/storage/object-storage.ts";
import { inventoryMediaProjectionInputSchema,
  type InventoryMediaProjectionInput, type InventoryMediaProjectionResult } from "../contracts.ts";
import { canonicalizeMediaSourceUrl } from "../domain/media-source.ts";
import type { MediaProjectionRepository } from "./ports/media-projection-repository.ts";
import { capturedMediaAssetSchema, matchesMediaObject } from "./media-object-verification.ts";

export interface MediaProjectionDependencies {
  storage: Pick<ObjectStorage, "head">;
  runInTransaction<T>(principal: PrincipalContext, execute: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>;
  createRepository(transaction: DatabaseTransaction): MediaProjectionRepository;
}

export function createInventoryMediaProjectionService(dependencies: MediaProjectionDependencies) {
  return async function projectInventoryMedia(principal: PrincipalContext,
    rawInput: InventoryMediaProjectionInput): Promise<InventoryMediaProjectionResult> {
    const input = inventoryMediaProjectionInputSchema.parse(rawInput);
    if (principal.kind !== "platform-admin" && !(principal.kind === "project-job"
      && principal.organizationId === input.organizationId && principal.projectId === input.projectId)) {
      throw new Error("MEDIA_PROJECTION_PROJECT_SCOPE_REQUIRED");
    }
    const reader = principal.kind === "platform-admin" ? principal : createProjectJobPrincipal({
      organizationId: input.organizationId, projectId: input.projectId, jobName: "media-projection",
    });
    const load = () => dependencies.runInTransaction(reader, (tx) => dependencies.createRepository(tx).loadInventory(input));
    const state = await load();
    if (!state) throw new Error("MEDIA_PROJECTION_REVISION_NOT_FOUND");
    const result: InventoryMediaProjectionResult = { media: [], warnings: [] };
    const media = [...result.media];
    const warnings = [...result.warnings];
    let images: { canonicalSourceUrl: string; position: number }[];
    try {
      images = state.images.map((image) => ({ position: image.position, canonicalSourceUrl: canonicalizeMediaSourceUrl(image.sourceUrl) }));
    } catch { throw new Error("MEDIA_PROJECTION_FACT_INVALID"); }
    const relations = new Map<string, typeof state.relations[number][]>();
    for (const relation of state.relations) {
      relations.set(relation.canonicalSourceUrl, [...(relations.get(relation.canonicalSourceUrl) ?? []), relation]);
    }
    const objects = new Map<string, ObjectStorageObject | null>();
    // Sequential bounded HEAD calls, outside every database transaction.
    // The immutable record owns order. MediaSource is unique per canonical URL,
    // so one mirror can appear at several producer positions without data loss.
    for (const image of images) {
      const candidates = relations.get(image.canonicalSourceUrl) ?? [];
      if (candidates.length !== 1) {
        warnings.push(candidates.length ? "MEDIA_ASSET_INVALID" : "MEDIA_MIRROR_UNAVAILABLE"); continue;
      }
      const relation = candidates[0]!;
      if (relation.status === "WARNING") warnings.push("MEDIA_MIRROR_WARNING");
      const asset = relation.asset;
      if (relation.status === "WARNING" && !asset) continue;
      const captured = asset ? capturedMediaAssetSchema.safeParse({ sha256: asset.sha256, storageKey: asset.storageKey,
        contentType: asset.contentType, byteSize: asset.byteSize, rightsBasis: asset.rightsBasis, hasLicense: Boolean(asset.license?.trim()) }) : null;
      if (!asset || !relation.mirroredAt || asset.organizationId !== input.organizationId || asset.projectId !== input.projectId
        || !captured?.success) {
        warnings.push("MEDIA_ASSET_INVALID"); continue;
      }
      try {
        if (!objects.has(asset.storageKey)) objects.set(asset.storageKey, await dependencies.storage.head(asset.storageKey));
        const object = objects.get(asset.storageKey);
        if (!matchesMediaObject(captured.data, object)) {
          warnings.push("MEDIA_OBJECT_UNAVAILABLE"); continue;
        }
        media.push(mediaPublicV1Schema.parse({ ref: asset.sha256, kind: "IMAGE", position: image.position }));
      } catch {
        objects.set(asset.storageKey, null);
        warnings.push("MEDIA_OBJECT_UNAVAILABLE");
      }
    }
    // No mixed revision or relation state if an import/mirror changed during IO.
    const current = await load();
    if (!current || JSON.stringify(current) !== JSON.stringify(state)) throw new Error("MEDIA_PROJECTION_STALE");
    return { media, warnings };
  };
}
