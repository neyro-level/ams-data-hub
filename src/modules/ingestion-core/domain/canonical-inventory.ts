import { createPublicDtoMapper, type PublicDto } from "@ams-data-hub/data-contracts";
import {
  publicInventoryDtoSchema,
  DESCRIPTION_HTML_SAFE_TAGS,
  descriptionHtmlSafeSchema,
  type DescriptionHtmlSafe,
  type InventoryEntity,
  type PublicInventoryDto,
  type MediaPublicV1,
  type SparseValue,
} from "@ams-data-hub/realty-contracts";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import sanitizeHtml from "sanitize-html";

const CADASTRAL_FORMAT = /^\d{2}:\d{2}:\d{6,7}:\d+$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;

export interface UnitNormalizationResult {
  value: number;
  unit: "M2" | "METER";
  provenance: { rawValue: string; rawUnit: string };
}

export interface TimestampNormalizationResult {
  valueUtc: string;
  rawTimestamp: string;
  rawOffset: string;
}

export interface PhoneNormalizationResult {
  rawPhone: string;
  phoneNorm?: string;
  warning?: "PHONE_NORMALIZATION_FAILED";
}

export interface CadastralNormalizationResult {
  cadastralNumberRaw?: string;
  cadastralNumberNormalized?: string;
  cadastralValidationStatus: "VALID_FORMAT" | "INVALID_FORMAT" | "PLACEHOLDER_SUSPECTED" | "ABSENT";
}

export function sparseValue<TValue>(input: unknown, parse: (value: unknown) => TValue): SparseValue<TValue> {
  if (input === undefined || input === null || input === "") return { state: "ABSENT" };
  if (input === false || input === "false") return { state: "EXPLICIT_FALSE" };
  if (input === 0 || input === "0") return { state: "EXPLICIT_ZERO" };
  try {
    return { state: "VALUE", value: parse(input) };
  } catch (error) {
    return {
      state: "INVALID",
      raw: String(input).slice(0, 2_000),
      reason: error instanceof Error ? error.message.slice(0, 300) : "INVALID_VALUE",
    };
  }
}

export function normalizeArea(rawValue: string | number, rawUnit: string): UnitNormalizationResult {
  const value = typeof rawValue === "number" ? rawValue : Number(rawValue.replace(",", "."));
  if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_AREA_VALUE");
  const unit = rawUnit.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
  const factor = new Map<string, number>([
    ["m2", 1], ["m²", 1], ["кв. м", 1], ["кв.м", 1], ["сотка", 100], ["сотки", 100],
    ["ha", 10_000], ["га", 10_000],
  ]).get(unit);
  if (factor === undefined) throw new Error("UNKNOWN_AREA_UNIT");
  return { value: value * factor, unit: "M2", provenance: { rawValue: String(rawValue), rawUnit } };
}

export function normalizeHeight(rawValue: string | number, rawUnit: string): UnitNormalizationResult {
  const value = typeof rawValue === "number" ? rawValue : Number(rawValue.replace(",", "."));
  if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_HEIGHT_VALUE");
  const unit = rawUnit.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
  const factor = new Map<string, number>([["m", 1], ["м", 1], ["cm", 0.01], ["см", 0.01]]).get(unit);
  if (factor === undefined) throw new Error("UNKNOWN_HEIGHT_UNIT");
  return { value: value * factor, unit: "METER", provenance: { rawValue: String(rawValue), rawUnit } };
}

export function normalizeTimestamp(rawTimestamp: string): TimestampNormalizationResult {
  const value = rawTimestamp.trim();
  const offset = value.match(/(Z|[+-]\d{2}:?\d{2})$/u)?.[1];
  if (!offset) throw new Error("TIMESTAMP_OFFSET_REQUIRED");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error("INVALID_TIMESTAMP");
  const valueUtc = parsed.toISOString();
  if (!UTC_TIMESTAMP.test(valueUtc)) throw new Error("INVALID_UTC_TIMESTAMP");
  return { valueUtc, rawTimestamp, rawOffset: offset === "Z" ? "+00:00" : offset };
}

