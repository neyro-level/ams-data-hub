import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import { dirname } from "node:path";
import type { IncomingMessage } from "node:http";
import { expect, it } from "vitest";

import {
  extractVladisAgentEvidence,
  parseYrl2010,
  resolveProfileAlias,
  resolveVladisTransaction,
  vladisVt24Configuration,
  type YrlRawElement,
  type YrlRawOffer,
} from "../src/modules/ingestion-core/index.ts";
import {
  ambiguousPhoneNames,
  normalizeAgentEvidence,
  type NormalizedAgentEvidence,
} from "../src/modules/project-state/index.ts";
import {
  executeSafeOutbound,
  SafeOutboundError,
  type SafeOutboundDependencies,
  type SafeOutboundTransportResponse,
} from "../src/platform/http/safe-outbound-core.ts";

const EXPECTED_NAMESPACE = "http://webmaster.yandex.ru/schemas/feed/realty/2010-06";
const RUN_COUNT = 3;
const SUSPICIOUS_TEXT_PATTERNS = Object.freeze([
  {
    key: "AI_GENERATION_DISCLOSURE",
    source: String.raw`(?:сгенерирован|нейросет|искусственн(?:ый|ого|ым)\s+интеллект|chatgpt|\bgpt\b)`,
  },
]);

function transportResponse(message: IncomingMessage): SafeOutboundTransportResponse {
  const firstHeader = (name: string): string | undefined => {
    const value = message.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    status: message.statusCode ?? 0,
    headers: {
      location: firstHeader("location"),
      "content-type": firstHeader("content-type"),
      "content-length": firstHeader("content-length"),
    },
    body: message,
    abort: () => message.destroy(),
  };
}

const outboundDependencies: SafeOutboundDependencies = {
  async resolve(hostname) {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
  },
  request(input) {
    return new Promise((resolve, reject) => {
      const hostname = input.url.hostname.replace(/^\[|\]$/gu, "");
      const request = requestHttps({
        protocol: input.url.protocol,
        hostname: input.address.address,
        family: input.address.family,
        port: input.url.port ? Number(input.url.port) : 443,
        path: `${input.url.pathname}${input.url.search}`,
        method: "GET",
        servername: isIP(hostname) === 0 ? hostname : undefined,
        headers: {
          host: input.url.host,
          accept: input.accept,
          "user-agent": "AMS-Data-Hub-Calibration/1.0",
          connection: "close",
        },
      }, (message) => resolve(transportResponse(message)));
      const abort = () => request.destroy(new SafeOutboundError("TIMEOUT", "Outbound request timed out"));
      input.signal.addEventListener("abort", abort, { once: true });
      request.once("error", reject);
      request.once("close", () => input.signal.removeEventListener("abort", abort));
      request.end();
    });
  },
};

function child(element: YrlRawElement | undefined, localName: string): YrlRawElement | undefined {
  return element?.children.find((candidate) => candidate.localName === localName);
}

function text(element: YrlRawElement | undefined): string | undefined {
  return element?.text.normalize("NFKC").trim().replace(/\s+/gu, " ") || undefined;
}

function externalId(offer: YrlRawOffer): string | undefined {
  return offer.element.attributes.find((attribute) => attribute.localName === "internal-id")?.value.trim() || undefined;
}

