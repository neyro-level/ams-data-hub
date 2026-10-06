export {
  MAX_MEDIA_BYTES,
  MEDIA_CONTENT_TYPES,
  inventoryMediaProjectionInputSchema,
  type InventoryMediaProjectionInput,
  type InventoryMediaProjectionResult,
  mediaIntakeInputSchema,
  mediaMirrorBatchInputSchema,
  mediaRightsBasisSchema,
  mediaSourceKindSchema,
  type MediaAssetRecord,
  type MediaIntakeInput,
  type MediaIntakeResult,
  type MediaMirrorBatchInput,
  type MediaMirrorBatchResult,
  type MediaMirrorItemResult,
  type MediaRightsBasis,
  type MediaSourceKind,
} from "./contracts.ts";
export {
  canonicalizeMediaSourceUrl,
  isMirroredMediaPubliclyPublishable,
  type AgentMediaPublicationState,
} from "./domain/media-source.ts";
