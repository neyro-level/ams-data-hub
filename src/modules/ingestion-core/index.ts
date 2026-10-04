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
