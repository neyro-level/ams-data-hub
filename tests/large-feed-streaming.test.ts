import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { expect, it, vi } from "vitest";
import { executeSafeOutboundStream, type SafeOutboundDependencies } from "../src/platform/http/safe-outbound-core.ts";
import { S3ObjectStorage } from "../src/platform/storage/timeweb-s3-object-storage.ts";
import { createStreamingSourceIntake } from "../src/modules/ingestion-core/infrastructure/streaming-source-intake.ts";
import { adapterProfileRegistry } from "../src/modules/ingestion-core/domain/adapter-profile-registry.ts";
import { parseYrl2010 } from "../src/modules/ingestion-core/domain/yrl-2010-parser.ts";
import { defineSecretRef, resolveSecretRef } from "../src/platform/security/secret-ref.ts";

it("processes a greater-than-180-MiB XML through actual spool, S3 streaming adapter and parser without a full-feed allocation", async () => {
  const encoder = new TextEncoder();
  const recordCount = 3072;
  const padding = "x".repeat(60 * 1024);
  const sourceHash = createHash("sha256");
  let sourceBytes = 0;
  let sourcePulls = 0;
  let uploadBytes = 0;
  let uploadMaxChunk = 0;
  const baseline = process.memoryUsage();
  let peakArrayBuffers = baseline.arrayBuffers;
  let peakRss = baseline.rss;
  const sample = () => { const current = process.memoryUsage(); peakArrayBuffers = Math.max(peakArrayBuffers, current.arrayBuffers); peakRss = Math.max(peakRss, current.rss); };
  async function* source() {
    const emit = (text: string) => {
      const bytes = encoder.encode(text);
      sourceBytes += bytes.byteLength;
      sourceHash.update(bytes);
      sourcePulls++;
      sample();
      return bytes;
    };
    yield emit('<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06">');
    for (let index = 0; index < recordCount; index++) {
      yield emit(`<offer internal-id="synthetic-${index}"><description>${padding}</description></offer>`);
    }
    yield emit("</realty-feed>");
  }
  const abort = vi.fn(sample);
  const dependencies: SafeOutboundDependencies = {
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async () => ({ status: 200, headers: { "content-type": "application/xml" }, body: source(), abort }),
  };
  const sdk = new S3Client({ region: "synthetic", credentials: { accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret" } });
  const send = vi.spyOn(sdk, "send").mockImplementation(async (command) => {
    const put = command as PutObjectCommand;
    expect(put.input.Body).toBeInstanceOf(Readable);
    const hash = createHash("sha256");
    for await (const chunk of put.input.Body as Readable) {
      const bytes = chunk as Uint8Array;
      uploadBytes += bytes.byteLength;
      uploadMaxChunk = Math.max(uploadMaxChunk, bytes.byteLength);
      hash.update(bytes);
      sample();
    }
    expect(hash.digest("base64")).toBe(put.input.ChecksumSHA256);
    expect(uploadBytes).toBe(put.input.ContentLength);
    return { ETag: "synthetic-large-feed" } as never;
  });
  const intake = createStreamingSourceIntake({
    endpoint: resolveSecretRef(defineSecretRef("SYNTHETIC_LARGE_FEED"), { SYNTHETIC_LARGE_FEED: "https://feed.example.test/large" }),
    storage: new S3ObjectStorage({ bucket: "synthetic-raw-bucket", client: sdk }),
    adapter: adapterProfileRegistry.getAdapter("yrl-realty-2010", "1.0.0"),
    safetyPolicy: { maxRawArtifactBytes: 256 * 1024 * 1024 },
    fetchFeed: (endpoint, policy) => executeSafeOutboundStream(endpoint, policy, dependencies),
  });
  const raw = await intake.safeIntake.acquire();
  expect(sourcePulls).toBe(0);
  try {
    const receipt = await raw.persist();
    expect(receipt.byteCount).toBeGreaterThan(180 * 1024 * 1024);
    expect(receipt.byteCount).toBe(sourceBytes);
    expect(receipt.rawArtifactHash).toBe(sourceHash.digest("hex"));
    expect(uploadBytes).toBe(receipt.byteCount);
    expect(uploadMaxChunk).toBeLessThanOrEqual(256 * 1024);
    let parsed = 0;
    for await (const offer of parseYrl2010(raw.open(), { limits: intake.yrlParserLimits })) {
      expect(offer.element.attributes[0]?.value).toBe(`synthetic-${parsed}`);
      parsed++;
      if (parsed % 32 === 0) sample();
    }
    expect(parsed).toBe(recordCount);
    // Native typed-array storage cannot hold even one complete source body.
    // RSS is recorded separately: allocator/GC state is not a fixed RSS budget.
    const arrayBufferGrowth = Math.max(0, peakArrayBuffers - baseline.arrayBuffers);
    expect(arrayBufferGrowth).toBeLessThan(128 * 1024 * 1024);
    expect(arrayBufferGrowth).toBeLessThan(receipt.byteCount);
    expect(send).toHaveBeenCalledTimes(1);
    const evidence = { proof: "large_feed_streaming", feedBytes: receipt.byteCount, records: parsed, maxUploadChunkBytes: uploadMaxChunk, peakArrayBufferGrowthBytes: arrayBufferGrowth, peakRssGrowthBytes: Math.max(0, peakRss - baseline.rss), storage: "real adapter; mocked SDK transport", parser: "real YRL", network: "synthetic dependency" };
    const evidenceDirectory = resolve(import.meta.dirname, "../.local/evidence");
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(resolve(evidenceDirectory, "mp-02-large-feed-streaming.json"), JSON.stringify(evidence, null, 2));
  } finally { await raw.dispose(); sdk.destroy(); }
  expect(abort).toHaveBeenCalled();
}, 120_000);
