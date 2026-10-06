import { adapterProfileRegistry, type SourceDescriptorSelection } from "./adapter-profile-registry.ts";
import { normalizeMarketplaceRecord, parseAvitoV3Feed, parseCianV2Feed, type MarketplaceFeedFormat, type FeedNormalizationResult } from "./marketplace-feed-adapters.ts";
import type { MarketplaceXmlRecord } from "./marketplace-xml-parser.ts";
import { resolveProfileAlias } from "./source-profile.ts";
import type { SourceIntakeLimits } from "./source-intake-policy.ts";
import { parseYrl2010, type YrlRawOffer } from "./yrl-2010-parser.ts";

type FeedInput = AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>;
export type ExecutableFeedRecord = YrlRawOffer | MarketplaceXmlRecord;
interface ParseOptions { limits: SourceIntakeLimits; expectedNamespace?: string }
type Parser = (input: FeedInput, options: ParseOptions) => AsyncIterable<ExecutableFeedRecord>;

const parsers: ReadonlyMap<string, Parser> = new Map([
  ["yrl-realty-2010@1.0.0", (input, { limits, expectedNamespace }) => parseYrl2010(input, {
    expectedNamespace: expectedNamespace ?? "http://webmaster.yandex.ru/schemas/feed/realty/2010-06",
    limits: { ...limits, maxArtifactBytes: limits.maxRawArtifactBytes, maxOffers: limits.maxRecords,
      maxElementsPerOffer: limits.maxElementsPerRecord, maxOfferCharacters: limits.maxRecordCharacters },
  })],
  ["avito-xml-v3@1.0.0", (input, { limits }) => parseAvitoV3Feed(input, {
    ...limits, maxArtifactBytes: limits.maxRawArtifactBytes,
  })],
  ["cian-xml-v2@1.0.0", (input, { limits }) => parseCianV2Feed(input, {
    limits: { ...limits, maxArtifactBytes: limits.maxRawArtifactBytes },
  })],
]);
const profileFormats: ReadonlyMap<string, MarketplaceFeedFormat> = new Map([
  ["default-v1@1.0.0", "YRL_2010"], ["vladis-vt24-v1@1.0.0", "YRL_2010"],
  ["joywork-yandex-realty-v1@1.0.0", "YRL_2010"], ["joywork-domclick-v1@1.0.0", "DOMCLICK_YRL"],
  ["joywork-avito-v3@1.0.0", "AVITO_V3"], ["joywork-cian-v2@1.0.0", "CIAN_V2"],
]);

/** Descriptor compatibility plus exact-version executable binding. Neither
 * project identity nor caller-supplied parser/normalizer selects behavior. */
export function resolveExecutableSourceAdapter(selection: SourceDescriptorSelection) {
  const { adapter, profile } = adapterProfileRegistry.assertCompatible(selection);
  const parse = parsers.get(`${adapter.key}@${adapter.version}`);
  const format = profileFormats.get(`${profile.key}@${profile.version}`);
  if (!parse || !format) throw new Error("SOURCE_EXECUTABLE_BINDING_MISSING");
  return Object.freeze({
    adapter, profile, parse,
    normalize(record: ExecutableFeedRecord): FeedNormalizationResult {
      const normalized = normalizeMarketplaceRecord(record, format);
      if (!normalized.draft || !profile.configuration) return normalized;
      const draft = { ...normalized.draft };
      const configuration = profile.configuration;
      const category = draft.categoryRaw && resolveProfileAlias(configuration.categoryAliases, draft.categoryRaw);
      const transaction = draft.transactionRaw && resolveProfileAlias(configuration.transactionAliases, draft.transactionRaw);
      if (category) draft.propertyType = category;
      if (transaction) draft.transactionType = transaction;
      // Price-period alias policy belongs to the selected profile, not parser core.
      const periodRaw = record.element.children.find((child) => child.localName === "price")?.attributes.find((item) => item.localName === "period")?.value;
      const period = periodRaw && resolveProfileAlias(configuration.pricePeriodAliases, periodRaw);
      if (draft.transactionType === "RENT_LONG" && period === "DAY") draft.transactionType = "RENT_SHORT";
      return { draft, issues: normalized.issues.filter((issue) =>
        !(category && issue.code === "UNKNOWN_PROPERTY_TYPE") && !(transaction && issue.code === "UNKNOWN_TRANSACTION_TYPE")) };
    },
  });
}
