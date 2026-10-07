import { z } from "zod";
import { createMediaKey, type ObjectStorageObject } from "../../../platform/storage/object-storage.ts";
import { MAX_MEDIA_BYTES, MEDIA_CONTENT_TYPES, mediaRightsBasisSchema } from "../contracts.ts";

export const capturedMediaAssetSchema = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  storageKey: z.string().max(100), contentType: z.enum(MEDIA_CONTENT_TYPES),
  byteSize: z.number().int().positive().max(MAX_MEDIA_BYTES), rightsBasis: mediaRightsBasisSchema,
  hasLicense: z.boolean() }).strict().refine((asset) => /^[a-f0-9]{64}$/u.test(asset.sha256) && asset.storageKey === createMediaKey(asset.sha256)
    && (asset.rightsBasis !== "LICENSED" || asset.hasLicense));
export type CapturedMediaAsset = z.infer<typeof capturedMediaAssetSchema>;
export function matchesMediaObject(asset: CapturedMediaAsset, object: ObjectStorageObject | null | undefined): boolean {
  return Boolean(object && object.key === asset.storageKey && object.sha256 === asset.sha256
    && object.contentLength === asset.byteSize && object.contentType === asset.contentType);
}
