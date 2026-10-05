import {
  resolveProfileAlias,
  type ProfileDealKind,
  type ProfileTransactionType,
  type SourceProfileDescriptor,
  type SourceProfileConfiguration,
} from "../source-profile.ts";

const ALL_PROPERTY_TYPES = [
  "APARTMENT", "ROOM", "HOUSE", "HOUSE_PART", "LAND", "COTTAGE", "TOWNHOUSE",
  "GARAGE_BOX", "NEW_BUILD_UNIT", "COMMERCIAL", "OTHER",
] as const;

const defaultStreetPrecision = Object.freeze(Object.fromEntries(
  ALL_PROPERTY_TYPES.map((propertyType) => [propertyType, "STREET"]),
) as SourceProfileConfiguration["locationPolicy"]["defaultByPropertyType"]);
const DISTRICT_OVERRIDE_PROPERTY_TYPES = Object.freeze([
  "HOUSE", "HOUSE_PART", "LAND", "COTTAGE", "TOWNHOUSE", "GARAGE_BOX",
] as const);

export const vladisVt24Configuration = Object.freeze<SourceProfileConfiguration>({
  acceptedNamespaces: Object.freeze(["http://webmaster.yandex.ru/schemas/feed/realty/2010-06"]),
  externalOfferIdPath: "offer@internal-id",
  identityStability: "VERIFIED",
  categoryAliases: Object.freeze([
    { source: "квартира", target: "APARTMENT" },
    { source: "комната", target: "ROOM" },
    { source: "house", target: "HOUSE" },
    { source: "часть дома", target: "HOUSE_PART" },
    { source: "lot", target: "LAND" },
    { source: "дача", target: "COTTAGE" },
    { source: "таунхаус", target: "TOWNHOUSE" },
    { source: "гараж", target: "GARAGE_BOX" },
    { source: "box", target: "GARAGE_BOX" },
    { source: "коммерческая", target: "COMMERCIAL" },
  ]),
  transactionAliases: Object.freeze([
    { source: "продажа", target: "SALE" },
  ]),
  dealStatusAliases: Object.freeze([
    { source: "secondary-sale", target: "SECONDARY_SALE" },
    { source: "primary-sale", target: "PRIMARY_SALE" },
    { source: "assignment", target: "ASSIGNMENT" },
  ]),
  pricePeriodAliases: Object.freeze([
    { source: "день", target: "DAY" },
    { source: "сутки", target: "DAY" },
    { source: "месяц", target: "MONTH" },
    { source: "month", target: "MONTH" },
    { source: "год", target: "YEAR" },
  ]),
  unitAliases: Object.freeze([
    { source: "кв. м", canonicalUnit: "M2", multiplier: 1 },
    { source: "сотка", canonicalUnit: "M2", multiplier: 100 },
  ]),
  fieldMappings: Object.freeze([
    { sourcePath: "deal-status", targetField: "dealKind", sparse: true },
    { sourcePath: "rooms-type", targetField: "facts.roomsType", sparse: true },
    { sourcePath: "window-view", targetField: "facts.windowView", sparse: true },
    { sourcePath: "balcony", targetField: "facts.balconyText", sparse: true },
    { sourcePath: "bathroom-unit", targetField: "facts.bathroomType", sparse: true },
    { sourcePath: "renovation", targetField: "facts.renovation", sparse: true },
    { sourcePath: "built-year", targetField: "facts.buildingYear", sparse: true },
    { sourcePath: "ceiling-height", targetField: "facts.ceilingHeightM", sparse: true },
    { sourcePath: "heating-supply", targetField: "facts.heatingSupply", sparse: true },
    { sourcePath: "room-furniture", targetField: "facts.roomFurniture", sparse: true },
    { sourcePath: "parking-type", targetField: "facts.parkingType", sparse: true },
    { sourcePath: "lot-type", targetField: "facts.lotType", sparse: true },
    { sourcePath: "video-review", targetField: "facts.videoReviewAvailable", sparse: true },
    { sourcePath: "online-show", targetField: "facts.onlineShowAvailable", sparse: true },
    { sourcePath: "disable-flat-plan-guess", targetField: "facts.disableFlatPlanGuess", sparse: true },
    { sourcePath: "is-image-order-change-allowed", targetField: "isImageOrderChangeAllowed", sparse: true },
    { sourcePath: "location/apartment", targetField: "address.apartmentNumberPrivate", sparse: true },
  ]),
  knownSparseFields: Object.freeze([
    "rooms", "floor", "floors-total", "living-space", "kitchen-space", "lot-area",
    "built-year", "ceiling-height", "balcony", "bathroom-unit", "window-view", "renovation",
    "heating-supply", "room-furniture", "parking-type", "lot-type", "video-review", "online-show",
    "disable-flat-plan-guess", "utilities", "cadastral-number", "location/latitude",
    "location/longitude", "price@period",
  ]),
  cadastralPlaceholders: Object.freeze({
    calibrationStatus: "PRELIMINARY",
    patternSources: Object.freeze(["^00:00:0+:0+$"]),
  }),
  suspiciousText: Object.freeze({
    calibrationStatus: "CALIBRATED",
    patternSources: Object.freeze([
      String.raw`(?:сгенерирован|нейросет|искусственн(?:ый|ого|ым)\s+интеллект|chatgpt|\bgpt\b)`,
    ]),
    severity: "WARNING",
    autoEdit: false,
  }),
  sharedOfficePhones: Object.freeze({
    calibrationStatus: "CALIBRATED",
    e164Values: Object.freeze([]),
    excludeFromAutomaticIdentity: true,
  }),
  descriptionCleanup: Object.freeze({
    sourceObjectCodePrefix: "Код объекта:",
    internalTarget: "sourceObjectCode",
    removeRecognizedPrefixFromPublicDescription: true,
    preserveRawProvenance: true,
  }),
  media: Object.freeze({
    listingImagePath: "picture",
    agentPhotoPath: "sales-agent/photo",
    urlIdentity: "WITHOUT_QUERY_STRING",
    httpAllowed: false,
  }),
  locationPolicy: Object.freeze({
    exactEnabled: false,
    defaultByPropertyType: defaultStreetPrecision,
    districtOverrideAllowedFor: DISTRICT_OVERRIDE_PROPERTY_TYPES,
  }),
  timePolicy: Object.freeze({ storageTimezone: "UTC", preserveRawTimestampAndOffset: true }),
  safetyPolicy: Object.freeze({
    calibrationStatus: "CALIBRATED",
    maxDropPercent: 20,
    allowEmpty: false,
    requireManualApprovalAboveDrop: true,
    deactivationEnabled: true,
    inactiveAfterMissingGoodRuns: 2,
    inactiveAfterMissingHours: 24,
    sourceOverdueAfterHours: 24,
    ackStaleAfterHours: 24,
    minRecordCount: 777,
    maxRecordCount: 1458,
    maxGrowthPercent: 50,
    maxInvalidPercent: 1,
  }),
});

