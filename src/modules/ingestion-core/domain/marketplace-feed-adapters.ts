import {
  parseMarketplaceXmlRecords,
  type MarketplaceXmlParserOptions,
  type MarketplaceXmlRecord,
} from "./marketplace-xml-parser.ts";
import type { ProfilePropertyType, ProfileTransactionType } from "./source-profile.ts";
import type { YrlRawElement, YrlRawOffer, YrlParserOptions } from "./yrl-2010-parser.ts";
import { parseYrl2010 } from "./yrl-2010-parser.ts";

export type MarketplaceFeedFormat = "YRL_2010" | "DOMCLICK_YRL" | "AVITO_V3" | "CIAN_V2";

export interface CanonicalFeedDraft {
  sourceFormat: MarketplaceFeedFormat;
  externalId: string;
  propertyType: ProfilePropertyType;
  transactionType: ProfileTransactionType;
  categoryRaw?: string;
  transactionRaw?: string;
  title?: string;
  description?: string;
  address?: string;
  price?: number;
  currency?: string;
  areaM2?: number;
  latitude?: number;
  longitude?: number;
  contactPhones: readonly string[];
  imageUrls: readonly string[];
  provenance: Readonly<Record<string, readonly string[]>>;
}

export interface FeedNormalizationIssue {
  code: "MISSING_EXTERNAL_ID" | "INVALID_NUMBER" | "UNKNOWN_PROPERTY_TYPE" | "UNKNOWN_TRANSACTION_TYPE";
  field: string;
  rawValue?: string;
}

export interface FeedNormalizationResult {
  draft?: CanonicalFeedDraft;
  issues: readonly FeedNormalizationIssue[];
}

export function canonicalSourceObjectKey(sourceId: string, externalId: string): string {
  if (!sourceId.trim() || !externalId.trim()) throw new Error("SOURCE_OBJECT_IDENTITY_INCOMPLETE");
  return `${sourceId.trim()}\u0000${externalId.trim()}`;
}

export function findDuplicateExternalIds(drafts: readonly CanonicalFeedDraft[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const draft of drafts) {
    if (seen.has(draft.externalId)) duplicates.add(draft.externalId);
    seen.add(draft.externalId);
  }
  return [...duplicates].sort();
}

const text = (element: YrlRawElement | undefined): string | undefined =>
  element?.text.normalize("NFKC").trim().replace(/\s+/gu, " ") || undefined;

function children(element: YrlRawElement, name: string, caseSensitive = true): YrlRawElement[] {
  const expected = caseSensitive ? name : name.toLocaleLowerCase("en-US");
  return element.children.filter((candidate) =>
    (caseSensitive ? candidate.localName : candidate.localName.toLocaleLowerCase("en-US")) === expected,
  );
}

function atPath(element: YrlRawElement, path: string, caseSensitive = true): YrlRawElement[] {
  return path.split("/").reduce<YrlRawElement[]>((level, segment) =>
    level.flatMap((candidate) => children(candidate, segment, caseSensitive)), [element]);
}

function values(element: YrlRawElement, paths: readonly string[], caseSensitive = true): string[] {
  return paths.flatMap((path) => atPath(element, path, caseSensitive).map(text).filter((value): value is string => value !== undefined));
}

function attribute(element: YrlRawElement, name: string): string | undefined {
  return element.attributes.find((candidate) => candidate.localName === name)?.value.trim() || undefined;
}

function numberValue(raw: string | undefined, field: string, issues: FeedNormalizationIssue[]): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed)) {
    issues.push({ code: "INVALID_NUMBER", field, rawValue: raw });
    return undefined;
  }
  return parsed;
}

function phoneValues(element: YrlRawElement, mapping: Mapping): string[] {
  if (mapping.format !== "CIAN_V2") return values(element, mapping.phones, mapping.caseSensitive);
  const structured = atPath(element, "Phones/PhoneSchema", false).map((phone) => {
    const countryCode = values(phone, ["CountryCode"], false)[0] ?? "";
    const number = values(phone, ["Number"], false)[0] ?? "";
    return `${countryCode}${number}`.trim();
  }).filter(Boolean);
  return [...structured, ...values(element, ["SubAgent/Phone"], false)];
}

function resolvePropertyType(raw: string | undefined): ProfilePropertyType | undefined {
  if (!raw) return undefined;
  const value = raw.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
  if (["квартира", "квартиры", "flat", "flatsale", "flatrent", "newdevelopmentflat"].includes(value)) return value === "newdevelopmentflat" ? "NEW_BUILD_UNIT" : "APARTMENT";
  if (["комната", "комнаты", "room", "roomsale", "roomrent"].includes(value)) return "ROOM";
  if (["дом", "дома", "дом с участком", "house", "housesale", "houserent"].includes(value)) return "HOUSE";
  if (["участок", "земельные участки", "land", "landsale", "landrent"].includes(value)) return "LAND";
  if (["коттедж", "cottage"].includes(value)) return "COTTAGE";
  if (["таунхаус", "townhouse"].includes(value)) return "TOWNHOUSE";
  if (["гараж", "гаражи и машиноместа", "garage", "garage-sale"].includes(value)) return "GARAGE_BOX";
  if (value.includes("коммер") || value.includes("commercial")) return "COMMERCIAL";
  return undefined;
}

