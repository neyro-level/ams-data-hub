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
export {
  extractSourceObjectCode,
  matchesConfiguredPattern,
  normalizeProfileToken,
  resolveProfileAlias,
  type ProfileAlias,
  type ProfileDealKind,
  type ProfileLocationPrecision,
  type ProfilePropertyType,
  type ProfileTransactionType,
  type SourceFieldMapping,
  type SourceObjectCodeExtraction,
  type SourceProfileConfiguration,
} from "./domain/source-profile.ts";
export {
  resolveVladisDealKind,
  resolveVladisTransaction,
  vladisVt24Configuration,
  vladisVt24Profile,
} from "./domain/profiles/vladis-vt24-v1.ts";
export { SourceRegistryError } from "./domain/source-registry-error.ts";
export { isSourceEligibleForAutomaticRun } from "./domain/source-schedule.ts";
