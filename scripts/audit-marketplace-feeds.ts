import { createHash } from "node:crypto";
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

async function readBounded(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error("FEED_RESPONSE_BODY_MISSING");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel("FEED_AUDIT_LIMIT_EXCEEDED");
      throw new Error("FEED_AUDIT_LIMIT_EXCEEDED");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

async function audit(input: typeof inputs[number]) {
  const rawUrl = process.env[input.env];
  if (!rawUrl) return { format: input.label, status: "SKIPPED_ENV_MISSING" };
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${input.label}_URL_UNSAFE`);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${input.label}_HTTP_${response.status}`);
  const bytes = await readBounded(response);
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