function count(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function percentChange(previous: number, current: number): number {
  return previous === 0 ? 0 : ((current - previous) / previous) * 100;
}

interface RunSummary {
  run: number;
  fetchedAt: string;
  artifactSha256: string;
  byteCount: number;
  finalHost: string;
  offerCount: number;
  uniqueExternalIdCount: number;
  missingExternalIdCount: number;
  duplicateExternalIdCount: number;
  countsBySourceCategory: Record<string, number>;
  countsByPropertyType: Record<string, number>;
  unknownCategories: Record<string, number>;
  countsByTransactionType: Record<string, number>;
  unknownTransactionSources: Record<string, number>;
  uniqueAgentPhoneCount: number;
  agentWithoutValidPhoneCount: number;
  ambiguousAgentPhoneCount: number;
  recognizedSourceObjectCodeCount: number;
  suspiciousTextSignals: Record<string, number>;
  externalIds: string[];
}

async function summarizeRun(feedUrl: string, run: number): Promise<RunSummary> {
  const response = await executeSafeOutbound(feedUrl, {
    purpose: "feed",
    allowedContentTypes: ["application/xml", "text/xml", "application/octet-stream"],
    timeoutMs: 60_000,
    maxBytes: 50 * 1024 * 1024,
    maxRedirects: 3,
  }, outboundDependencies);
  const offers: YrlRawOffer[] = [];
  for await (const offer of parseYrl2010([response.body], { expectedNamespace: EXPECTED_NAMESPACE })) {
    offers.push(offer);
  }

  const ids = offers.map(externalId).filter((value): value is string => value !== undefined);
  const uniqueIds = [...new Set(ids)].sort();
  const sourceCategories: string[] = [];
  const propertyTypes: string[] = [];
  const unknownCategories: string[] = [];
  const transactionTypes: string[] = [];
  const unknownTransactionSources: string[] = [];
  const agents: NormalizedAgentEvidence[] = [];
  const descriptions: string[] = [];

  for (const offer of offers) {
    const category = text(child(offer.element, "category")) ?? "<missing>";
    sourceCategories.push(category);
    const propertyType = resolveProfileAlias(vladisVt24Configuration.categoryAliases, category);
    if (propertyType) propertyTypes.push(propertyType);
    else unknownCategories.push(category);

    const pricePeriod = text(child(child(offer.element, "price"), "period"));
    const sourceTransactionType = text(child(offer.element, "type")) ?? "<missing>";
    const transactionType = resolveVladisTransaction(sourceTransactionType, pricePeriod);
    transactionTypes.push(transactionType);
    if (transactionType === "UNKNOWN") unknownTransactionSources.push(`${sourceTransactionType}|${pricePeriod ?? "<missing>"}`);
    const description = text(child(offer.element, "description"));
    if (description) descriptions.push(description);

    const agent = extractVladisAgentEvidence(offer);
    if (agent) {
      agents.push(normalizeAgentEvidence({
        sourceId: "bastion-vladis-pilot",
        fullNameRaw: agent.fullNameRaw,
        phoneRaw: agent.phoneRaw,
        photoSourceUrl: agent.photoSourceUrl,
        categoryRaw: agent.categoryRaw,
        offerExternalIds: [agent.offerExternalId],
      }));
    }
  }

  const distinctAgents = [...new Map(agents.map((agent) => [agent.evidenceKey, agent])).values()];
  const phones = new Set(distinctAgents.map((agent) => agent.phoneNorm).filter((value): value is string => value !== null));
  const suspiciousTextSignals = Object.fromEntries(SUSPICIOUS_TEXT_PATTERNS.map((pattern) => [
    pattern.key,
    descriptions.filter((description) => new RegExp(pattern.source, "iu").test(description)).length,
  ]));

  return {
    run,
    fetchedAt: new Date().toISOString(),
    artifactSha256: createHash("sha256").update(response.body).digest("hex"),
    byteCount: response.body.byteLength,
    finalHost: response.finalUrl.host,
    offerCount: offers.length,
    uniqueExternalIdCount: uniqueIds.length,
    missingExternalIdCount: offers.length - ids.length,
    duplicateExternalIdCount: ids.length - uniqueIds.length,
    countsBySourceCategory: count(sourceCategories),
    countsByPropertyType: count(propertyTypes),
    unknownCategories: count(unknownCategories),
    countsByTransactionType: count(transactionTypes),
    unknownTransactionSources: count(unknownTransactionSources),
    uniqueAgentPhoneCount: phones.size,
    agentWithoutValidPhoneCount: distinctAgents.filter((agent) => agent.phoneNorm === null).length,
    ambiguousAgentPhoneCount: ambiguousPhoneNames(distinctAgents).size,
    recognizedSourceObjectCodeCount: descriptions.filter((description) => /^\s*Код объекта:\s*[^.\r\n]{1,200}\.\s*/u.test(description)).length,
    suspiciousTextSignals,
    externalIds: uniqueIds,
  };
}

async function calibrate() {
  const feedUrl = process.env.VLADIS_FEED_URL?.trim();
  if (!feedUrl) throw new Error("VLADIS_FEED_URL is required");
  const runs: RunSummary[] = [];
  for (let run = 1; run <= RUN_COUNT; run += 1) runs.push(await summarizeRun(feedUrl, run));
  const baselineIds = runs[0]!.externalIds;
  const stableIdentity = runs.every((run) => (
    run.externalIds.length === baselineIds.length
    && run.externalIds.every((value, index) => value === baselineIds[index])
  ));
  const changes = runs.slice(1).map((run, index) => percentChange(runs[index]!.offerCount, run.offerCount));
  const report = {
    schemaVersion: "AMS_DATA_HUB_VLADIS_VT24_CALIBRATION_V1",
    generatedAt: new Date().toISOString(),
    profile: "vladis-vt24-v1",
    employeePhonePolicy: "XML_EMPLOYEE_PHONE_ONLY",
    sharedOfficePhoneCount: 0,
    runs: runs.map(({ externalIds, ...run }) => {
      void externalIds;
      return run;
    }),
    crossRun: {
      identityStable: stableIdentity,
      offerCounts: runs.map((run) => run.offerCount),
      maxObservedDropPercent: Math.max(0, ...changes.map((value) => -value)),
      maxObservedGrowthPercent: Math.max(0, ...changes),
    },
    proposedSafetyPolicy: {
      minRecordCount: Math.max(1, Math.floor(Math.min(...runs.map((run) => run.offerCount)) * 0.8)),
      maxRecordCount: Math.ceil(Math.max(...runs.map((run) => run.offerCount)) * 1.5),
      maxGrowthPercent: 50,
      maxInvalidPercent: 1,
      maxDropPercent: 20,
      deactivationEnabled: stableIdentity,
      inactiveAfterMissingGoodRuns: 2,
      inactiveAfterMissingHours: 24,
    },
  };
  const output = process.env.CALIBRATION_OUTPUT?.trim();
  if (output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

it.skipIf(!process.env.VLADIS_FEED_URL)("calibrates the owner-authorized live Vladis/VT24 source across three safe reads", async () => {
  const report = await calibrate();
  expect(report.crossRun.identityStable).toBe(true);
  expect(report.runs.every((run) => run.missingExternalIdCount === 0)).toBe(true);
  expect(report.runs.every((run) => run.duplicateExternalIdCount === 0)).toBe(true);
  expect(report.runs.every((run) => Object.keys(run.unknownCategories).length === 0)).toBe(true);
  expect(report.runs.every((run) => Object.keys(run.unknownTransactionSources).length === 0)).toBe(true);
  expect(report.runs.every((run) => run.agentWithoutValidPhoneCount === 0)).toBe(true);
}, 180_000);
