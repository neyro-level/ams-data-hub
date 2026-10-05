import type { SourceProfileDescriptor } from "../source-profile.ts";

const DATASETS = Object.freeze(["MIXED_REALTY", "RESALE", "NEW_BUILD", "HOUSE", "LAND", "COMMERCIAL", "AGENT"] as const);

export const joyworkYandexRealtyProfile = Object.freeze<SourceProfileDescriptor>({
  key: "joywork-yandex-realty-v1", version: "1.0.0",
  compatibleAdapters: Object.freeze([{ key: "yrl-realty-2010", versions: Object.freeze(["1.0.0"]) }]),
  requiredCapabilities: Object.freeze(["XML_STREAMING", "XML_NAMESPACES", "RAW_ATTRIBUTES"]), datasetTypes: DATASETS,
  formatContract: Object.freeze({ family: "YRL_2010", rootElement: "realty-feed", recordElement: "offer", externalIdPath: "offer@internal-id", caseSensitiveTags: true, encoding: "UTF_8", calibrationStatus: "STRUCTURE_VERIFIED", preserveRawProvenance: true }),
});

export const joyworkDomclickProfile = Object.freeze<SourceProfileDescriptor>({
  key: "joywork-domclick-v1", version: "1.0.0",
  compatibleAdapters: Object.freeze([{ key: "yrl-realty-2010", versions: Object.freeze(["1.0.0"]) }]),
  requiredCapabilities: Object.freeze(["XML_STREAMING", "XML_NAMESPACES", "RAW_ATTRIBUTES"]), datasetTypes: DATASETS,
  formatContract: Object.freeze({ family: "YRL_2010", rootElement: "realty-feed", recordElement: "offer", externalIdPath: "offer@internal-id", caseSensitiveTags: true, encoding: "UTF_8", calibrationStatus: "EMPTY_LIVE_FEED", preserveRawProvenance: true }),
});

export const joyworkAvitoProfile = Object.freeze<SourceProfileDescriptor>({
  key: "joywork-avito-v3", version: "1.0.0",
  compatibleAdapters: Object.freeze([{ key: "avito-xml-v3", versions: Object.freeze(["1.0.0"]) }]),
  requiredCapabilities: Object.freeze(["XML_STREAMING", "RAW_ATTRIBUTES"]), datasetTypes: DATASETS,
  formatContract: Object.freeze({ family: "AVITO_V3", rootElement: "Ads", recordElement: "Ad", externalIdPath: "Ad/Id", caseSensitiveTags: true, encoding: "UTF_8", calibrationStatus: "EMPTY_LIVE_FEED", preserveRawProvenance: true }),
});

export const joyworkCianProfile = Object.freeze<SourceProfileDescriptor>({
  key: "joywork-cian-v2", version: "1.0.0",
  compatibleAdapters: Object.freeze([{ key: "cian-xml-v2", versions: Object.freeze(["1.0.0"]) }]),
  requiredCapabilities: Object.freeze(["XML_STREAMING", "RAW_ATTRIBUTES"]), datasetTypes: DATASETS,
  formatContract: Object.freeze({ family: "CIAN_V2", rootElement: "Feed", recordElement: "Object", externalIdPath: "Object/ExternalId", caseSensitiveTags: false, encoding: "UTF_8_OR_WINDOWS_1251", calibrationStatus: "EMPTY_LIVE_FEED", preserveRawProvenance: true }),
});

export const joyworkMarketplaceProfiles = Object.freeze([
  joyworkYandexRealtyProfile, joyworkDomclickProfile, joyworkAvitoProfile, joyworkCianProfile,
]);