export const vladisVt24Profile = Object.freeze<SourceProfileDescriptor>({
  key: "vladis-vt24-v1",
  version: "1.0.0",
  compatibleAdapters: Object.freeze([
    Object.freeze({ key: "yrl-realty-2010", versions: Object.freeze(["1.0.0"]) }),
  ]),
  requiredCapabilities: Object.freeze(["XML_STREAMING", "XML_NAMESPACES", "RAW_ATTRIBUTES"]),
  datasetTypes: Object.freeze(["MIXED_REALTY"]),
  configuration: vladisVt24Configuration,
});

export function resolveVladisTransaction(
  typeValue: string,
  pricePeriod?: string,
): ProfileTransactionType {
  const direct = resolveProfileAlias(vladisVt24Configuration.transactionAliases, typeValue);
  if (direct) return direct;
  if (typeValue.normalize("NFKC").trim().toLocaleLowerCase("ru-RU") !== "аренда") return "UNKNOWN";
  const period = pricePeriod === undefined
    ? undefined
    : resolveProfileAlias(vladisVt24Configuration.pricePeriodAliases, pricePeriod);
  return period === "DAY" ? "RENT_SHORT" : period === "MONTH" || period === "YEAR" ? "RENT_LONG" : "UNKNOWN";
}

export function resolveVladisDealKind(dealStatus: string | undefined): ProfileDealKind {
  if (dealStatus === undefined) return "UNKNOWN";
  return resolveProfileAlias(vladisVt24Configuration.dealStatusAliases, dealStatus) ?? "UNKNOWN";
}
