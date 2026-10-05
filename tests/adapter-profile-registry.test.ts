import { describe, expect, it } from "vitest";
import {
  adapterProfileRegistry,
  createAdapterProfileRegistry,
  SourceRegistryError,
  type SourceAdapterDescriptor,
  type SourceProfileDescriptor,
} from "../src/modules/ingestion-core/index.ts";

const selection = {
  adapterKey: "yrl-realty-2010",
  adapterVersion: "1.0.0",
  profileKey: "default-v1",
  profileVersion: "1.0.0",
  datasetType: "MIXED_REALTY" as const,
  transportType: "HTTPS_XML" as const,
};

describe("adapter/profile registry", () => {
  it("resolves a registered compatible selection", () => {
    const resolved = adapterProfileRegistry.assertCompatible(selection);
    expect(resolved.adapter.capabilities).toContain("XML_STREAMING");
    expect(resolved.profile.requiredCapabilities).toContain("XML_NAMESPACES");
  });

  it("fails fast for unknown adapter and profile identities", () => {
    expect(() => adapterProfileRegistry.assertCompatible({ ...selection, adapterKey: "unknown" }))
      .toThrowError(new SourceRegistryError("SOURCE_REGISTRY_ADAPTER_UNKNOWN"));
    expect(() => adapterProfileRegistry.assertCompatible({ ...selection, profileVersion: "2.0.0" }))
      .toThrowError(new SourceRegistryError("SOURCE_REGISTRY_PROFILE_UNKNOWN"));
  });

  it("rejects a profile when the adapter lacks a required capability", () => {
    const adapter: SourceAdapterDescriptor = {
      key: "synthetic-adapter",
      version: "1",
      capabilities: ["XML_STREAMING"],
      datasetTypes: ["MIXED_REALTY"],
      transportTypes: ["HTTPS_XML"],
    };
    const profile: SourceProfileDescriptor = {
      key: "synthetic-profile",
      version: "1",
      compatibleAdapters: [{ key: adapter.key, versions: [adapter.version] }],
      requiredCapabilities: ["XML_STREAMING", "XML_NAMESPACES"],
      datasetTypes: ["MIXED_REALTY"],
    };
    const registry = createAdapterProfileRegistry({ adapters: [adapter], profiles: [profile] });

    expect(() => registry.assertCompatible({
      adapterKey: adapter.key,
      adapterVersion: adapter.version,
      profileKey: profile.key,
      profileVersion: profile.version,
      datasetType: "MIXED_REALTY",
      transportType: "HTTPS_XML",
    })).toThrowError(new SourceRegistryError("SOURCE_REGISTRY_PROFILE_INCOMPATIBLE"));
  });

  it("rejects duplicate descriptor identities at registry assembly", () => {
    const descriptor = adapterProfileRegistry.getAdapter("yrl-realty-2010", "1.0.0");
    expect(() => createAdapterProfileRegistry({ adapters: [descriptor, descriptor], profiles: [] }))
      .toThrowError(new SourceRegistryError("SOURCE_REGISTRY_DESCRIPTOR_DUPLICATE"));
  });
});
