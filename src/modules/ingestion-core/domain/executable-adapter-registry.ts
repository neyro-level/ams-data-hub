import { adapterProfileRegistry, type SourceDescriptorSelection } from "./adapter-profile-registry.ts";
import { normalizeMarketplaceRecord, parseAvitoV3Feed, parseCianV2Feed, type MarketplaceFeedFormat, type FeedNormalizationResult } from "./marketplace-feed-adapters.ts";
import type { MarketplaceXmlRecord } from "./marketplace-xml-parser.ts";
import { normalizeArea } from "./canonical-inventory.ts";
import { normalizeProfileToken, resolveProfileAlias } from "./source-profile.ts";
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
      if (!normalized.draft) return normalized;
      const draft = { ...normalized.draft };
      const configuration = profile.configuration;
      const category = configuration && draft.categoryRaw && resolveProfileAlias(configuration.categoryAliases, draft.categoryRaw);
      const transaction = configuration && draft.transactionRaw && resolveProfileAlias(configuration.transactionAliases, draft.transactionRaw);
      if (category) draft.propertyType = category;
      if (transaction) draft.transactionType = transaction;
      const issues = normalized.issues.filter((issue) =>
        !(category && issue.code === "UNKNOWN_PROPERTY_TYPE") && !(transaction && issue.code === "UNKNOWN_TRANSACTION_TYPE"));
      // YRL declares area units explicitly. Never treat an unknown declaration
      // as square metres; retain the untouched raw record/provenance separately.
      if (format === "YRL_2010" || format === "DOMCLICK_YRL") {
        const area = record.element.children.find((child) => child.localName === "area");
        const unit = area?.children.find((child) => child.localName === "unit")?.text.trim();
        if (draft.areaM2 !== undefined && unit) {
          try {
            const alias = configuration?.unitAliases.find((item) => item.canonicalUnit === "M2"
              && normalizeProfileToken(item.source) === normalizeProfileToken(unit));
            draft.areaM2 = alias ? draft.areaM2 * alias.multiplier : normalizeArea(draft.areaM2, unit).value;
            if (!Number.isFinite(draft.areaM2) || draft.areaM2 < 0) throw new Error("INVALID_AREA_VALUE");
          } catch {
            delete draft.areaM2;
            issues.push({ code: "INVALID_NUMBER", field: "areaUnit" });
          }
        }
      }
      // Price-period alias policy belongs to the selected profile, not parser core.
      const periodRaw = record.element.children.find((child) => child.localName === "price")?.attributes.find((item) => item.localName === "period")?.value;
      const period = configuration && periodRaw && resolveProfileAlias(configuration.pricePeriodAliases, periodRaw);
      if (configuration && (draft.transactionType === "RENT_LONG" || draft.transactionType === "RENT_SHORT")) {
        draft.transactionType = period === "DAY" ? "RENT_SHORT"
          : period === "MONTH" || period === "YEAR" ? "RENT_LONG" : "UNKNOWN";
        if (draft.transactionType === "UNKNOWN") issues.push({ code: "UNKNOWN_TRANSACTION_TYPE", field: "pricePeriod" });
      }
      return { draft, issues };
    },
  });
}
