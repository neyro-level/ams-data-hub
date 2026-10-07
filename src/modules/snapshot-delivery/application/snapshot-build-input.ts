import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { createHash } from "node:crypto";
import { z } from "zod";

/** Private fact sections, not public datasets. Projection must use their allowlists. */
export const SNAPSHOT_INPUT_PART_KINDS = [
  "project", "subscription", "sources", "inventory", "catalog", "media", "agents",
  "contacts", "editorial", "media-order", "url-policy", "urls", "redirects", "tombstones",
  "listing-links", "prices", "shared-media", "lifecycle",
] as const;
export type SnapshotInputPartKind = typeof SNAPSHOT_INPUT_PART_KINDS[number];
export const SNAPSHOT_INPUT_SCHEMA_VERSION = 1;
export const SNAPSHOT_INPUT_PROJECTOR_VERSION = "db-v1";
export const SNAPSHOT_INPUT_PAGE_SIZE = 200;
export const SNAPSHOT_INPUT_MAX_RECORDS = 50_000;
export const SNAPSHOT_INPUT_MAX_BYTES = 32 * 1024 * 1024;
export const SNAPSHOT_INPUT_MAX_PART_BYTES = 1024 * 1024;
export const SNAPSHOT_INPUT_MAX_PARTS = 2048;

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
export const snapshotInputRequestSchema = z.object({
  organizationId: identifier, projectId: identifier,
  idempotencyKey: identifier,
  schemaMinor: z.number().int().min(0).max(2_147_483_647).default(0),
}).strict();
export type SnapshotInputRequest = z.output<typeof snapshotInputRequestSchema>;
export interface SnapshotInputPart {
  kind: SnapshotInputPartKind;
  partIndex: number;
  payload: CanonicalJsonValue[];
  payloadHash: string;
}

export function snapshotInputHash(value: CanonicalJsonValue): string {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}
export function snapshotInputRequestHashes(input: SnapshotInputRequest) {
  const { idempotencyKey, ...parameters } = input;
  return {
    idempotencyKeyHash: snapshotInputHash(idempotencyKey),
    requestHash: snapshotInputHash({ ...parameters, inputSchemaVersion: SNAPSHOT_INPUT_SCHEMA_VERSION,
      projectorVersion: SNAPSHOT_INPUT_PROJECTOR_VERSION }),
  };
}

/** Called incrementally by bounded DB readers. Overflow rejects; never truncates. */
export class SnapshotInputPartsBuilder {
  private readonly values: SnapshotInputPart[] = [];
  private records = 0;
  private bytes = 0;
  private readonly seen = new Set<SnapshotInputPartKind>();
  private readonly counts = new Map<SnapshotInputPartKind, number>();
  private failed = false;

  add(kind: SnapshotInputPartKind, records: readonly CanonicalJsonValue[]): void {
    if (this.failed) throw new Error("SNAPSHOT_INPUT_CAPTURE_FAILED");
    this.failed = true;
    if (!SNAPSHOT_INPUT_PART_KINDS.includes(kind)) throw new Error("SNAPSHOT_INPUT_KIND_INVALID");
    if (records.length > SNAPSHOT_INPUT_PAGE_SIZE || this.values.length >= SNAPSHOT_INPUT_MAX_PARTS) {
      throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
    }
    const encoded = canonicalJsonBytes(records as CanonicalJsonValue[]);
    this.records += records.length;
    this.bytes += encoded.byteLength;
    if (encoded.byteLength > SNAPSHOT_INPUT_MAX_PART_BYTES || this.bytes > SNAPSHOT_INPUT_MAX_BYTES
      || this.records > SNAPSHOT_INPUT_MAX_RECORDS) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
    // Own immutable-by-convention copies; mutation of the DB reader's objects
    // cannot change a hash after the capture boundary.
    const payload = JSON.parse(Buffer.from(encoded).toString("utf8")) as CanonicalJsonValue[];
    const partIndex = this.counts.get(kind) ?? 0;
    this.values.push({ kind, partIndex, payload, payloadHash: snapshotInputHash(payload) });
    this.counts.set(kind, partIndex + 1);
    this.seen.add(kind);
    this.failed = false;
  }

  finish(): SnapshotInputPart[] {
    if (this.failed) throw new Error("SNAPSHOT_INPUT_CAPTURE_FAILED");
    if (this.seen.size !== SNAPSHOT_INPUT_PART_KINDS.length) throw new Error("SNAPSHOT_INPUT_INCOMPLETE");
    return this.values.map((part) => ({ ...part, payload: structuredClone(part.payload) }))
      .sort((a, b) => SNAPSHOT_INPUT_PART_KINDS.indexOf(a.kind) - SNAPSHOT_INPUT_PART_KINDS.indexOf(b.kind)
        || a.partIndex - b.partIndex);
  }
}

export interface SnapshotBuildInputReceipt {
  id: string;
  organizationId: string;
  projectId: string;
  idempotencyKeyHash: string;
  requestHash: string;
  inputSchemaVersion: number;
  projectorVersion: string;
  schemaMinor: number;
  publishSequence: number;
  projectStateRevision: number;
  catalogRevision: string;
  inputHash: string;
  capturedAt: Date;
  parts: SnapshotInputPart[];
}

export function snapshotBuildInputDigest(input: Omit<SnapshotBuildInputReceipt, "id" | "inputHash">): string {
  return snapshotInputHash({
    organizationId: input.organizationId, projectId: input.projectId,
    idempotencyKeyHash: input.idempotencyKeyHash, requestHash: input.requestHash,
    inputSchemaVersion: input.inputSchemaVersion, projectorVersion: input.projectorVersion,
    schemaMinor: input.schemaMinor, publishSequence: input.publishSequence,
    projectStateRevision: input.projectStateRevision, catalogRevision: input.catalogRevision,
    capturedAt: input.capturedAt.toISOString(),
    parts: input.parts.map(({ kind, partIndex, payloadHash }) => ({ kind, partIndex, payloadHash })),
  });
}
