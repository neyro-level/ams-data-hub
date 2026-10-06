import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import type { SafeOutboundStreamResult } from "../src/platform/http/safe-outbound.ts";
import type { StreamingObjectStorage } from "../src/platform/storage/object-storage.ts";
import { StreamingRawArtifact } from "../src/modules/ingestion-core/infrastructure/streaming-raw-artifact.ts";
import { runSourceImport, type ImportPipelineDependencies } from "../src/modules/ingestion-core/application/import-pipeline.ts";
import { parseYrl2010 } from "../src/modules/ingestion-core/domain/yrl-2010-parser.ts";

const xml = new TextEncoder().encode('<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06"><offer internal-id="fixture-1"><type>продажа</type></offer></realty-feed>');
function response(chunks: Uint8Array[], declared: number | null = null): SafeOutboundStreamResult {
  return { status: 200, contentType: "application/xml", contentLength: declared, finalUrl: new URL("https://feed.example.test/data"), close: vi.fn(), body: (async function* () { for (const chunk of chunks) yield chunk; })() };
}
function storage(): StreamingObjectStorage {
  return { putStream: vi.fn(async (input) => {
    let byteCount = 0;
    const hash = createHash("sha256");
    for await (const chunk of input.openBody()) { byteCount += chunk.byteLength; hash.update(chunk); }
    expect(byteCount).toBe(input.contentLength);
    expect(hash.digest("hex")).toBe(input.sha256);
    return { key: input.key, contentType: input.contentType, contentLength: byteCount, sha256: input.sha256, etag: null, lastModifiedAt: new Date() };
  }) };
}

it("spools raw bytes incrementally, persists exact hash and reopens bounded parser input", async () => {
  const source = response([xml.subarray(0, 31), xml.subarray(31)], xml.byteLength);
  const raw = new StreamingRawArtifact(source, storage(), 1024);
  try {
    const receipt = await raw.persist();
    expect(receipt).toEqual({ storageKey: `source-artifacts/${createHash("sha256").update(xml).digest("hex")}`, rawArtifactHash: createHash("sha256").update(xml).digest("hex"), byteCount: xml.byteLength });
    expect(JSON.stringify(receipt)).not.toMatch(/example|Temp|artifact\.raw|directory|endpoint/);
    let offers = 0;
    for await (const offer of parseYrl2010(raw.open())) { expect(offer.element.attributes[0]?.value).toBe("fixture-1"); offers++; }
    expect(offers).toBe(1);
  } finally { await raw.dispose(); }
  expect(source.close).toHaveBeenCalled();
  expect(() => raw.open()).toThrow("RAW_ARTIFACT_NOT_STORED");
});

it("two identical attempts have independent leases and one cleanup cannot invalidate the other", async () => {
  const first = new StreamingRawArtifact(response([xml]), storage(), 1024);
  const second = new StreamingRawArtifact(response([xml]), storage(), 1024);
  try {
    expect(await first.persist()).toEqual(await second.persist());
    await first.dispose();
    let byteCount = 0;
    for await (const chunk of second.open()) byteCount += chunk.byteLength;
    expect(byteCount).toBe(xml.byteLength);
  } finally { await first.dispose(); await second.dispose(); }
});

it.each(["overflow", "truncated", "transport", "upload"])("fails closed and disposes a failed %s artifact", async (failure) => {
  const source = response([xml], failure === "truncated" ? xml.byteLength + 1 : null);
  if (failure === "transport") source.body = (async function* () { yield xml.subarray(0, 10); throw new Error("SYNTHETIC_STREAM_FAILED"); })();
  const remote = storage();
  if (failure === "upload") remote.putStream = vi.fn(async () => { throw new Error("SYNTHETIC_UPLOAD_FAILED"); });
  const raw = new StreamingRawArtifact(source, remote, failure === "overflow" ? 16 : 1024);
  await expect(raw.persist()).rejects.toBeInstanceOf(Error);
  await raw.dispose();
  expect(source.close).toHaveBeenCalled();
  expect(() => raw.open()).toThrow("RAW_ARTIFACT_NOT_STORED");
  if (failure !== "upload") expect(remote.putStream).not.toHaveBeenCalled();
});

