import { expect, it, vi } from "vitest";
import { adapterProfileRegistry } from "../src/modules/ingestion-core/domain/adapter-profile-registry.ts";
import { MAX_SOURCE_INTAKE_LIMITS, resolveSourceIntakeLimits } from "../src/modules/ingestion-core/domain/source-intake-policy.ts";
import { createStreamingSourceIntake } from "../src/modules/ingestion-core/infrastructure/streaming-source-intake.ts";
import { StreamingRawArtifact } from "../src/modules/ingestion-core/infrastructure/streaming-raw-artifact.ts";
import { parseYrl2010 } from "../src/modules/ingestion-core/domain/yrl-2010-parser.ts";
import { defineSecretRef, resolveSecretRef } from "../src/platform/security/secret-ref.ts";
import type { SafeOutboundStreamResult } from "../src/platform/http/safe-outbound.ts";
import type { StreamingObjectStorage } from "../src/platform/storage/object-storage.ts";

const adapter = adapterProfileRegistry.getAdapter("yrl-realty-2010", "1.0.0");
const endpoint = resolveSecretRef(defineSecretRef("SYNTHETIC_FEED_ENDPOINT"), { SYNTHETIC_FEED_ENDPOINT: "https://feed.example.test/data" });
function response(bytes: Uint8Array): SafeOutboundStreamResult {
  return { status: 200, contentType: "application/xml", contentLength: null, finalUrl: new URL("https://feed.example.test/data"), close: vi.fn(), body: (async function* () { yield bytes; })() };
}
const storage: StreamingObjectStorage = { putStream: vi.fn(async (input) => { for await (const chunk of input.openBody()) void chunk; return { key: input.key, contentType: input.contentType, contentLength: input.contentLength, sha256: input.sha256, etag: null, lastModifiedAt: new Date() }; }) };

it("selects the narrowest SourceSafety/adapter/hard limit and validates every configured bound", () => {
  const limits = resolveSourceIntakeLimits({ maxRawArtifactBytes: 128 * 1024 * 1024, maxRecords: 5000 }, { maxRawArtifactBytes: 64 * 1024 * 1024, maxRecordCount: 1000 });
  expect(limits).toMatchObject({ maxRawArtifactBytes: 64 * 1024 * 1024, maxRecords: 1000 });
  expect(resolveSourceIntakeLimits({ maxRawArtifactBytes: 512 * 1024 * 1024 }, { maxRawArtifactBytes: 1024 * 1024 * 1024 }).maxRawArtifactBytes).toBe(256 * 1024 * 1024);
  expect(resolveSourceIntakeLimits({}, { maxRecordCount: null })).toEqual(MAX_SOURCE_INTAKE_LIMITS);
  expect(() => resolveSourceIntakeLimits({}, { maxRawArtifactBytes: -1 })).toThrow("SOURCE_INTAKE_LIMIT_INVALID");
  expect(() => resolveSourceIntakeLimits({ maxFieldCharacters: Number.NaN })).toThrow("SOURCE_INTAKE_LIMIT_INVALID");
});

it("binds one source limit to real HTTP policy, raw spool and both parser families", async () => {
  const remote = response(new Uint8Array(17));
  const fetchFeed = vi.fn(async () => remote);
  const intake = createStreamingSourceIntake({ endpoint, storage, adapter, safetyPolicy: { maxRawArtifactBytes: 16, maxRecordCount: 3 }, fetchFeed });
  expect(intake.yrlParserLimits).toMatchObject({ maxArtifactBytes: 16, maxOffers: 3 });
  expect(intake.marketplaceParserLimits).toMatchObject({ maxArtifactBytes: 16, maxRecords: 3 });
  const raw = await intake.safeIntake.acquire();
  try {
    expect(fetchFeed).toHaveBeenCalledWith(endpoint, expect.objectContaining({ purpose: "feed", maxBytes: 16, timeoutMs: 60_000 }));
    await expect(raw.persist()).rejects.toThrow("RAW_ARTIFACT_TOO_LARGE");
    expect(remote.close).toHaveBeenCalled();
  } finally { await raw.dispose(); }
});

it("enforces the source record limit in the actual parser after streaming persistence", async () => {
  const xml = new TextEncoder().encode('<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06"><offer internal-id="one"/><offer internal-id="two"/></realty-feed>');
  const intake = createStreamingSourceIntake({ endpoint, storage, adapter, safetyPolicy: { maxRawArtifactBytes: 1024, maxRecordCount: 1 }, fetchFeed: async () => response(xml) });
  const raw = await intake.safeIntake.acquire();
  try {
    await raw.persist();
    const parse = async () => { for await (const offer of parseYrl2010(raw.open(), { limits: intake.yrlParserLimits })) void offer; };
    await expect(parse()).rejects.toMatchObject({ code: "YRL_OFFER_LIMIT_EXCEEDED" });
  } finally { await raw.dispose(); }
});

it("caps concurrent attempts and releases capacity on cleanup without waiting for bytes", async () => {
  const attempts = Array.from({ length: 4 }, () => new StreamingRawArtifact(response(new Uint8Array()), storage, 16));
  const denied = response(new Uint8Array());
  try {
    expect(() => new StreamingRawArtifact(denied, storage, 16)).toThrow("RAW_ARTIFACT_CAPACITY_EXCEEDED");
    expect(denied.close).toHaveBeenCalled();
    await attempts[0]!.dispose();
    const replacement = new StreamingRawArtifact(response(new Uint8Array()), storage, 16);
    await replacement.dispose();
  } finally { await Promise.all(attempts.map((attempt) => attempt.dispose())); }
});

it("caps total reserved disk bytes independently from concurrency", async () => {
  const attempts = Array.from({ length: 2 }, () => new StreamingRawArtifact(response(new Uint8Array()), storage, 256 * 1024 * 1024));
  const denied = response(new Uint8Array());
  try {
    expect(() => new StreamingRawArtifact(denied, storage, 1024)).toThrow("RAW_ARTIFACT_CAPACITY_EXCEEDED");
    expect(denied.close).toHaveBeenCalled();
  } finally { await Promise.all(attempts.map((attempt) => attempt.dispose())); }
});
