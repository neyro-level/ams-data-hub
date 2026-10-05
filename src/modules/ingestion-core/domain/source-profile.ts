import type { SourceDatasetType } from "../contracts.ts";

export type SourceAdapterCapability =
  | "XML_STREAMING"
  | "XML_NAMESPACES"
  | "RAW_ATTRIBUTES";

export interface SourceProfileDescriptor {
  key: string;
  version: string;
  compatibleAdapters: readonly {
    key: string;
    versions: readonly string[];
  }[];
  requiredCapabilities: readonly SourceAdapterCapability[];
  datasetTypes: readonly SourceDatasetType[];
  configuration?: SourceProfileConfiguration;
}

export type ProfilePropertyType =
  | "APARTMENT"
  | "ROOM"
  | "HOUSE"
  | "HOUSE_PART"
  | "LAND"
  | "COTTAGE"
  | "TOWNHOUSE"
  | "GARAGE_BOX"
  | "NEW_BUILD_UNIT"
  | "COMMERCIAL"
  | "OTHER";

export type ProfileTransactionType = "SALE" | "RENT_LONG" | "RENT_SHORT" | "UNKNOWN";
export type ProfileDealKind = "SECONDARY_SALE" | "PRIMARY_SALE" | "ASSIGNMENT" | "UNKNOWN";
export type ProfileLocationPrecision = "EXACT" | "STREET" | "DISTRICT";

export interface ProfileAlias<TValue extends string> {
  source: string;
  target: TValue;
}

export interface SourceFieldMapping {
  sourcePath: string;
  targetField: string;
  sparse: boolean;
}

export interface SourceProfileConfiguration {
  acceptedNamespaces: readonly string[];
  externalOfferIdPath: "offer@internal-id";
  identityStability: "REQUIRES_RUN_2_3_PROOF" | "VERIFIED";
  categoryAliases: readonly ProfileAlias<ProfilePropertyType>[];
  transactionAliases: readonly ProfileAlias<ProfileTransactionType>[];
  dealStatusAliases: readonly ProfileAlias<ProfileDealKind>[];
  pricePeriodAliases: readonly ProfileAlias<"DAY" | "MONTH" | "YEAR">[];
  unitAliases: readonly {
    source: string;
    canonicalUnit: "M2" | "METER";
    multiplier: number;
  }[];
  fieldMappings: readonly SourceFieldMapping[];
  knownSparseFields: readonly string[];
  cadastralPlaceholders: {
    calibrationStatus: "PRELIMINARY" | "CALIBRATED";
    patternSources: readonly string[];
  };
  suspiciousText: {
    calibrationStatus: "PENDING_RUNS_2_3" | "CALIBRATED";
    patternSources: readonly string[];
    severity: "WARNING";
    autoEdit: false;
  };
  sharedOfficePhones: {
    calibrationStatus: "PENDING_OQ_04" | "CALIBRATED";
    e164Values: readonly string[];
    excludeFromAutomaticIdentity: true;
  };
  descriptionCleanup: {
    sourceObjectCodePrefix: "Код объекта:";
    internalTarget: "sourceObjectCode";
    removeRecognizedPrefixFromPublicDescription: true;
    preserveRawProvenance: true;
  };
  media: {
    listingImagePath: "picture";
    agentPhotoPath: "sales-agent/photo";
    urlIdentity: "WITHOUT_QUERY_STRING";
    httpAllowed: false;
  };
  locationPolicy: {
    exactEnabled: false;
    defaultByPropertyType: Readonly<Record<ProfilePropertyType, "STREET">>;
    districtOverrideAllowedFor: readonly ProfilePropertyType[];
  };
  timePolicy: {
    storageTimezone: "UTC";
    preserveRawTimestampAndOffset: true;
  };
  safetyPolicy: {
    calibrationStatus: "BOOTSTRAP" | "CALIBRATED";
    maxDropPercent: number;
    allowEmpty: boolean;
    requireManualApprovalAboveDrop: boolean;
    deactivationEnabled: boolean;
    inactiveAfterMissingGoodRuns: number;
    inactiveAfterMissingHours: number;
    sourceOverdueAfterHours: number;
    ackStaleAfterHours: number;
    minRecordCount: number | null;
    maxRecordCount: number | null;
    maxGrowthPercent: number | null;
    maxInvalidPercent: number | null;
  };
}

export interface SourceObjectCodeExtraction {
  descriptionForPublicProjection: string;
  sourceObjectCode?: string;
}

export function normalizeProfileToken(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");
}

export function resolveProfileAlias<TValue extends string>(
  aliases: readonly ProfileAlias<TValue>[],
  value: string,
): TValue | undefined {
  const normalized = normalizeProfileToken(value);
  return aliases.find((alias) => normalizeProfileToken(alias.source) === normalized)?.target;
}

export function extractSourceObjectCode(description: string): SourceObjectCodeExtraction {
  const match = /^\s*Код объекта:\s*([^\.\r\n]{1,200})\.\s*/u.exec(description);
  if (!match) return { descriptionForPublicProjection: description };
  return {
    sourceObjectCode: match[1]!.trim(),
    descriptionForPublicProjection: description.slice(match[0].length),
  };
}

export function matchesConfiguredPattern(patternSources: readonly string[], value: string): boolean {
  return patternSources.some((source) => new RegExp(source, "iu").test(value));
}
