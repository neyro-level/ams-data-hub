import type { SourceDatasetType, SourceTransportType } from "../contracts.ts";
import { SourceRegistryError } from "./source-registry-error.ts";

export type SourceAdapterCapability =
  | "XML_STREAMING"
  | "XML_NAMESPACES"
  | "RAW_ATTRIBUTES";

export interface SourceAdapterDescriptor {
  key: string;
  version: string;
  capabilities: readonly SourceAdapterCapability[];
  datasetTypes: readonly SourceDatasetType[];
  transportTypes: readonly SourceTransportType[];
}

export interface SourceProfileDescriptor {
  key: string;
  version: string;
  compatibleAdapters: readonly {
    key: string;
    versions: readonly string[];
  }[];
  requiredCapabilities: readonly SourceAdapterCapability[];
  datasetTypes: readonly SourceDatasetType[];
}

export interface SourceDescriptorSelection {
  adapterKey: string;
  adapterVersion: string;
  profileKey: string;
  profileVersion: string;
  datasetType: SourceDatasetType;
  transportType: SourceTransportType;
}

export interface AdapterProfileRegistry {
  getAdapter(key: string, version: string): SourceAdapterDescriptor;
  getProfile(key: string, version: string): SourceProfileDescriptor;
  assertCompatible(selection: SourceDescriptorSelection): {
    adapter: SourceAdapterDescriptor;
    profile: SourceProfileDescriptor;
  };
}

function descriptorIdentity(key: string, version: string): string {
  return `${key}@${version}`;
}

function descriptorMap<T extends { key: string; version: string }>(descriptors: readonly T[]): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const descriptor of descriptors) {
    const identity = descriptorIdentity(descriptor.key, descriptor.version);
    if (result.has(identity)) {
      throw new SourceRegistryError("SOURCE_REGISTRY_DESCRIPTOR_DUPLICATE");
    }
    result.set(identity, descriptor);
  }
  return result;
}

export function createAdapterProfileRegistry(input: {
  adapters: readonly SourceAdapterDescriptor[];
  profiles: readonly SourceProfileDescriptor[];
}): AdapterProfileRegistry {
  const adapters = descriptorMap(input.adapters);
  const profiles = descriptorMap(input.profiles);

  const getAdapter = (key: string, version: string) => {
    const descriptor = adapters.get(descriptorIdentity(key, version));
    if (!descriptor) throw new SourceRegistryError("SOURCE_REGISTRY_ADAPTER_UNKNOWN");
    return descriptor;
  };

  const getProfile = (key: string, version: string) => {
    const descriptor = profiles.get(descriptorIdentity(key, version));
    if (!descriptor) throw new SourceRegistryError("SOURCE_REGISTRY_PROFILE_UNKNOWN");
    return descriptor;
  };

  return Object.freeze({
    getAdapter,
    getProfile,
    assertCompatible(selection: SourceDescriptorSelection) {
      const adapter = getAdapter(selection.adapterKey, selection.adapterVersion);
      const profile = getProfile(selection.profileKey, selection.profileVersion);
      const adapterMatch = profile.compatibleAdapters.some(
        (candidate) => candidate.key === adapter.key && candidate.versions.includes(adapter.version),
      );
      const hasCapabilities = profile.requiredCapabilities.every((capability) =>
        adapter.capabilities.includes(capability),
      );
      const supportsDataset =
        adapter.datasetTypes.includes(selection.datasetType) && profile.datasetTypes.includes(selection.datasetType);
      const supportsTransport = adapter.transportTypes.includes(selection.transportType);

      if (!adapterMatch || !hasCapabilities || !supportsDataset || !supportsTransport) {
        throw new SourceRegistryError("SOURCE_REGISTRY_PROFILE_INCOMPATIBLE");
      }
      return { adapter, profile };
    },
  });
}

const yrlRealty2010Adapter = Object.freeze<SourceAdapterDescriptor>({
  key: "yrl-realty-2010",
  version: "1.0.0",
  capabilities: Object.freeze(["XML_STREAMING", "XML_NAMESPACES", "RAW_ATTRIBUTES"]),
  datasetTypes: Object.freeze(["MIXED_REALTY", "RESALE", "NEW_BUILD", "HOUSE", "LAND", "COMMERCIAL", "AGENT"]),
  transportTypes: Object.freeze(["HTTPS_XML"]),
});

const defaultRealtyProfile = Object.freeze<SourceProfileDescriptor>({
  key: "default-v1",
  version: "1.0.0",
  compatibleAdapters: Object.freeze([
    Object.freeze({ key: "yrl-realty-2010", versions: Object.freeze(["1.0.0"]) }),
  ]),
  requiredCapabilities: Object.freeze(["XML_STREAMING", "XML_NAMESPACES"]),
  datasetTypes: Object.freeze(["MIXED_REALTY", "RESALE", "NEW_BUILD", "HOUSE", "LAND", "COMMERCIAL", "AGENT"]),
});

export const adapterProfileRegistry = createAdapterProfileRegistry({
  adapters: [yrlRealty2010Adapter],
  profiles: [defaultRealtyProfile],
});
