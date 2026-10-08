import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { rawArtifactRetentionPolicySchema, type RawArtifactRetentionPolicy } from "../domain/raw-artifact-retention.ts";

type Scope = { organizationId: string; projectId: string };
const auditId = (id: string) => `raw-delete:${id}`;
type RemovalAvailability = "PRESENT" | "REMOVED" | "UNKNOWN" | null;
function availability(deleted: { requestedAt: Date; completedAt: Date | null } | null,
  put: { createdAt: Date; storedAt: Date | null } | null): RemovalAvailability {
  if (!deleted) return null;
  if (!deleted.completedAt) throw new Error("RAW_RETENTION_JOURNAL_INVALID");
  return !put ? "REMOVED" : put.storedAt && put.createdAt > deleted.completedAt && put.storedAt >= put.createdAt
    ? "PRESENT" : put.storedAt && put.storedAt < deleted.requestedAt ? "REMOVED" : "UNKNOWN";
}
function assertAudit(scope: Scope, deletionId: string, audit: { organizationId: string | null; action: string;
  entityType: string; entityId: string | null; afterMarker: Prisma.JsonValue | null } | null) {
  const marker = audit?.afterMarker as Record<string, unknown> | null;
  if (!audit || audit.organizationId !== scope.organizationId || audit.action !== "source.raw-artifact.deleted"
    || audit.entityType !== "RawArtifactDeletion" || audit.entityId !== deletionId || !marker
    || marker.status !== "DELETED" || marker.projectId !== scope.projectId || marker.currentKeyRemoved !== true
    || Object.keys(marker).length !== 3) throw new Error("RAW_RETENTION_DELETION_AUDIT_MISSING");
}