function pipeline(raw: StreamingRawArtifact): ImportPipelineDependencies<StreamingRawArtifact, number, number, number> {
  return {
    safeIntake: { acquire: async () => raw },
    rawArtifactStore: { put: async (_target, value) => value.persist(), release: vi.fn(async () => raw.dispose()) },
    parser: { parse: async (value) => { let count = 0; for await (const offer of parseYrl2010(value.open())) { void offer; count++; } return count; } },
    validator: { validate: async () => undefined }, normalizer: { normalize: async (value) => value }, identityResolver: { resolve: async (value) => value }, safetyAnalyzer: { analyze: async () => undefined },
    stagingStore: { write: async (value) => ({ stagingId: "synthetic-staging", entityCount: value }) }, mutationPlanner: { plan: async () => ({ createCount: 1, updateCount: 0, deactivateCount: 0, payload: null }) },
    repository: { recordAttemptStarted: async () => undefined, recordFailure: async () => undefined, applyGoodRevision: async () => ({ revisionId: "synthetic-revision", sequence: 1 }) }, snapshotTrigger: { request: async () => undefined },
  };
}

it("wires the real raw spool and parser into the existing import orchestrator and always releases", async () => {
  const raw = new StreamingRawArtifact(response([xml]), storage(), 1024);
  const dependencies = pipeline(raw);
  const result = await runSourceImport({ organizationId: "synthetic-org", projectId: "synthetic-project", sourceId: "synthetic-source" }, dependencies);
  expect(result).toMatchObject({ state: "GOOD", rawArtifactHash: createHash("sha256").update(xml).digest("hex") });
  expect(dependencies.rawArtifactStore.release).toHaveBeenCalledTimes(1);
  expect(() => raw.open()).toThrow("RAW_ARTIFACT_NOT_STORED");
});

it("releases the spool after a real parser failure and never applies a GOOD revision", async () => {
  const raw = new StreamingRawArtifact(response([new TextEncoder().encode("<broken>")]), storage(), 1024);
  const dependencies = pipeline(raw);
  let attemptDirectory: string | undefined;
  const originalPut = dependencies.rawArtifactStore.put;
  dependencies.rawArtifactStore.put = async (target, value) => {
    const result = await originalPut(target, value);
    attemptDirectory = Reflect.get(value, "directory") as string;
    return result;
  };
  dependencies.repository.applyGoodRevision = vi.fn();
  const result = await runSourceImport({ organizationId: "synthetic-org", projectId: "synthetic-project", sourceId: "synthetic-source" }, dependencies);
  expect(result).toMatchObject({ state: "FAILED", failedStage: "PARSE" });
  expect(dependencies.repository.applyGoodRevision).not.toHaveBeenCalled();
  expect(dependencies.rawArtifactStore.release).toHaveBeenCalledTimes(1);
  expect(attemptDirectory).toBeDefined();
  await expect(access(attemptDirectory!)).rejects.toMatchObject({ code: "ENOENT" });
  expect(() => raw.open()).toThrow("RAW_ARTIFACT_NOT_STORED");
});

it("reports cleanup failure without invalidating committed GOOD or leaking the original exception", async () => {
  const raw = new StreamingRawArtifact(response([xml]), storage(), 1024);
  const dependencies = pipeline(raw);
  dependencies.rawArtifactStore.release = async () => { await raw.dispose(); throw new Error("synthetic private error details"); };
  dependencies.onCleanupFailure = vi.fn(async () => undefined);
  const target = { organizationId: "synthetic-org", projectId: "synthetic-project", sourceId: "synthetic-source" };
  await expect(runSourceImport(target, dependencies)).resolves.toMatchObject({ state: "GOOD" });
  expect(dependencies.onCleanupFailure).toHaveBeenCalledWith(target, "RAW_ARTIFACT_CLEANUP_FAILED");
});
