import "server-only";
import { ulidSchema } from "@ams-data-hub/data-contracts";
import { mediaPublicV1Schema, type MediaPublicV1 } from "@ams-data-hub/realty-contracts";
import { z } from "zod";
import type { ObjectStorage, ObjectStorageObject } from "../../../platform/storage/object-storage.ts";
import { capturedMediaAssetSchema, matchesMediaObject, type CapturedMediaAsset } from "./media-object-verification.ts";

export const capturedMediaOwnerSchema = z.enum(["INVENTORY", "AGENT", "DEVELOPMENT", "BUILDING"]);
export interface CapturedMediaCandidate {
  entityType: z.infer<typeof capturedMediaOwnerSchema>; entityUid: string; position: number;
  asset: unknown; warning?: "MEDIA_MIRROR_WARNING" | "MEDIA_MIRROR_UNAVAILABLE" | "MEDIA_ASSET_UNAVAILABLE" | "MEDIA_KIND_UNSUPPORTED";
}
export interface VerifiedCapturedMediaAttachment {
  entityType: CapturedMediaCandidate["entityType"]; entityUid: string; media: MediaPublicV1;
}
export interface CapturedMediaVerificationResult {
  attachments: VerifiedCapturedMediaAttachment[];
  diagnostics: { entityType: CapturedMediaCandidate["entityType"]; entityUid: string; position: number;
    code: "MEDIA_MIRROR_WARNING" | "MEDIA_MIRROR_UNAVAILABLE" | "MEDIA_ASSET_UNAVAILABLE" | "MEDIA_ASSET_INVALID"
      | "MEDIA_OBJECT_UNAVAILABLE" | "MEDIA_RELATION_AMBIGUOUS" | "MEDIA_KIND_UNSUPPORTED" }[];
}
const scopeSchema = z.object({ organizationId: z.string().min(1).max(128), projectId: z.string().min(1).max(128) }).strict();
/** Server-owned bound storage, never a request-supplied provider or capability. No DB calls here. */
export function createCapturedMediaVerifier(bound: { organizationId: string; projectId: string; storage: Pick<ObjectStorage, "head">; signal?: AbortSignal }) {
  const scope = scopeSchema.parse({ organizationId: bound.organizationId, projectId: bound.projectId });
  const head = bound.storage.head.bind(bound.storage);
  const checkSignal = () => { if (bound.signal?.aborted) throw new Error("SNAPSHOT_PUBLICATION_CANCELLED"); };
  return async (requested: typeof scope, raw: readonly CapturedMediaCandidate[]): Promise<CapturedMediaVerificationResult> => {
    if (requested.organizationId !== scope.organizationId || requested.projectId !== scope.projectId) throw new Error("SNAPSHOT_MEDIA_SCOPE_INVALID");
    checkSignal();
    if (raw.length > 50_000) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
    const keys = new Map<string, CapturedMediaAsset>(); const positions = new Map<string, number>();
    // Complete pin/metadata preflight before the first HEAD. Copies prevent mutation during IO.
    const candidates = raw.map((item) => {
      const entityType = capturedMediaOwnerSchema.parse(item.entityType); const entityUid = ulidSchema.parse(item.entityUid);
      const position = z.number().int().min(0).max(10_000).parse(item.position);
      const warning = z.enum(["MEDIA_MIRROR_WARNING", "MEDIA_MIRROR_UNAVAILABLE", "MEDIA_ASSET_UNAVAILABLE", "MEDIA_KIND_UNSUPPORTED"]).optional().parse(item.warning);
      const parsed = capturedMediaAssetSchema.safeParse(item.asset);
      const asset = parsed.success && (!warning || warning === "MEDIA_MIRROR_WARNING") ? parsed.data : null;
      if (asset) {
        const previous = keys.get(asset.storageKey);
        if (previous && JSON.stringify(previous) !== JSON.stringify(asset)) throw new Error("SNAPSHOT_MEDIA_ASSET_CONFLICT");
        keys.set(asset.storageKey, asset);
      }
      const identity = `${entityType}/${entityUid}/${position}`;
      positions.set(identity, (positions.get(identity) ?? 0) + 1);
      return { entityType, entityUid, position, warning, asset, identity };
    });
    const result: CapturedMediaVerificationResult = { attachments: [], diagnostics: [] };
    const objects = new Map<string, ObjectStorageObject | null>();
    for (const candidate of candidates.sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0)) {
      const { entityType, entityUid, position, asset, warning } = candidate;
      const report = (code: CapturedMediaVerificationResult["diagnostics"][number]["code"]) => result.diagnostics.push({ entityType, entityUid, position, code });
      if (positions.get(candidate.identity)! > 1) { report("MEDIA_RELATION_AMBIGUOUS"); continue; }
      if (warning) report(warning);
      if (!asset) { if (!warning) report("MEDIA_ASSET_INVALID"); continue; }
      if (!objects.has(asset.storageKey)) {
        checkSignal();
        try {
          const object = bound.signal ? await head(asset.storageKey, { signal: bound.signal }) : await head(asset.storageKey);
          checkSignal(); objects.set(asset.storageKey, object ? { ...object } : null);
        } catch { checkSignal(); objects.set(asset.storageKey, null); }
      }
      if (!matchesMediaObject(asset, objects.get(asset.storageKey))) { report("MEDIA_OBJECT_UNAVAILABLE"); continue; }
      result.attachments.push({ entityType, entityUid, media: mediaPublicV1Schema.parse({ ref: asset.sha256, kind: "IMAGE", position }) });
    }
    checkSignal(); return result;
  };
}
