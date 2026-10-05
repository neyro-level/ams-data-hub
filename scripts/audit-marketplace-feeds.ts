import { createHash } from "node:crypto";
import { safeOutboundRequest } from "../src/platform/http/safe-outbound.ts";
import {
  findDuplicateExternalIds,
  normalizeMarketplaceRecord,
  parseAvitoV3Feed,
  parseCianV2Feed,
  parseDomclickYrlFeed,
  parseJoyworkYandexFeed,
  type CanonicalFeedDraft,
  type MarketplaceFeedFormat,
  type MarketplaceXmlRecord,
  type YrlRawOffer,
} from "../src/modules/ingestion-core/index.ts";

const MAX_BYTES = 32 * 1024 * 1024;
type RecordValue = MarketplaceXmlRecord | YrlRawOffer;

const inputs = [
  { label: "YRL_2010", env: "FEED_AUDIT_YRL_URL", parse: parseJoyworkYandexFeed },
  { label: "DOMCLICK_YRL", env: "FEED_AUDIT_DOMCLICK_URL", parse: parseDomclickYrlFeed },
  { label: "AVITO_V3", env: "FEED_AUDIT_AVITO_URL", parse: parseAvitoV3Feed },
  { label: "CIAN_V2", env: "FEED_AUDIT_CIAN_URL", parse: parseCianV2Feed },
] as const;

async function audit(input: typeof inputs[number]) {
  const rawUrl = process.env[input.env];
  if (!rawUrl) return { format: input.label, status: "SKIPPED_ENV_MISSING" };
  const response = await safeOutboundRequest(rawUrl, {
    purpose: "feed",
    allowedContentTypes: ["application/xml", "text/xml", "application/octet-stream", "text/plain"],
    timeoutMs: 30_000,
    maxBytes: MAX_BYTES,
    maxRedirects: 0,
  });
  const bytes = response.body;
  const records: RecordValue[] = [];
  for await (const record of input.parse([bytes] as never)) records.push(record);
  const drafts: CanonicalFeedDraft[] = [];
  let issueCount = 0;
  for (const record of records) {
    const result = normalizeMarketplaceRecord(record, input.label as MarketplaceFeedFormat);
    issueCount += result.issues.length;
    if (result.draft) drafts.push(result.draft);
  }
  return {
    format: input.label, status: "PARSED", bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"), records: records.length,
    normalizedDrafts: drafts.length, duplicateExternalIds: findDuplicateExternalIds(drafts).length, issueCount,
  };
}

const results = [];
for (const input of inputs) results.push(await audit(input));
console.log(JSON.stringify({ contract: "MARKETPLACE_FEED_AUDIT_V1", results }, null, 2));
