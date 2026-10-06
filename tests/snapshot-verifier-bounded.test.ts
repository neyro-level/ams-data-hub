import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import {
  createSnapshotVerifier, SNAPSHOT_DATASET_KINDS, type SnapshotDatasetKind,
  type SnapshotManifestV1, type SnapshotVerifierPolicy, type VerifySnapshotInput,
} from "@ams-data-hub/snapshot-verifier";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("node:zlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:zlib")>();
  return { ...actual, gunzipSync: vi.fn(actual.gunzipSync) };
});

const keys = generateKeyPairSync("ed25519");
const schemas = Object.fromEntries(SNAPSHOT_DATASET_KINDS.map((kind) => [kind, z.array(z.unknown())])) as unknown as SnapshotVerifierPolicy["datasetSchemas"];
const lastGood = { projectId: "synthetic-project", schemaMajor: 1, publishSequence: 1 };

function signedInput(replacements: Partial<Record<SnapshotDatasetKind, { body: Uint8Array; count: number }>> = {}): VerifySnapshotInput {
  const files: Record<string, Uint8Array> = {};
  const unsigned = {
    schemaMajor: 1, schemaMinor: 0, projectId: "synthetic-project", publishSequence: 2,
    generatedAt: "2026-10-06T00:00:00.000Z", publishedAt: "2026-10-06T00:00:00.000Z",
    catalogRevision: "synthetic-catalog", sourceRevisions: [], keyId: "synthetic-key",
    files: SNAPSHOT_DATASET_KINDS.map((kind) => {
      const candidate = replacements[kind] ?? { body: gzipSync("[]"), count: 0 };
      files[kind] = candidate.body;
      return { kind, key: kind, sha256: createHash("sha256").update(candidate.body).digest("hex"), bytes: candidate.body.byteLength, count: candidate.count };
    }),
  };
  const manifest: SnapshotManifestV1 = { ...unsigned, signature: sign(null, canonicalJsonBytes(unsigned as CanonicalJsonValue), keys.privateKey).toString("base64url") };
  return { manifest, files, trustSet: { currentKeyId: "synthetic-key", nextKeyId: null, revokedKeyIds: [], publicKeys: { "synthetic-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } }, expectedProjectId: lastGood.projectId, supportedSchemaMajor: 1, lastGood };
}

function bounded(policy: Partial<SnapshotVerifierPolicy> = {}) {
  return createSnapshotVerifier({ datasetSchemas: schemas, validateReferences: () => true, ...policy });
}

beforeEach(() => { vi.mocked(gunzipSync).mockClear(); });

describe("bounded snapshot decompression", () => {
  it("rejects a correctly signed gzip bomb at the native output boundary before caller schemas", () => {
    const parse = vi.fn();
    const bomb = gzipSync(JSON.stringify(["x".repeat(131_072)]));
    const input = signedInput({ geo: { body: bomb, count: 1 } });
    const result = bounded({ maxDecompressedFileBytes: 1024, datasetSchemas: { ...schemas, geo: z.array(z.unknown()).superRefine(parse) } })(input);
    expect(result).toMatchObject({ accepted: false, reason: "SNAPSHOT_LIMIT_EXCEEDED" });
    expect(result.nextState).toBe(lastGood);
    expect(parse).not.toHaveBeenCalled();
    expect(gunzipSync).toHaveBeenCalledExactlyOnceWith(bomb, { maxOutputLength: 1024 });
  });

  it("charges concatenated gzip members against one output budget, while accepting a bounded equivalent encoding", () => {
    const body = Buffer.concat([gzipSync('["ab'), gzipSync('cd"]')]);
    const input = signedInput({ geo: { body, count: 1 } });
    expect(bounded({ maxDecompressedFileBytes: 7 })(input)).toMatchObject({ accepted: false, reason: "SNAPSHOT_LIMIT_EXCEEDED" });
    const result = bounded({ maxDecompressedFileBytes: 8 })(input);
    expect(result).toMatchObject({ accepted: true, datasets: { geo: ["abcd"] } });
  });

  it("uses the remaining combined compressed/decoded budget and permits exact boundaries", () => {
    const json = JSON.stringify(["x".repeat(124)]);
    const input = signedInput({ geo: { body: gzipSync(json), count: 1 } });
    const compressed = (input.manifest as SnapshotManifestV1).files.reduce((sum, file) => sum + file.bytes, 0);
    const total = compressed + Buffer.byteLength(json) + 12 * 2;
    expect(bounded({ maxDecompressedFileBytes: 128, maxTotalSnapshotBytes: total })(input)).toMatchObject({ accepted: true });
    const result = bounded({ maxDecompressedFileBytes: 128, maxTotalSnapshotBytes: total - 1 })(input);
    expect(result).toMatchObject({ accepted: false, reason: "SNAPSHOT_LIMIT_EXCEEDED" });
    expect(result.nextState).toBe(lastGood);
    expect(vi.mocked(gunzipSync).mock.calls.at(-1)?.[1]).toEqual({ maxOutputLength: 1 });
  });

  it("checks raw record cardinality before Zod can hide it with a shrinking transform", () => {
    const transform = vi.fn(() => [0]);
    const input = signedInput({ geo: { body: gzipSync(JSON.stringify(Array(5).fill(0))), count: 1 } });
    const result = bounded({ maxDatasetRecords: 4, datasetSchemas: { ...schemas, geo: z.array(z.unknown()).transform(transform) } })(input);
    expect(result).toMatchObject({ accepted: false, reason: "SNAPSHOT_LIMIT_EXCEEDED" });
    expect(transform).not.toHaveBeenCalled();
    expect(result.nextState).toBe(lastGood);
  });

  it("rejects signed raw-count mismatches, non-arrays and changed transformed counts", () => {
    const rawMismatch = signedInput({ geo: { body: gzipSync("[0,1]"), count: 1 } });
    expect(bounded()(rawMismatch)).toMatchObject({ accepted: false, reason: "DATASET_SCHEMA_INVALID" });
    expect(bounded()(signedInput({ geo: { body: gzipSync("{}"), count: 0 } }))).toMatchObject({ accepted: false, reason: "DATASET_SCHEMA_INVALID" });
    const input = signedInput({ geo: { body: gzipSync("[0]"), count: 1 } });
    expect(bounded({ datasetSchemas: { ...schemas, geo: z.array(z.unknown()).transform(() => [0, 1]) } })(input)).toMatchObject({ accepted: false, reason: "DATASET_SCHEMA_INVALID" });
  });

  it.each([Buffer.from("broken"), gzipSync("not-json"), gzipSync(Buffer.from([91, 34, 195, 40, 34, 93])), gzipSync("\ufeff[]")])("rejects malformed gzip/JSON/UTF-8 without lossy reinterpretation", (body) => {
    const result = bounded()(signedInput({ geo: { body, count: 0 } }));
    expect(result).toMatchObject({ accepted: false, reason: "FILE_GZIP_INVALID" });
    expect(result.nextState).toBe(lastGood);
  });

  it("contains schema/reference exceptions and preserves last-good", () => {
    const input = signedInput();
    const schemaFailure = bounded({ datasetSchemas: { ...schemas, geo: z.array(z.unknown()).transform(() => { throw new Error("synthetic"); }) } })(input);
    expect(schemaFailure).toMatchObject({ accepted: false, reason: "DATASET_SCHEMA_INVALID" });
    expect(schemaFailure.nextState).toBe(lastGood);
    const referencesFailure = bounded({ validateReferences: () => { throw new Error("synthetic"); } })(input);
    expect(referencesFailure).toMatchObject({ accepted: false, reason: "REFERENCE_INTEGRITY_INVALID" });
    expect(referencesFailure.nextState).toBe(lastGood);
  });
});
