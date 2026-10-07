import "server-only";
import { canonicalJson, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { calculateObjectSha256 } from "../../../platform/storage/object-storage.ts";
import { snapshotManifestV1Schema, type SnapshotManifestV1 } from "../contracts.ts";
import { PrismaSnapshotInputRepository } from "./prisma-snapshot-input-repository.ts";
import { lockSnapshotPublication } from "./snapshot-publication-lock.ts";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const positive = z.number().int().positive().max(2_147_483_647);
const leaseSchema = z.object({ organizationId: id, projectId: id, requestId: id, sourcePublishSequence: positive,
  jobRunId: id, attempt: positive, workerId: z.string().min(1).max(240), leaseAcquiredAt: z.iso.datetime({ offset: true }) }).strict();
export type SnapshotRollbackLease = z.infer<typeof leaseSchema>;
type ApprovedSource = { sourceDeliveryRunId: string; rootBuildInputId: string; inputHash: string;
  manifestCanonical: string; manifestSha256: string; keyId: string; publishedAt: Date };
const content = (manifest: SnapshotManifestV1) => {
  const { publishSequence: _sequence, generatedAt: _generated, publishedAt: _published, keyId: _key, signature: _signature, ...value } = manifest;
  void _sequence; void _generated; void _published; void _key; void _signature;
  return canonicalJson(value as CanonicalJsonValue);
};

/** Snapshot-private identity, no signing/storage/current/result. Every mutable
 * step is fenced by a live full lease; the initial tuple is immutable history.
 * Caller must acquire global -> publication -> input BEFORE Ops request rows. */
export class PrismaSnapshotRollbackRepository {
  constructor(private readonly tx: DatabaseTransaction) {}

  async fence(raw: SnapshotRollbackLease) {
    const lease = leaseSchema.parse(raw);
    await lockSnapshotPublication(this.tx, lease);
    await new PrismaSnapshotInputRepository(this.tx).lockProject(lease.organizationId, lease.projectId);
    await this.tx.$queryRaw(Prisma.sql`SELECT snapshot_rollback_live_lease(${lease.organizationId}, ${lease.projectId}, ${lease.requestId},
      ${lease.sourcePublishSequence}::integer, ${lease.jobRunId}, ${lease.attempt}::integer, ${lease.workerId},
      ${new Date(lease.leaseAcquiredAt)}::timestamptz)::text`);
    return lease;
  }

  async approvedSource(scope: { organizationId: string; projectId: string }, sourcePublishSequence: number) {
    const rows = await this.tx.$queryRaw<ApprovedSource[]>(Prisma.sql`
      SELECT * FROM snapshot_rollback_approved_source(${scope.organizationId}, ${scope.projectId}, ${sourcePublishSequence}::integer)`);
    if (rows.length !== 1) throw new Error("SNAPSHOT_ROLLBACK_SOURCE_NOT_APPROVED");
    const source = rows[0]!;
    if (Buffer.byteLength(source.manifestCanonical) > 2 * 1024 * 1024
      || calculateObjectSha256(new TextEncoder().encode(source.manifestCanonical)) !== source.manifestSha256) throw new Error("SNAPSHOT_ROLLBACK_SOURCE_INVALID");
    const manifest = snapshotManifestV1Schema.parse(JSON.parse(source.manifestCanonical));
    if (manifest.projectId !== scope.projectId || manifest.publishSequence !== sourcePublishSequence || manifest.keyId !== source.keyId
      || manifest.publishedAt !== source.publishedAt.toISOString()
      || canonicalJson(manifest as CanonicalJsonValue) !== source.manifestCanonical) throw new Error("SNAPSHOT_ROLLBACK_SOURCE_INVALID");
    return source;
  }

  async reserve(raw: SnapshotRollbackLease) {
    const lease = await this.fence(raw);
    const scope = { organizationId: lease.organizationId, projectId: lease.projectId };
    const where = { organizationId_projectId_requestId: { ...scope, requestId: lease.requestId } };
    const existing = await this.tx.snapshotRollbackReservation.findUnique({ where });
    if (existing) {
      if (existing.sourcePublishSequence !== lease.sourcePublishSequence) throw new Error("SNAPSHOT_ROLLBACK_RESERVATION_CONFLICT");
      return existing; // No reallocation, timestamp/initial lease mutation or source/key/IO resolution.
    }
    const source = await this.approvedSource(scope, lease.sourcePublishSequence);
    // Fixed same-scope actor only; restore on normal completion, whole rollback on error.
    await this.tx.$executeRaw(Prisma.sql`SELECT set_config('app.actor_id','snapshot-input',true)`);
    const publishSequence = await new PrismaSnapshotInputRepository(this.tx).reserveSequence(scope.organizationId, scope.projectId);
    await this.tx.$executeRaw(Prisma.sql`SELECT set_config('app.actor_id','snapshot-publication',true)`);
    return this.tx.snapshotRollbackReservation.create({ data: { ...scope, requestId: lease.requestId,
      sourceDeliveryRunId: source.sourceDeliveryRunId, sourcePublishSequence: lease.sourcePublishSequence,
      rootBuildInputId: source.rootBuildInputId, inputHash: source.inputHash, publishSequence,
      initialLeaseJobRunId: lease.jobRunId, initialLeaseAttempt: lease.attempt, initialLeaseWorkerId: lease.workerId,
      initialLeaseAcquiredAt: new Date(lease.leaseAcquiredAt) } });
  }

  async bind(raw: SnapshotRollbackLease, candidate: SnapshotManifestV1) {
    const lease = await this.fence(raw); const manifest = snapshotManifestV1Schema.parse(candidate);
    const where = { organizationId_projectId_requestId: { organizationId: lease.organizationId, projectId: lease.projectId, requestId: lease.requestId } };
    const reservation = await this.tx.snapshotRollbackReservation.findUnique({ where });
    if (!reservation || reservation.sourcePublishSequence !== lease.sourcePublishSequence) throw new Error("SNAPSHOT_ROLLBACK_RESERVATION_INVALID");
    const source = await this.approvedSource(lease, lease.sourcePublishSequence);
    if (manifest.projectId !== lease.projectId || manifest.publishSequence !== reservation.publishSequence
      || manifest.generatedAt !== reservation.createdAt.toISOString() || manifest.publishedAt !== reservation.createdAt.toISOString()
      || content(manifest) !== content(snapshotManifestV1Schema.parse(JSON.parse(source.manifestCanonical)))) throw new Error("SNAPSHOT_ROLLBACK_BINDING_INVALID");
    const manifestCanonical = canonicalJson(manifest as CanonicalJsonValue);
    if (Buffer.byteLength(manifestCanonical) > 2 * 1024 * 1024) throw new Error("SNAPSHOT_ROLLBACK_MANIFEST_LIMIT");
    const manifestSha256 = calculateObjectSha256(new TextEncoder().encode(manifestCanonical));
    const existing = await this.tx.snapshotRollbackBinding.findUnique({ where });
    if (existing) {
      if (existing.publishSequence !== manifest.publishSequence || existing.keyId !== manifest.keyId
        || existing.manifestSha256 !== manifestSha256 || existing.manifestCanonical !== manifestCanonical) throw new Error("SNAPSHOT_ROLLBACK_BINDING_CONFLICT");
      return existing;
    }
    return this.tx.snapshotRollbackBinding.create({ data: { ...where.organizationId_projectId_requestId,
      publishSequence: manifest.publishSequence, keyId: manifest.keyId, manifestSha256, manifestCanonical,
      leaseJobRunId: lease.jobRunId, leaseAttempt: lease.attempt, leaseWorkerId: lease.workerId, leaseAcquiredAt: new Date(lease.leaseAcquiredAt) } });
  }

  /** Only after owned manifest PUT has settled and fresh rollback admission.
   * SQL proves lease/identity, not external IO; this is NOT an executable facade. */
  async markStaged(raw: SnapshotRollbackLease) {
    const lease = await this.fence(raw);
    const where = { organizationId_projectId_requestId: { organizationId: lease.organizationId, projectId: lease.projectId, requestId: lease.requestId } };
    const binding = await this.tx.snapshotRollbackBinding.findUnique({ where });
    if (!binding) throw new Error("SNAPSHOT_ROLLBACK_BINDING_INVALID");
    if (binding.stagedAt) return binding;
    return this.tx.snapshotRollbackBinding.update({ where, data: { stagedAt: new Date(), stageLeaseJobRunId: lease.jobRunId,
      stageLeaseAttempt: lease.attempt, stageLeaseWorkerId: lease.workerId, stageLeaseAcquiredAt: new Date(lease.leaseAcquiredAt) } });
  }
}
