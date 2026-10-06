import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { calculateObjectSha256, createMediaKey, type ObjectStorage, type BoundedObjectStorage } from "../../../platform/storage/object-storage.ts";
import { inventoryPublicMediaReadInputSchema, MAX_MEDIA_BYTES, MEDIA_CONTENT_TYPES,
  type InventoryPublicMediaReadInput, type InventoryPublicMediaObject, type InventoryMediaProjectionInput, type InventoryMediaProjectionResult } from "../contracts.ts";
import { assertDecodedImage } from "../domain/media-image-validation.ts";

export interface MediaPublicReadDependencies {
  storage: ObjectStorage & Partial<BoundedObjectStorage>;
  projectMedia(principal: PrincipalContext, input: InventoryMediaProjectionInput): Promise<InventoryMediaProjectionResult>;
}

/** Internal authorized read, not a browser route or provider enablement. */
export function createInventoryPublicMediaReadService(dependencies: MediaPublicReadDependencies) {
  return async function readInventoryPublicMedia(principal: PrincipalContext, rawInput: InventoryPublicMediaReadInput,
    options: { signal?: AbortSignal } = {}): Promise<InventoryPublicMediaObject> {
    const { ref, position, ...scope } = inventoryPublicMediaReadInputSchema.parse(rawInput);
    const permitted = async () => (await dependencies.projectMedia(principal, scope)).media.some((item) => item.ref === ref && item.position === position);
    if (!await permitted()) throw new Error("MEDIA_PUBLIC_OBJECT_NOT_FOUND");
    if (options.signal?.aborted) throw new Error("MEDIA_PUBLIC_OBJECT_UNAVAILABLE");
    if (typeof dependencies.storage.getBounded !== "function") throw new Error("MEDIA_BOUNDED_STORAGE_REQUIRED");
    let object;
    try { object = await dependencies.storage.getBounded({ key: createMediaKey(ref), maxBytes: MAX_MEDIA_BYTES,
      ...(options.signal ? { signal: options.signal } : {}) }); }
    catch { throw new Error("MEDIA_PUBLIC_OBJECT_UNAVAILABLE"); }
    if (!object || object.key !== createMediaKey(ref) || object.sha256 !== ref || object.body.byteLength === 0
      || object.body.byteLength > MAX_MEDIA_BYTES || object.contentLength !== object.body.byteLength
      || !MEDIA_CONTENT_TYPES.some((type) => type === object.contentType) || calculateObjectSha256(object.body) !== ref) {
      throw new Error("MEDIA_PUBLIC_OBJECT_UNAVAILABLE");
    }
    try { await assertDecodedImage(object.contentType, object.body); }
    catch { throw new Error("MEDIA_PUBLIC_OBJECT_UNAVAILABLE"); }
    if (!await permitted()) throw new Error("MEDIA_PUBLIC_OBJECT_STALE");
    return { ref, contentType: object.contentType, body: object.body };
  };
}
