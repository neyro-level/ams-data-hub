export * from "./contracts.ts";
export {
  adapterProfileRegistry,
  createAdapterProfileRegistry,
  type AdapterProfileRegistry,
  type SourceAdapterCapability,
  type SourceAdapterDescriptor,
  type SourceDescriptorSelection,
  type SourceProfileDescriptor,
} from "./domain/adapter-profile-registry.ts";
export { SourceRegistryError } from "./domain/source-registry-error.ts";
export { isSourceEligibleForAutomaticRun } from "./domain/source-schedule.ts";
export {
  reconcileMissingInventory,
  reconcileSeenInventory,
  type InventoryIdentityState,
  type InventoryLifecycleDecision,
  type InventoryLifecycleEventType,
  type InventoryLifecyclePolicy,
  type InventoryLifecycleStatus,
  type InventoryMissingRunContext,
  type InventorySeenInput,
} from "./domain/inventory-lifecycle.ts";
export {
  normalizeArea,
  normalizeCadastralNumber,
  normalizeDescription,
  normalizeHeight,
  normalizePhone,
  normalizeTimestamp,
  sparseValue,
  toPublicInventoryDto,
  type CadastralNormalizationResult,
  type PhoneNormalizationResult,
  type TimestampNormalizationResult,
  type UnitNormalizationResult,
} from "./domain/canonical-inventory.ts";
export {
  DEFAULT_YRL_PARSER_LIMITS,
  parseYrl2010,
  YrlParserError,
  type YrlParserErrorCode,
  type YrlParserLimits,
  type YrlParserOptions,
  type YrlRawAttribute,
  type YrlRawElement,
  type YrlRawOffer,
} from "./domain/yrl-2010-parser.ts";
