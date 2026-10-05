import type { CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { z } from "zod";

export const SNAPSHOT_DATASET_KINDS = [
  "geo",
  "developers",
  "developments",
  "buildings",
  "prices",
  "media",
  "inventory",
  "agents",
  "project/contacts",
  "editorial",
  "urls",
  "redirects",
  "lifecycle",
] as const;

export const snapshotDatasetKindSchema = z.enum(SNAPSHOT_DATASET_KINDS);
export type SnapshotDatasetKind = z.infer<typeof snapshotDatasetKindSchema>;

const snapshotIdentifierSchema = z.string().trim().min(1).max(240);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

export interface SnapshotRecordReference {
  kind: SnapshotDatasetKind;
  key: string;
}

export interface SnapshotRecordInput {
  key: string;
  value: CanonicalJsonValue;
  references?: readonly SnapshotRecordReference[];
}

export interface SnapshotDatasetInput {
  kind: SnapshotDatasetKind;
  records: readonly SnapshotRecordInput[];
}

export const snapshotFileManifestSchema = z.object({
  kind: snapshotDatasetKindSchema,
  key: z.string().min(1).max(512),
  sha256: sha256Schema,
  bytes: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
}).strict();

export const unsignedSnapshotManifestV1Schema = z.object({
  schemaMajor: z.literal(1),
  schemaMinor: z.number().int().nonnegative(),
  projectId: snapshotIdentifierSchema,
  publishSequence: z.number().int().positive(),
  generatedAt: isoDateTimeSchema,
  publishedAt: isoDateTimeSchema,
  catalogRevision: snapshotIdentifierSchema,
  sourceRevisions: z.array(snapshotIdentifierSchema),
  files: z.array(snapshotFileManifestSchema),
  keyId: snapshotIdentifierSchema,
}).strict();

export const snapshotManifestV1Schema = unsignedSnapshotManifestV1Schema.extend({
  signature: z.string().min(1).max(4096),
}).strict();

export type SnapshotFileManifest = z.infer<typeof snapshotFileManifestSchema>;
export type UnsignedSnapshotManifestV1 = z.infer<typeof unsignedSnapshotManifestV1Schema>;
export type SnapshotManifestV1 = z.infer<typeof snapshotManifestV1Schema>;

export interface SnapshotFileArtifact {
  manifest: SnapshotFileManifest;
  body: Uint8Array;
}

export interface ComposeSnapshotInput {
  schemaMinor: number;
  projectId: string;
  publishSequence: number;
  generatedAt: string;
  publishedAt: string;
  catalogRevision: string;
  sourceRevisions: readonly string[];
  keyId: string;
  requiresProjectContact: boolean;
  datasets: readonly SnapshotDatasetInput[];
}

export interface SnapshotComposition {
  manifest: UnsignedSnapshotManifestV1;
  manifestPayload: Uint8Array;
  files: readonly SnapshotFileArtifact[];
}

export interface SnapshotSigner {
  readonly keyId: string;
  sign(payload: Uint8Array): Promise<Uint8Array>;
}

export interface SnapshotTrustSet {
  currentKeyId: string;
  nextKeyId: string | null;
  publicKeys: Readonly<Record<string, string>>;
  revokedKeyIds: readonly string[];
}

export interface SnapshotAcceptanceState {
  projectId: string;
  schemaMajor: number;
  publishSequence: number;
}

export type SnapshotVerificationRejection =
  | "UNKNOWN_KEY_ID"
  | "REVOKED_KEY_ID"
  | "INVALID_SIGNATURE"
  | "PROJECT_MISMATCH"
  | "SCHEMA_MAJOR_UNSUPPORTED"
  | "STALE_PUBLISH_SEQUENCE";

export type SnapshotVerificationResult =
  | { accepted: true; nextState: SnapshotAcceptanceState }
  | { accepted: false; reason: SnapshotVerificationRejection; nextState: SnapshotAcceptanceState | null };

export type PublicLocationPrecision = "EXACT" | "STREET" | "DISTRICT";

export interface PublicCoordinatesInput {
  latitude: number;
  longitude: number;
  entityUid: string;
  policyVersion: string;
  precision: PublicLocationPrecision;
}

export interface PublicCoordinates {
  latitude: number;
  longitude: number;
}

export const deliveryRunStatusSchema = z.enum([
  "PENDING",
  "NOTIFIED",
  "DOWNLOADED",
  "APPLIED",
  "ACKNOWLEDGED",
  "FAILED",
  "STALE",
]);
export type DeliveryRunStatus = z.infer<typeof deliveryRunStatusSchema>;

export interface CurrentSnapshotManifest {
  organizationId: string;
  projectId: string;
  publishSequence: number;
  manifestKey: string;
  manifestSha256: string;
  publishedAt: Date;
}

export interface DeliveryRun extends CurrentSnapshotManifest {
  deliveryRunId: string;
  status: DeliveryRunStatus;
  notifiedAt: Date | null;
  downloadedAt: Date | null;
  appliedAt: Date | null;
  acknowledgedAt: Date | null;
  failedAt: Date | null;
  staleAt: Date | null;
  safeErrorCode: string | null;
  ackIdempotencyKeyHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectAckCredential {
  organizationId: string;
  projectId: string;
  currentTokenHash: string;
  nextTokenHash: string | null;
  version: number;
}
