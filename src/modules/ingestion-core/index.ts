export * from "./contracts.ts";
export { prepareSnapshotPublicationSourceAnchors, type SnapshotPublicationSourceAnchors } from "./application/snapshot-publication-source-anchors.ts";
export { MAX_SOURCE_INTAKE_LIMITS, resolveSourceIntakeLimits, type SourceIntakeLimits } from "./domain/source-intake-policy.ts";
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
  type SourceFormatContract,
} from "./domain/source-profile.ts";
export {
  joyworkAvitoProfile,
  joyworkCianProfile,
  joyworkDomclickProfile,
  joyworkMarketplaceProfiles,
  joyworkYandexRealtyProfile,
} from "./domain/profiles/joywork-marketplace-profiles.ts";
export {
  resolveVladisDealKind,
  resolveVladisTransaction,
  vladisVt24Configuration,
  vladisVt24Profile,
} from "./domain/profiles/vladis-vt24-v1.ts";
export {
  extractVladisAgentEvidence,
  type ExtractedAgentEvidence,
} from "./domain/profiles/vladis-agent-extraction.ts";
export { SourceRegistryError } from "./domain/source-registry-error.ts";
export { isSourceEligibleForAutomaticRun } from "./domain/source-schedule.ts";
export {
  analyzeImportSafety,
  assertSafetyApprovalEvidence,
  BOOTSTRAP_SOURCE_SAFETY_POLICY,
  importIssueSchema,
  importIssueSeveritySchema,
  reviewSuspiciousImport,
  type ImportIssue,
  type SafetyAnalysisResult,
  type SafetyDisposition,
  type SourceSafetyPolicy,
} from "./domain/safety-engine.ts";
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
export {
  DEFAULT_MARKETPLACE_XML_LIMITS,
  MarketplaceXmlError,
  parseMarketplaceXmlRecords,
  type MarketplaceXmlErrorCode,
  type MarketplaceXmlLimits,
  type MarketplaceXmlParserOptions,
  type MarketplaceXmlRecord,
} from "./domain/marketplace-xml-parser.ts";
export {
  canonicalSourceObjectKey,
  findDuplicateExternalIds,
  normalizeMarketplaceRecord,
  parseAvitoV3Feed,
  parseCianV2Feed,
  parseDomclickYrlFeed,
  parseJoyworkYandexFeed,
  type CanonicalFeedDraft,
  type FeedNormalizationIssue,
  type FeedNormalizationResult,
  type MarketplaceFeedFormat,
} from "./domain/marketplace-feed-adapters.ts";
