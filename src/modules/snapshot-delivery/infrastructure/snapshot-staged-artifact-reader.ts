import "server-only";
import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { snapshotManifestV1Schema, DEFAULT_SNAPSHOT_VERIFIER_LIMITS,
  type SnapshotTrustSet, type SnapshotAcceptanceState } from "@ams-data-hub/snapshot-verifier";
import { z } from "zod";
import { calculateObjectSha256, createProjectSnapshotKey, ProjectSnapshotStorage,
  type ObjectStorage, type BoundedObjectStorage } from "../../../platform/storage/object-storage.ts";
import { verifySnapshotPublicArtifacts } from "../application/snapshot-public-verification.ts";
import { unsignedSnapshotManifestV1Schema, type SnapshotComposition } from "../contracts.ts";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const bindingSchema = z.object({ projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u),
  publishSequence: z.number().int().positive(), manifestSha256: digest,
  manifestCanonical: z.string().max(2 * 1024 * 1024), keyId: z.string().min(1).max(240) }).strict();
type StagedArtifactBinding = z.infer<typeof bindingSchema>;
function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("SNAPSHOT_PUBLICATION_CANCELLED");
}

/** Internal artifact-only seam. Caller must own scoped stage/binding loading and
 * fresh final admission/lease. This function cannot publish or record success. */
type ArtifactReadInput = {
  projectId: string; binding: StagedArtifactBinding; storage: ObjectStorage & BoundedObjectStorage;
  trustSet: SnapshotTrustSet; lastGood: SnapshotAcceptanceState | null; signal?: AbortSignal;
};
async function readVerifiedArtifacts(input: ArtifactReadInput) {
  const binding = bindingSchema.parse(input.binding);
  if (binding.projectId !== input.projectId) throw new Error("SNAPSHOT_PUBLICATION_BINDING_CONFLICT");
  if (input.lastGood && (input.lastGood.projectId !== input.projectId || input.lastGood.schemaMajor !== 1)) {
    throw new Error("SNAPSHOT_PUBLICATION_BINDING_CONFLICT");
  }
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
  cancelled(signal);
  const storage = new ProjectSnapshotStorage(input.projectId, input.storage);
  const bytes = new TextEncoder().encode(binding.manifestCanonical);
  if (bytes.length > 2 * 1024 * 1024 || calculateObjectSha256(bytes) !== binding.manifestSha256) {
    throw new Error("SNAPSHOT_PUBLICATION_BINDING_CONFLICT");
  }
  const manifestKey = createProjectSnapshotKey(input.projectId, binding.manifestSha256);
  const stored = await storage.getBounded({ key: manifestKey, maxBytes: 2 * 1024 * 1024, signal });
  cancelled(signal);
  if (!stored) throw new Error("SNAPSHOT_ARTIFACT_MANIFEST_MISSING");
  if (stored.key !== manifestKey || stored.contentLength !== bytes.length || stored.body.length !== bytes.length
    || calculateObjectSha256(stored.body) !== binding.manifestSha256
    || !Buffer.from(stored.body).equals(bytes)) throw new Error("SNAPSHOT_ARTIFACT_MANIFEST_MISMATCH");
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(stored.body)); }
  catch { throw new Error("SNAPSHOT_ARTIFACT_MANIFEST_INVALID"); }
  const verifyInput = { manifest: raw, files: {}, trustSet: input.trustSet, expectedProjectId: input.projectId,
    supportedSchemaMajor: 1, lastGood: input.lastGood };
  // Portable verifier validates bounded raw shape, trust, signature, scope,
  // sequence, exact dataset set and all declared budgets BEFORE any file GET.
  const preflight = verifySnapshotPublicArtifacts(verifyInput);
  if (preflight.accepted || preflight.reason !== "FILE_MISSING") {
    throw new Error(`SNAPSHOT_ARTIFACT_${preflight.accepted ? "MANIFEST_INVALID" : preflight.reason}`);
  }
  const manifest = snapshotManifestV1Schema.parse(raw);
  if (manifest.publishSequence !== binding.publishSequence || manifest.keyId !== binding.keyId
    || !Buffer.from(canonicalJsonBytes(manifest as CanonicalJsonValue)).equals(bytes)) {
    throw new Error("SNAPSHOT_PUBLICATION_BINDING_CONFLICT");
  }
  for (const file of manifest.files) if (file.key !== `${file.kind}.${file.sha256}.json.gz`) {
    throw new Error("SNAPSHOT_ARTIFACT_FILE_KEY_INVALID");
  }
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  let remaining = DEFAULT_SNAPSHOT_VERIFIER_LIMITS.maxTotalSnapshotBytes;
  for (const file of manifest.files) {
    cancelled(signal);
    const key = createProjectSnapshotKey(input.projectId, file.sha256);
    const object = await storage.getBounded({ key, maxBytes: Math.min(DEFAULT_SNAPSHOT_VERIFIER_LIMITS.maxCompressedFileBytes, remaining), signal });
    cancelled(signal);
    if (!object) throw new Error("SNAPSHOT_ARTIFACT_FILE_MISSING");
    if (object.key !== key || object.contentLength !== file.bytes || object.body.length !== file.bytes) {
      throw new Error("SNAPSHOT_ARTIFACT_FILE_BYTES_MISMATCH");
    }
    if (calculateObjectSha256(object.body) !== file.sha256) throw new Error("SNAPSHOT_ARTIFACT_FILE_HASH_MISMATCH");
    remaining -= object.body.length;
    files[file.key] = object.body;
  }
  cancelled(signal);
  const verified = verifySnapshotPublicArtifacts({ ...verifyInput, files });
  if (!verified.accepted) throw new Error(`SNAPSHOT_ARTIFACT_${verified.reason}`);
  return { verified, files };
}

/** Ordinary selected PUBLISH deliberately does not expose artifact bodies. */
export async function readStagedSnapshotArtifacts(input: ArtifactReadInput) {
  return (await readVerifiedArtifacts(input)).verified;
}

/** Snapshot-private unchanged-file reuse. This does NOT establish DB source
 * approval or historical-key trust; the caller owns those separate boundaries.
 * Identical verifier, limits and bounded reads; no recompression or new IO. */
export async function readStagedSnapshotComposition(input: ArtifactReadInput) {
  const { verified, files } = await readVerifiedArtifacts(input);
  const { signature: _signature, ...unsigned } = verified.manifest; void _signature;
  const manifest = unsignedSnapshotManifestV1Schema.parse(unsigned);
  const composition: SnapshotComposition = { manifest,
    manifestPayload: canonicalJsonBytes(manifest as CanonicalJsonValue),
    files: manifest.files.map((descriptor) => ({ manifest: { ...descriptor }, body: files[descriptor.key]! })) };
  return { verified, composition };
}