function resolveTransaction(raw: string | undefined, categoryRaw: string | undefined): ProfileTransactionType | undefined {
  const value = `${raw ?? ""} ${categoryRaw ?? ""}`.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
  if (/(прод|sale)/u.test(value)) return "SALE";
  if (/(посуточ|short.?term|daily)/u.test(value)) return "RENT_SHORT";
  if (/(сдам|аренд|rent)/u.test(value)) return "RENT_LONG";
  return undefined;
}

interface Mapping {
  format: MarketplaceFeedFormat;
  caseSensitive: boolean;
  externalId: (element: YrlRawElement) => string | undefined;
  category: readonly string[];
  transaction: readonly string[];
  title: readonly string[];
  description: readonly string[];
  address: readonly string[];
  price: readonly string[];
  currency: readonly string[];
  area: readonly string[];
  latitude: readonly string[];
  longitude: readonly string[];
  phones: readonly string[];
  images: readonly string[];
  imageAttribute?: string;
}

const mappings: Readonly<Record<MarketplaceFeedFormat, Mapping>> = Object.freeze({
  YRL_2010: {
    format: "YRL_2010", caseSensitive: true, externalId: (element) => attribute(element, "internal-id"),
    category: ["category"], transaction: ["type", "deal-status"], title: ["title"], description: ["description"],
    address: ["location/address", "location/locality-name"], price: ["price/value"], currency: ["price/currency"],
    area: ["area/value"], latitude: ["location/latitude"], longitude: ["location/longitude"],
    phones: ["sales-agent/phone"], images: ["picture"],
  },
  DOMCLICK_YRL: {
    format: "DOMCLICK_YRL", caseSensitive: true, externalId: (element) => attribute(element, "internal-id"),
    category: ["category"], transaction: ["type", "deal-status"], title: ["title"], description: ["description"],
    address: ["location/address", "location/locality-name"], price: ["price/value"], currency: ["price/currency"],
    area: ["area/value"], latitude: ["location/latitude"], longitude: ["location/longitude"],
    phones: ["sales-agent/phone"], images: ["picture"],
  },
  AVITO_V3: {
    format: "AVITO_V3", caseSensitive: true, externalId: (element) => values(element, ["Id"])[0],
    category: ["Category"], transaction: ["OperationType"], title: ["Title"], description: ["Description"], address: ["Address"],
    price: ["Price"], currency: [], area: ["Square"], latitude: ["Latitude"], longitude: ["Longitude"],
    phones: ["ContactPhone"], images: ["Images/Image"], imageAttribute: "url",
  },
  CIAN_V2: {
    format: "CIAN_V2", caseSensitive: false, externalId: (element) => values(element, ["ExternalId"], false)[0],
    category: ["Category"], transaction: ["OperationType"], title: ["Title"], description: ["Description"], address: ["Address"],
    price: ["BargainTerms/Price", "Price"], currency: ["BargainTerms/Currency", "Currency"], area: ["TotalArea"],
    latitude: ["Coordinates/Lat"], longitude: ["Coordinates/Lng"], phones: ["Phones/PhoneSchema/Number", "SubAgent/Phone"],
    images: ["Photos/PhotoSchema/FullUrl", "LayoutPhoto/FullUrl"],
  },
});

