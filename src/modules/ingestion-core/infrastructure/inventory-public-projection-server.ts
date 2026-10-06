import "server-only";
import type { ObjectStorage } from "../../../platform/storage/object-storage.ts";
import { createMediaAssetsServer } from "../../media-assets/server.ts";
import { createInventoryPublicProjectionService } from "../application/inventory-public-projection.ts";

export function createInventoryPublicProjectionServer(storage: ObjectStorage) {
  return createInventoryPublicProjectionService({ projectMedia: createMediaAssetsServer(storage).projectInventoryMedia });
}
