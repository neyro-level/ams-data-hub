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