export function normalizeMarketplaceRecord(record: MarketplaceXmlRecord | YrlRawOffer, format: MarketplaceFeedFormat): FeedNormalizationResult {
  const mapping = mappings[format];
  const element = record.element;
  const issues: FeedNormalizationIssue[] = [];
  const externalId = mapping.externalId(element);
  if (!externalId) return { issues: [{ code: "MISSING_EXTERNAL_ID", field: "externalId" }] };
  const first = (paths: readonly string[]) => values(element, paths, mapping.caseSensitive)[0];
  const categoryRaw = first(mapping.category);
  const transactionRaw = first(mapping.transaction);
  const propertyType = resolvePropertyType(categoryRaw);
  const transactionType = resolveTransaction(transactionRaw, categoryRaw);
  if (!propertyType) issues.push({ code: "UNKNOWN_PROPERTY_TYPE", field: "category", ...(categoryRaw ? { rawValue: categoryRaw } : {}) });
  if (!transactionType) issues.push({ code: "UNKNOWN_TRANSACTION_TYPE", field: "transaction", ...(transactionRaw ? { rawValue: transactionRaw } : {}) });
  const imageElements = mapping.images.flatMap((path) => atPath(element, path, mapping.caseSensitive));
  const imageUrls = imageElements.map((candidate) => mapping.imageAttribute ? attribute(candidate, mapping.imageAttribute) : text(candidate)).filter((value): value is string => Boolean(value));
  const price = numberValue(first(mapping.price), "price", issues);
  const areaM2 = numberValue(first(mapping.area), "areaM2", issues);
  const latitude = numberValue(first(mapping.latitude), "latitude", issues);
  const longitude = numberValue(first(mapping.longitude), "longitude", issues);
  const provenance = Object.fromEntries([
    ...mapping.category, ...mapping.transaction, ...mapping.title, ...mapping.description, ...mapping.address,
    ...mapping.price, ...mapping.currency, ...mapping.area, ...mapping.latitude, ...mapping.longitude,
    ...mapping.phones, ...mapping.images,
  ].map((path) => [path, values(element, [path], mapping.caseSensitive)]));
  return {
    draft: {
      sourceFormat: format, externalId, propertyType: propertyType ?? "OTHER", transactionType: transactionType ?? "UNKNOWN",
      ...(categoryRaw ? { categoryRaw } : {}), ...(transactionRaw ? { transactionRaw } : {}),
      ...(first(mapping.title) ? { title: first(mapping.title) } : {}),
      ...(first(mapping.description) ? { description: first(mapping.description) } : {}),
      ...(first(mapping.address) ? { address: first(mapping.address) } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(first(mapping.currency) ? { currency: first(mapping.currency) } : {}),
      ...(areaM2 !== undefined ? { areaM2 } : {}), ...(latitude !== undefined ? { latitude } : {}),
      ...(longitude !== undefined ? { longitude } : {}), contactPhones: phoneValues(element, mapping), imageUrls, provenance,
    },
    issues,
  };
}

export function parseJoyworkYandexFeed(input: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>, options: YrlParserOptions = {}) {
  return parseYrl2010(input, { expectedNamespace: "http://webmaster.yandex.ru/schemas/feed/realty/2010-06", ...options });
}

export function parseDomclickYrlFeed(input: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>, options: YrlParserOptions = {}) {
  return parseYrl2010(input, { expectedNamespace: "http://webmaster.yandex.ru/schemas/feed/realty/2010-06", ...options });
}

export function parseAvitoV3Feed(input: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>, limits?: MarketplaceXmlParserOptions["limits"]) {
  return parseMarketplaceXmlRecords(input, {
    rootElement: "Ads", recordElement: "Ad", caseSensitive: true, limits,
    validateRoot: (rootAttributes) => {
      const entries = new Map(rootAttributes.map((item) => [item.localName, item.value]));
      return entries.get("formatVersion") === "3" && entries.get("target") === "Avito.ru";
    },
  });
}

export function parseCianV2Feed(
  input: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
  options: Pick<MarketplaceXmlParserOptions, "encoding" | "limits"> = {},
): AsyncGenerator<MarketplaceXmlRecord, void, undefined> {
  const parse = (source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>, encoding: "utf-8" | "windows-1251") => parseMarketplaceXmlRecords(source, {
    rootElement: "Feed", recordElement: "Object", caseSensitive: false, ...options, encoding,
    validateDocument: (rootChildren) => rootChildren.some((candidate) =>
      candidate.localName.toLocaleLowerCase("en-US") === "feed_version" && text(candidate) === "2"),
  });
  if (options.encoding) return parse(input, options.encoding);
  return (async function* () {
    const asyncIterator = Symbol.asyncIterator in Object(input)
      ? (input as AsyncIterable<Uint8Array | string>)[Symbol.asyncIterator]()
      : (async function* () { yield* input as Iterable<Uint8Array | string>; })()[Symbol.asyncIterator]();
    const prefix: (Uint8Array | string)[] = [];
    let prefixBytes = 0;
    let declarationProbe = "";
    while (prefixBytes < 512 && !declarationProbe.includes("?>")) {
      const next = await asyncIterator.next();
      if (next.done) break;
      prefix.push(next.value);
      prefixBytes += typeof next.value === "string" ? new TextEncoder().encode(next.value).byteLength : next.value.byteLength;
      declarationProbe += typeof next.value === "string"
        ? next.value
        : new TextDecoder("windows-1252").decode(next.value);
    }
    const declaredEncoding = declarationProbe.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/iu)?.[1]?.toLocaleLowerCase("en-US");
    const encoding = declaredEncoding && ["windows-1251", "cp1251", "windows1251"].includes(declaredEncoding)
      ? "windows-1251"
      : "utf-8";
    async function* replay() {
      yield* prefix;
      while (true) {
        const next = await asyncIterator.next();
        if (next.done) return;
        yield next.value;
      }
    }
    yield* parse(replay(), encoding);
  })();
}