export function normalizeDescription(rawDescription: string): {
  descriptionHtmlSafe: DescriptionHtmlSafe;
  descriptionText: string;
} {
  const descriptionHtmlSafe = descriptionHtmlSafeSchema.parse(sanitizeHtml(rawDescription, {
    allowedTags: [...DESCRIPTION_HTML_SAFE_TAGS],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "style", "textarea", "option", "iframe", "object"],
  }).trim());
  const descriptionText = sanitizeHtml(descriptionHtmlSafe, {
    allowedTags: [],
    allowedAttributes: {},
  }).replace(/\s+/gu, " ").trim();
  return { descriptionHtmlSafe, descriptionText };
}

export function normalizePhone(rawPhone: string, defaultCountry: CountryCode = "RU"): PhoneNormalizationResult {
  const raw = rawPhone.trim();
  const parsed = parsePhoneNumberFromString(raw, defaultCountry);
  if (!parsed?.isValid()) return { rawPhone, warning: "PHONE_NORMALIZATION_FAILED" };
  return { rawPhone, phoneNorm: parsed.number };
}

export function normalizeCadastralNumber(
  rawValue: string | null | undefined,
  placeholderPatterns: readonly RegExp[] = [],
): CadastralNormalizationResult {
  if (rawValue === undefined || rawValue === null || rawValue.trim() === "") {
    return { cadastralValidationStatus: "ABSENT" };
  }
  const normalized = rawValue.normalize("NFKC").replace(/\s+/gu, "");
  if (placeholderPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      cadastralNumberRaw: rawValue,
      cadastralNumberNormalized: normalized,
      cadastralValidationStatus: "PLACEHOLDER_SUSPECTED",
    };
  }
  return {
    cadastralNumberRaw: rawValue,
    cadastralNumberNormalized: normalized,
    cadastralValidationStatus: CADASTRAL_FORMAT.test(normalized) ? "VALID_FORMAT" : "INVALID_FORMAT",
  };
}

const mapPublicInventory = createPublicDtoMapper(publicInventoryDtoSchema,
  ({ entity, media }: { entity: InventoryEntity; media: readonly MediaPublicV1[] }) => ({
  uid: entity.uid,
  publicUrlId: entity.publicUrlId,
  propertyType: entity.propertyType,
  facts: entity.facts,
  transactionType: entity.transactionType,
  ...(entity.dealKind === undefined ? {} : { dealKind: entity.dealKind }),
  status: entity.status,
  ...(entity.sourceCreatedAt === undefined ? {} : { sourceCreatedAt: entity.sourceCreatedAt }),
  ...(entity.sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: entity.sourceUpdatedAt }),
  firstSeenAt: entity.firstSeenAt,
  lastSeenAt: entity.lastSeenAt,
  ...(entity.title === undefined ? {} : { title: entity.title }),
  ...(entity.descriptionHtmlSafe === undefined ? {} : { descriptionHtmlSafe: entity.descriptionHtmlSafe }),
  ...(entity.descriptionText === undefined ? {} : { descriptionText: entity.descriptionText }),
  ...(entity.price === undefined ? {} : { price: entity.price }),
  ...(entity.currency === undefined ? {} : { currency: entity.currency }),
  ...(entity.rentPeriod === undefined ? {} : { rentPeriod: entity.rentPeriod }),
  address: { addressPublic: entity.address.addressPublic },
  geo: entity.geo,
  locationPrecision: entity.locationPrecision,
  ...(entity.agentUid === undefined ? {} : { agentUid: entity.agentUid }),
  media: [...media],
  ...(entity.isImageOrderChangeAllowed === undefined ? {} : {
    isImageOrderChangeAllowed: entity.isImageOrderChangeAllowed,
  }),
  createdAt: entity.createdAt,
  updatedAt: entity.updatedAt,
}));

/** Raw producer media belongs to the internal entity only. Supply separately
 * projected mirrored media; absent mirrors produce an empty public collection. */
export function toPublicInventoryDto(
  entity: InventoryEntity,
  media: readonly MediaPublicV1[] = [],
): PublicDto<PublicInventoryDto & object> {
  return mapPublicInventory({ entity, media });
}