/** Transaction-bound journal only; never performs external IO. Caller owns guardian/global fence. */
export function createRawArtifactDeletionRepository(tx: DatabaseTransaction) {
  const assertScope = async (scope: Scope) => {
    const rows = await tx.$queryRaw<{ allowed: boolean; isolation: string }[]>(Prisma.sql`
      SELECT public.raw_artifact_retention_scope(${scope.organizationId},${scope.projectId}) AS allowed,
        current_setting('transaction_isolation') AS isolation`);
    if (rows.length !== 1 || rows[0]!.allowed !== true || rows[0]!.isolation !== "read committed")
      throw new Error("RAW_RETENTION_ACCESS_DENIED");
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0))::text`);
  };
  return {
    async list(scope: Scope) {
      await assertScope(scope);
      const rows = await tx.rawArtifactDeletion.findMany({ where: scope, orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
        take: 5001, select: { rawArtifactHash: true, status: true } });
      if (rows.length > 5000) throw new Error("RAW_RETENTION_JOURNAL_LIMIT");
      return rows;
    },
    async readAvailability(scope: Scope, hashes: readonly string[]) {
      await assertScope(scope);
      if (hashes.length > 5000) throw new Error("RAW_RETENTION_JOURNAL_LIMIT");
      const where = { ...scope, rawArtifactHash: { in: [...hashes] } };
      const [deleted, puts] = await Promise.all([
        tx.rawArtifactDeletion.findMany({ where: { ...where, status: "DELETED" }, take: 5001,
          orderBy: [{ completedAt: "desc" }, { id: "desc" }], select: { id: true, rawArtifactHash: true, requestedAt: true, completedAt: true } }),
        tx.rawArtifactPutAttempt.findMany({ where: { ...where, status: "STORED" }, take: 5001,
          orderBy: [{ createdAt: "desc" }, { revisionId: "desc" }], select: { rawArtifactHash: true, createdAt: true, storedAt: true } }),
      ]);
      if (deleted.length > 5000 || puts.length > 5000) throw new Error("RAW_RETENTION_JOURNAL_LIMIT");
      const latestDeleted = new Map<string, (typeof deleted)[number]>(); const latestPut = new Map<string, (typeof puts)[number]>();
      for (const row of deleted) if (!latestDeleted.has(row.rawArtifactHash)) latestDeleted.set(row.rawArtifactHash, row);
      for (const row of puts) if (!latestPut.has(row.rawArtifactHash)) latestPut.set(row.rawArtifactHash, row);
      const audits = await tx.auditEvent.findMany({ where: { id: { in: [...latestDeleted.values()].map((row) => auditId(row.id)) } },
        select: { id: true, organizationId: true, action: true, entityType: true, entityId: true, afterMarker: true } });
      const indexedAudits = new Map(audits.map((row) => [row.id, row]));
      return new Map(hashes.map((hash) => {
        const removal = latestDeleted.get(hash) ?? null;
        if (removal) assertAudit(scope, removal.id, indexedAudits.get(auditId(removal.id)) ?? null);
        return [hash, availability(removal, latestPut.get(hash) ?? null)] as const;
      }));
    },
    async readTarget(scope: Scope, rawArtifactHash: string) {
      await assertScope(scope);
      const where = { ...scope, rawArtifactHash };
      const unsettled = await tx.rawArtifactDeletion.findMany({ where: { ...where, status: { in: ["PENDING", "ACKNOWLEDGED"] } },
        take: 2, select: { id: true, status: true } });
      if (unsettled.length > 1) throw new Error("RAW_RETENTION_JOURNAL_INVALID");
      const deleted = await tx.rawArtifactDeletion.findFirst({ where: { ...where, status: "DELETED" },
        orderBy: [{ completedAt: "desc" }, { id: "desc" }], select: { id: true, requestedAt: true, completedAt: true } });
      let state: RemovalAvailability = null;
      if (deleted) {
        const audit = await tx.auditEvent.findUnique({ where: { id: auditId(deleted.id) },
          select: { organizationId: true, action: true, entityType: true, entityId: true, afterMarker: true } });
        assertAudit(scope, deleted.id, audit);
        const put = await tx.rawArtifactPutAttempt.findFirst({ where: { ...where, status: "STORED" },
          orderBy: [{ createdAt: "desc" }, { revisionId: "desc" }], select: { createdAt: true, storedAt: true } });
        // A late settlement alone is not resurrection. The PUT intent must have
        // begun strictly after terminal deletion. Equal/contradictory clocks hold.
        state = availability(deleted, put);
      }
      return { unsettled: unsettled[0] ?? null, availability: state };
    },
    async admit(scope: Scope, rawArtifactHash: string, policy: RawArtifactRetentionPolicy) {
      await assertScope(scope);
      return tx.rawArtifactDeletion.create({ data: { ...scope, id: randomUUID(), rawArtifactHash,
        storageKey: `source-artifacts/${rawArtifactHash}`, policy: { ...rawArtifactRetentionPolicySchema.parse(policy) } }, select: { id: true } });
    },
    async unknown(scope: Scope, id: string, code: "RAW_DELETE_IO_UNKNOWN" | "RAW_DELETE_LEASE_LOST") {
      await assertScope(scope);
      const result = await tx.rawArtifactDeletion.updateMany({ where: { ...scope, id, status: "PENDING" }, data: { lastFailureCode: code } });
      if (result.count !== 1) throw new Error("RAW_RETENTION_JOURNAL_INVALID");
    },
    async acknowledge(scope: Scope, id: string) {
      await assertScope(scope);
      const count = await tx.$executeRaw(Prisma.sql`UPDATE public."RawArtifactDeletion"
        SET status='ACKNOWLEDGED',"acknowledgedAt"=clock_timestamp()::timestamptz(3),"lastFailureCode"=NULL
        WHERE id=${id} AND "organizationId"=${scope.organizationId} AND "projectId"=${scope.projectId} AND status='PENDING'`);
      if (count !== 1) throw new Error("RAW_RETENTION_JOURNAL_INVALID");
    },
    async complete(scope: Scope, id: string, correlationId: string) {
      await assertScope(scope);
      await tx.auditEvent.create({ data: { id: auditId(id), organizationId: scope.organizationId, actorType: "SYSTEM",
        actorId: "raw-artifact-retention", action: "source.raw-artifact.deleted", entityType: "RawArtifactDeletion", entityId: id,
        afterMarker: { status: "DELETED", projectId: scope.projectId, currentKeyRemoved: true }, source: "ingestion-core", correlationId } });
      const count = await tx.$executeRaw(Prisma.sql`UPDATE public."RawArtifactDeletion"
        SET status='DELETED',"completedAt"=clock_timestamp()::timestamptz(3)
        WHERE id=${id} AND "organizationId"=${scope.organizationId} AND "projectId"=${scope.projectId} AND status='ACKNOWLEDGED'`);
      if (count !== 1) throw new Error("RAW_RETENTION_JOURNAL_INVALID");
    },
  };
}
