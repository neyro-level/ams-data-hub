import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import {
  createSnapshotVerifier, DEFAULT_SNAPSHOT_VERIFIER_LIMITS, MAX_SNAPSHOT_SOURCE_REVISIONS, SNAPSHOT_DATASET_KINDS, snapshotManifestV1Schema, type SnapshotDatasetKind,
  type SnapshotManifestV1, type SnapshotVerifierPolicy, type VerifySnapshotInput,
} from "@ams-data-hub/snapshot-verifier";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { runInNewContext } from "node:vm";
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

function resignInput(input: VerifySnapshotInput, patch: Partial<SnapshotManifestV1>): VerifySnapshotInput {
  const candidate = { ...input.manifest as SnapshotManifestV1, ...patch };
  const unsigned = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "signature"));
  return { ...input, manifest: { ...candidate, signature: sign(null, canonicalJsonBytes(unsigned as CanonicalJsonValue), keys.privateKey).toString("base64url") } };
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
    expect(gunzipSync).toHaveBeenCalledTimes(1);
    expect(gunzipSync).toHaveBeenCalledWith(Buffer.from(bomb), { maxOutputLength: 1024 });
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

  it("rejects every manifest/file preflight failure before any inflation or caller schema", () => {
    const input = signedInput({ geo: { body: gzipSync(JSON.stringify(["x".repeat(4096)])), count: 1 } });
    const manifest = input.manifest as SnapshotManifestV1;
    const duplicate = manifest.files.map((file, index) => index === 12 ? { ...file, kind: "geo" as const } : file);
    const missingFiles = { ...input.files }; delete missingFiles.lifecycle;
    const damaged = Uint8Array.from(input.files.lifecycle!); damaged[0] ^= 1;
    const cases: Array<[VerifySnapshotInput, string]> = [
      [resignInput(input, { files: duplicate }), "DATASET_SET_INVALID"],
      [resignInput(input, { files: manifest.files.slice(0, 12) }), "DATASET_SET_INVALID"],
      [{ ...input, files: missingFiles }, "FILE_MISSING"],
      [{ ...input, files: { ...input.files, lifecycle: input.files.lifecycle!.slice(1) } }, "FILE_BYTES_MISMATCH"],
      [{ ...input, files: { ...input.files, lifecycle: damaged } }, "FILE_HASH_MISMATCH"],
      [resignInput(input, { schemaMajor: 2 }), "SCHEMA_MAJOR_UNSUPPORTED"],
      [resignInput(input, { projectId: "other-project" }), "PROJECT_MISMATCH"],
      [resignInput(input, { publishSequence: 1 }), "STALE_PUBLISH_SEQUENCE"],
      [{ ...input, trustSet: { ...input.trustSet, revokedKeyIds: ["synthetic-key"] } }, "REVOKED_KEY_ID"],
      [{ ...input, trustSet: { ...input.trustSet, currentKeyId: "unknown" } }, "UNKNOWN_KEY_ID"],
      [{ ...input, manifest: { ...manifest, signature: "invalid" } }, "INVALID_SIGNATURE"],
    ];
    const parse = vi.fn();
    const verify = bounded({ maxDecompressedFileBytes: 1024, datasetSchemas: { ...schemas, geo: z.array(z.unknown()).superRefine(parse) } });
    for (const [candidate, reason] of cases) {
      const result = verify(candidate);
      expect(result).toMatchObject({ accepted: false, reason });
      expect(result.nextState).toBe(lastGood);
    }
    expect(gunzipSync).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it("bounds malformed raw manifest containers/scalars before Zod or signature allocation", () => {
    const input = signedInput();
    const manifest = input.manifest as SnapshotManifestV1;
    const parse = vi.spyOn(snapshotManifestV1Schema, "safeParse");
    try {
      for (const patch of [
        { files: Array(10_000).fill(manifest.files[0]) },
        { sourceRevisions: Array(MAX_SNAPSHOT_SOURCE_REVISIONS + 1).fill("synthetic-revision") },
        { sourceRevisions: ["x".repeat(1025)] },
        { signature: "x".repeat(4097) },
        { projectId: "x".repeat(1025) },
        { schemaMajor: Number.MAX_SAFE_INTEGER + 1 },
      ]) {
        expect(bounded()({ ...input, manifest: { ...manifest, ...patch } })).toMatchObject({ accepted: false, reason: "MANIFEST_INVALID", nextState: lastGood });
      }
      expect(parse).not.toHaveBeenCalled();
      expect(gunzipSync).not.toHaveBeenCalled();
    } finally { parse.mockRestore(); }
  });

  it("retains identifier trim/signature compatibility and ignores unreferenced input files", () => {
    const input = signedInput();
    const manifest = input.manifest as SnapshotManifestV1;
    const padded = { ...manifest, projectId: ` ${manifest.projectId} `, catalogRevision: ` ${manifest.catalogRevision} `, keyId: ` ${manifest.keyId} ` };
    expect(bounded()({ ...input, manifest: padded, files: { ...input.files, unreferenced: Buffer.from("invalid") } })).toMatchObject({ accepted: true });
  });

  it("does not accept inherited storage bodies and uses verified copies after policy callbacks", () => {
    const input = signedInput();
    const inherited = Object.create(input.files) as VerifySnapshotInput["files"];
    expect(bounded()({ ...input, files: inherited })).toMatchObject({ accepted: false, reason: "FILE_MISSING" });
    expect(gunzipSync).not.toHaveBeenCalled();
    const verify = bounded({ datasetSchemas: { ...schemas, geo: z.array(z.unknown()).transform((value) => {
      input.files.lifecycle!.fill(0);
      return value;
    }) } });
    expect(verify(input)).toMatchObject({ accepted: true });
  });

  it("enforces the default factory path against a signed artifact larger than the default decoded ceiling", () => {
    const body = gzipSync(JSON.stringify(["x".repeat(DEFAULT_SNAPSHOT_VERIFIER_LIMITS.maxDecompressedFileBytes)]));
    const result = bounded()(signedInput({ geo: { body, count: 1 } }));
    expect(result).toMatchObject({ accepted: false, reason: "SNAPSHOT_LIMIT_EXCEEDED" });
    expect(result.nextState).toBe(lastGood);
    expect(gunzipSync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(gunzipSync).mock.calls[0]?.[1]).toEqual({ maxOutputLength: DEFAULT_SNAPSHOT_VERIFIER_LIMITS.maxDecompressedFileBytes });
  });

  it("counts decoded UTF-8 bytes and JSON whitespace, not characters or semantic record count", () => {
    const unicode = signedInput({ geo: { body: gzipSync('["é"]'), count: 1 } });
    const bytes = Buffer.byteLength('["é"]');
    expect(bounded({ maxDecompressedFileBytes: bytes - 1 })(unicode)).toMatchObject({ accepted: false, reason: "SNAPSHOT_LIMIT_EXCEEDED" });
    expect(bounded({ maxDecompressedFileBytes: bytes })(unicode)).toMatchObject({ accepted: true, datasets: { geo: ["é"] } });
    const whitespace = signedInput({ geo: { body: gzipSync(`${" ".repeat(2048)}[]`), count: 0 } });
    expect(bounded({ maxDecompressedFileBytes: 1024 })(whitespace)).toMatchObject({ accepted: false, reason: "SNAPSHOT_LIMIT_EXCEEDED" });
  });

  it("bounds compressed bytes before inflation and permits their exact positive boundary", () => {
    const input = signedInput();
    const maxBytes = Math.max(...(input.manifest as SnapshotManifestV1).files.map((file) => file.bytes));
    expect(bounded({ maxCompressedFileBytes: maxBytes })(input)).toMatchObject({ accepted: true });
    vi.mocked(gunzipSync).mockClear();
    expect(bounded({ maxCompressedFileBytes: maxBytes - 1 })(input)).toMatchObject({ accepted: false, reason: "SNAPSHOT_LIMIT_EXCEEDED" });
    const uncompressed = signedInput({ geo: { body: gzipSync(JSON.stringify(["x".repeat(1024)]), { level: 0 }), count: 1 } });
    expect(bounded({ maxCompressedFileBytes: 64 })(uncompressed)).toMatchObject({ accepted: false, reason: "SNAPSHOT_LIMIT_EXCEEDED" });
    expect(gunzipSync).not.toHaveBeenCalled();
  });

  it("charges aliases per dataset without rejecting compatible reused keys", () => {
    const input = signedInput();
    const manifest = input.manifest as SnapshotManifestV1;
    const body = input.files.geo!;
    const alias = resignInput({ ...input, files: { shared: body } }, { files: manifest.files.map((file) => ({ ...file, key: "shared" })) });
    const total = SNAPSHOT_DATASET_KINDS.length * (body.byteLength + 2);
    expect(bounded({ maxTotalSnapshotBytes: total })(alias)).toMatchObject({ accepted: true });
    expect(gunzipSync).toHaveBeenCalledTimes(SNAPSHOT_DATASET_KINDS.length);
    expect(bounded({ maxTotalSnapshotBytes: total - 1 })(alias)).toMatchObject({ accepted: false, reason: "SNAPSHOT_LIMIT_EXCEEDED" });
  });

  it("permits exact source-revision and record-count boundaries", () => {
    const input = signedInput({ geo: { body: gzipSync("[0,1,2,3]"), count: 4 } });
    const revisions = Array<string>(MAX_SNAPSHOT_SOURCE_REVISIONS).fill("synthetic-revision");
    const candidate = resignInput(input, { sourceRevisions: revisions });
    expect(bounded({ maxDatasetRecords: 4 })(candidate)).toMatchObject({ accepted: true });
    vi.mocked(gunzipSync).mockClear();
    expect(bounded({ maxDatasetRecords: 3 })(candidate)).toMatchObject({ accepted: false, reason: "SNAPSHOT_LIMIT_EXCEEDED" });
    expect(gunzipSync).not.toHaveBeenCalled();
  });

  it("preserves native Buffer/cross-realm Uint8Array and shared-buffer compatibility without a hash-to-use gap", () => {
    const input = signedInput();
    const crossRealm = runInNewContext("Uint8Array.from(bytes)", { bytes: [...input.files.geo!] }) as Uint8Array;
    expect(bounded()({ ...input, files: { ...input.files, geo: crossRealm } })).toMatchObject({ accepted: true });
    const shared = new Uint8Array(new SharedArrayBuffer(input.files.lifecycle!.byteLength));
    shared.set(input.files.lifecycle!);
    const candidate = { ...input, files: { ...input.files, lifecycle: shared } };
    const verify = bounded({ datasetSchemas: { ...schemas, geo: z.array(z.unknown()).transform((value) => { shared.fill(0); return value; }) } });
    expect(verify(candidate)).toMatchObject({ accepted: true });
    expect(shared.every((byte) => byte === 0)).toBe(true);
  });

  it("accepts a distinct next Ed25519 key during rotation, but rejects removed/revoked keys before inflation", () => {
    const input = signedInput();
    const next = generateKeyPairSync("ed25519");
    const unsigned = { ...input.manifest as SnapshotManifestV1, keyId: "next-key" };
    const payload = Object.fromEntries(Object.entries(unsigned).filter(([key]) => key !== "signature"));
    const candidate = { ...input, manifest: { ...unsigned, signature: sign(null, canonicalJsonBytes(payload as CanonicalJsonValue), next.privateKey).toString("base64url") }, trustSet: { ...input.trustSet, nextKeyId: "next-key", publicKeys: { ...input.trustSet.publicKeys, "next-key": next.publicKey.export({ format: "pem", type: "spki" }).toString() } } };
    expect(bounded()(candidate)).toMatchObject({ accepted: true });
    vi.mocked(gunzipSync).mockClear();
    expect(bounded()({ ...candidate, trustSet: { ...candidate.trustSet, revokedKeyIds: ["next-key"] } })).toMatchObject({ accepted: false, reason: "REVOKED_KEY_ID" });
    expect(bounded()({ ...candidate, trustSet: { ...candidate.trustSet, nextKeyId: null } })).toMatchObject({ accepted: false, reason: "UNKNOWN_KEY_ID" });
    expect(bounded()({ ...input, trustSet: { ...candidate.trustSet, currentKeyId: "next-key", nextKeyId: null } })).toMatchObject({ accepted: false, reason: "UNKNOWN_KEY_ID" });
    expect(gunzipSync).not.toHaveBeenCalled();
  });

  it("fails closed for an invalid public key or absent last-good and never manufactures acceptance state", () => {
    const input = signedInput();
    const result = bounded()({ ...input, lastGood: null, trustSet: { ...input.trustSet, publicKeys: { "synthetic-key": "invalid" } } });
    expect(result).toEqual({ accepted: false, reason: "INVALID_SIGNATURE", nextState: null });
    expect(gunzipSync).not.toHaveBeenCalled();
  });
});
