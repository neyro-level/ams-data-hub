import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { createHash, createPublicKey, verify } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

export const SNAPSHOT_DATASET_KINDS = [
  "geo", "developers", "developments", "buildings", "prices", "media", "inventory",
  "agents", "project/contacts", "editorial", "urls", "redirects", "lifecycle",
] as const;
export type SnapshotDatasetKind = (typeof SNAPSHOT_DATASET_KINDS)[number];

const identifier = z.string().trim().min(1).max(240);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const fileSchema = z.object({
  kind: z.enum(SNAPSHOT_DATASET_KINDS), key: z.string().min(1).max(512), sha256,
  bytes: z.number().int().nonnegative(), count: z.number().int().nonnegative(),
}).strict();
const unsignedManifestSchema = z.object({
  schemaMajor: z.number().int().positive(), schemaMinor: z.number().int().nonnegative(), projectId: identifier,
  publishSequence: z.number().int().positive(), generatedAt: z.iso.datetime({ offset: true }),
  publishedAt: z.iso.datetime({ offset: true }), catalogRevision: identifier,
  sourceRevisions: z.array(identifier), files: z.array(fileSchema), keyId: identifier,
}).strict();
export const snapshotManifestV1Schema = unsignedManifestSchema.extend({ signature: z.string().min(1).max(4096) }).strict();
export type SnapshotManifestV1 = z.infer<typeof snapshotManifestV1Schema>;

export interface SnapshotTrustSet {
  currentKeyId: string;
  nextKeyId: string | null;
  publicKeys: Readonly<Record<string, string>>;
  revokedKeyIds: readonly string[];
}
export interface SnapshotAcceptanceState { projectId: string; schemaMajor: number; publishSequence: number }
export type SnapshotVerifierRejection =
  | "MANIFEST_INVALID" | "UNKNOWN_KEY_ID" | "REVOKED_KEY_ID" | "INVALID_SIGNATURE"
  | "PROJECT_MISMATCH" | "SCHEMA_MAJOR_UNSUPPORTED" | "STALE_PUBLISH_SEQUENCE"
  | "DATASET_SET_INVALID" | "FILE_MISSING" | "FILE_BYTES_MISMATCH" | "FILE_HASH_MISMATCH"
  | "FILE_GZIP_INVALID" | "DATASET_SCHEMA_INVALID" | "REFERENCE_INTEGRITY_INVALID";

export interface SnapshotVerifierPolicy {
  datasetSchemas: Readonly<Record<SnapshotDatasetKind, z.ZodType<readonly unknown[]>>>;
  validateReferences(datasets: Readonly<Record<SnapshotDatasetKind, readonly unknown[]>>): boolean;
}
export interface VerifySnapshotInput {
  manifest: unknown;
  files: Readonly<Record<string, Uint8Array>>;
  trustSet: SnapshotTrustSet;
  expectedProjectId: string;
  supportedSchemaMajor: number;
  lastGood: SnapshotAcceptanceState | null;
}
export type VerifySnapshotResult =
  | { accepted: true; manifest: SnapshotManifestV1; datasets: Readonly<Record<SnapshotDatasetKind, readonly unknown[]>>; nextState: SnapshotAcceptanceState }
  | { accepted: false; reason: SnapshotVerifierRejection; nextState: SnapshotAcceptanceState | null };

function signingPayload(manifest: SnapshotManifestV1): Uint8Array {
  const unsigned = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "signature"));
  return canonicalJsonBytes(unsigned as CanonicalJsonValue);
}
function digest(body: Uint8Array): string { return createHash("sha256").update(body).digest("hex"); }

export function createSnapshotVerifier(policy: SnapshotVerifierPolicy) {
  return function verifySnapshot(input: VerifySnapshotInput): VerifySnapshotResult {
    const reject = (reason: SnapshotVerifierRejection): VerifySnapshotResult => ({ accepted: false, reason, nextState: input.lastGood });
    const parsed = snapshotManifestV1Schema.safeParse(input.manifest);
    if (!parsed.success) return reject("MANIFEST_INVALID");
    const manifest = parsed.data;
    if (input.trustSet.revokedKeyIds.includes(manifest.keyId)) return reject("REVOKED_KEY_ID");
    const allowed = new Set([input.trustSet.currentKeyId, input.trustSet.nextKeyId].filter((value): value is string => value !== null));
    const publicKey = input.trustSet.publicKeys[manifest.keyId];
    if (!allowed.has(manifest.keyId) || !publicKey) return reject("UNKNOWN_KEY_ID");
    try {
      const key = createPublicKey(publicKey);
      if (key.asymmetricKeyType !== "ed25519" || !verify(null, signingPayload(manifest), key, Buffer.from(manifest.signature, "base64url"))) return reject("INVALID_SIGNATURE");
    } catch { return reject("INVALID_SIGNATURE"); }
    if (manifest.projectId !== input.expectedProjectId) return reject("PROJECT_MISMATCH");
    if (manifest.schemaMajor !== input.supportedSchemaMajor) return reject("SCHEMA_MAJOR_UNSUPPORTED");
    if (input.lastGood && manifest.publishSequence <= input.lastGood.publishSequence) return reject("STALE_PUBLISH_SEQUENCE");
    const kinds = manifest.files.map((file) => file.kind);
    if (kinds.length !== SNAPSHOT_DATASET_KINDS.length || new Set(kinds).size !== kinds.length || SNAPSHOT_DATASET_KINDS.some((kind) => !kinds.includes(kind))) return reject("DATASET_SET_INVALID");
    const datasets = {} as Record<SnapshotDatasetKind, readonly unknown[]>;
    for (const file of manifest.files) {
      const body = input.files[file.key];
      if (!body) return reject("FILE_MISSING");
      if (body.byteLength !== file.bytes) return reject("FILE_BYTES_MISMATCH");
      if (digest(body) !== file.sha256) return reject("FILE_HASH_MISMATCH");
      let value: unknown;
      try { value = JSON.parse(gunzipSync(body).toString("utf8")); } catch { return reject("FILE_GZIP_INVALID"); }
      const dataset = policy.datasetSchemas[file.kind].safeParse(value);
      if (!dataset.success || dataset.data.length !== file.count) return reject("DATASET_SCHEMA_INVALID");
      datasets[file.kind] = dataset.data;
    }
    if (!policy.validateReferences(datasets)) return reject("REFERENCE_INTEGRITY_INVALID");
    return { accepted: true, manifest, datasets, nextState: { projectId: manifest.projectId, schemaMajor: manifest.schemaMajor, publishSequence: manifest.publishSequence } };
  };
}
