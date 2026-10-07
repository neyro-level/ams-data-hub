import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ClaimedReliabilityEvent } from "../application/ports/reliability-repository.ts";

export interface OperationalOutboxLeaseScope {
  organizationId: string;
  projectId: string;
  topic: string;
  payload: Record<string, unknown>;
}

/** Caller owns the short ReadCommitted transaction and must acquire global
 * safety, then any domain/publication locks BEFORE this fence. Never perform
 * external IO or acquire a domain/global lock after it. Locks survive until
 * the caller's atomic domain + request commit/rollback. This does not settle
 * either the outbox or a business request and grants no new mutation rights. */
export async function lockOperationalOutboxLease(
  transaction: DatabaseTransaction,
  lease: ClaimedReliabilityEvent,
  scope: OperationalOutboxLeaseScope,
): Promise<void> {
  const acquiredAt = new Date(lease.leaseAcquiredAt);
  if (!scope.organizationId || !scope.projectId || !scope.topic
    || scope.payload.organizationId !== scope.organizationId || scope.payload.projectId !== scope.projectId
    || scope.payload.schemaVersion !== 1 || lease.schemaVersion !== 1
    || !Number.isSafeInteger(lease.attempt) || lease.attempt < 1
    || !Number.isFinite(acquiredAt.getTime()) || acquiredAt.toISOString() !== lease.leaseAcquiredAt
    || lease.organizationId !== scope.organizationId || lease.topic !== scope.topic) {
    throw new Error("OUTBOX_OPERATION_LEASE_INVALID");
  }
  const allowed = await transaction.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`
    SELECT current_setting('app.principal_kind', true) = 'project-job'
      AND current_setting('app.actor_id', true) = 'operations-executor'
      AND current_setting('app.organization_id', true) = ${scope.organizationId}
      AND current_setting('app.project_ids', true) = ${scope.projectId} AS allowed`);
  if (allowed[0]?.allowed !== true) throw new Error("OUTBOX_OPERATION_SCOPE_DENIED");

  // Separate queries make the row-lock order explicit: event, then job. A
  // takeover/claim must wait on this event before it can change the job fence.
  const events = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "OutboxEvent" WHERE "id" = ${lease.outboxEventId}
      AND "organizationId" = ${scope.organizationId} AND "topic" = ${scope.topic}
      AND "schemaVersion" = 1 AND "payload" = ${JSON.stringify(scope.payload)}::jsonb
      AND "payload" = ${JSON.stringify(lease.payload)}::jsonb AND "correlationId" = ${lease.correlationId}
      AND "status" = 'PROCESSING' AND "attempts" = ${lease.attempt}
      AND "lockedBy" = ${lease.workerId} AND "lockedAt" = ${acquiredAt}
    FOR UPDATE`);
  if (events.length !== 1) throw new Error("OUTBOX_OPERATION_LEASE_LOST");
  const jobs = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "JobRun" WHERE "id" = ${lease.jobRunId}
      AND "outboxEventId" = ${lease.outboxEventId} AND "organizationId" = ${scope.organizationId}
      AND "jobType" = ${scope.topic} AND "attempt" = ${lease.attempt}
      AND "correlationId" = ${lease.correlationId}
      AND "status" = 'RUNNING' AND "workerId" = ${lease.workerId} AND "startedAt" = ${acquiredAt}
    FOR UPDATE`);
  if (jobs.length !== 1) throw new Error("OUTBOX_OPERATION_LEASE_LOST");
}
