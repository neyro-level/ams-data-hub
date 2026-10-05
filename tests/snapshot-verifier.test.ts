import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { createSnapshotVerifier, SNAPSHOT_DATASET_KINDS, type SnapshotManifestV1 } from "@ams-data-hub/snapshot-verifier";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { composeSnapshot, signSnapshotManifest, type SnapshotSigner } from "../src/modules/snapshot-delivery/index.ts";

const keys = generateKeyPairSync("ed25519");
const signer: SnapshotSigner = { keyId: "current-key", async sign(payload) { return Uint8Array.from(sign(null, payload, keys.privateKey)); } };
const publicKey = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
const datasetSchemas = Object.fromEntries(SNAPSHOT_DATASET_KINDS.map((kind) => [kind, z.array(z.unknown())])) as unknown as Record<(typeof SNAPSHOT_DATASET_KINDS)[number], z.ZodType<readonly unknown[]>>;
const verifier = createSnapshotVerifier({ datasetSchemas, validateReferences: () => true });

async function fixture(sequence = 2) {
  const composition = composeSnapshot({
    schemaMinor: 0, projectId: "project-1", publishSequence: sequence,
    generatedAt: "2026-10-05T00:00:00.000Z", publishedAt: "2026-10-05T00:00:01.000Z",
    catalogRevision: `catalog-${sequence}`, sourceRevisions: [], keyId: signer.keyId, requiresProjectContact: true,
    datasets: SNAPSHOT_DATASET_KINDS.map((kind) => ({ kind, records: kind === "project/contacts" ? [{ key: "project-1", value: { phone: "+70000000000" } }] : [] })),
  });
  const manifest = await signSnapshotManifest(composition, signer);
  const files = Object.fromEntries(composition.files.map((file) => [file.manifest.key, file.body]));
  return { manifest, files };
}

const base = { trustSet: { currentKeyId: "current-key", nextKeyId: null, publicKeys: { "current-key": publicKey }, revokedKeyIds: [] }, expectedProjectId: "project-1", supportedSchemaMajor: 1, lastGood: { projectId: "project-1", schemaMajor: 1, publishSequence: 1 } } as const;

function resign(manifest: SnapshotManifestV1, patch: Partial<SnapshotManifestV1>): SnapshotManifestV1 {
  const candidate = { ...manifest, ...patch };
  const unsigned = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "signature"));
  return { ...candidate, signature: sign(null, canonicalJsonBytes(unsigned as CanonicalJsonValue), keys.privateKey).toString("base64url") };
}

describe("snapshot verifier package", () => {
  it("accepts a real Hub-composed and signed snapshot", async () => {
    const snapshot = await fixture();
    expect(verifier({ ...snapshot, ...base })).toMatchObject({ accepted: true, nextState: { publishSequence: 2 } });
  });

  it("rejects bad signature, revoked key and wrong schema without replacing last-good", async () => {
    const snapshot = await fixture();
    expect(verifier({ ...snapshot, manifest: { ...snapshot.manifest, signature: "bad" }, ...base })).toMatchObject({ accepted: false, reason: "INVALID_SIGNATURE", nextState: base.lastGood });
    expect(verifier({ ...snapshot, ...base, trustSet: { ...base.trustSet, revokedKeyIds: ["current-key"] } })).toMatchObject({ accepted: false, reason: "REVOKED_KEY_ID", nextState: base.lastGood });
    expect(verifier({ ...snapshot, manifest: resign(snapshot.manifest, { schemaMajor: 2 }), ...base })).toMatchObject({ accepted: false, reason: "SCHEMA_MAJOR_UNSUPPORTED", nextState: base.lastGood });
  });

  it("rejects exact-byte and SHA-256 mismatches", async () => {
    const snapshot = await fixture();
    const first = snapshot.manifest.files[0]!;
    expect(verifier({ ...snapshot, files: { ...snapshot.files, [first.key]: snapshot.files[first.key]!.slice(1) }, ...base })).toMatchObject({ accepted: false, reason: "FILE_BYTES_MISMATCH" });
    const changed = Uint8Array.from(snapshot.files[first.key]!); changed[changed.length - 1] ^= 1;
    expect(verifier({ ...snapshot, files: { ...snapshot.files, [first.key]: changed }, ...base })).toMatchObject({ accepted: false, reason: "FILE_HASH_MISMATCH" });
  });

  it("rejects stale sequence, invalid Zod data and reference integrity failure", async () => {
    const snapshot = await fixture(1);
    expect(verifier({ ...snapshot, ...base })).toMatchObject({ accepted: false, reason: "STALE_PUBLISH_SEQUENCE" });
    const strictVerifier = createSnapshotVerifier({ ...{ datasetSchemas }, datasetSchemas: { ...datasetSchemas, "project/contacts": z.array(z.object({ email: z.email() }).strict()) }, validateReferences: () => true });
    const newer = await fixture(2);
    expect(strictVerifier({ ...newer, ...base })).toMatchObject({ accepted: false, reason: "DATASET_SCHEMA_INVALID" });
    const referenceVerifier = createSnapshotVerifier({ datasetSchemas, validateReferences: () => false });
    expect(referenceVerifier({ ...newer, ...base })).toMatchObject({ accepted: false, reason: "REFERENCE_INTEGRITY_INVALID" });
  });
});
