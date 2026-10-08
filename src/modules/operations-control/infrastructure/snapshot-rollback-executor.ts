import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction, type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ClaimedReliabilityEvent } from "../../platform-operations/index.ts";
import { createSnapshotRollbackServer, inspectSnapshotRollbackRunServer } from "../../snapshot-delivery/server.ts";
import { operationalActionIntentSchema } from "../contracts.ts";
import { OperationalActionLifecycleRepository } from "./operational-action-lifecycle.ts";

export function createOperationalSnapshotRollbackExecutor(dependencies: {
  resolveRollback(scope: { organizationId: string; projectId: string }): Parameters<typeof createSnapshotRollbackServer>[0]
    | Promise<Parameters<typeof createSnapshotRollbackServer>[0]>;
}) {
  return async (lease: ClaimedReliabilityEvent, signal?: AbortSignal) => {
    const cancelled = () => { if (signal?.aborted) throw new Error("OPERATIONS_CONTROL_EXECUTION_CANCELLED"); };
    cancelled(); const intent = operationalActionIntentSchema.parse(lease.payload);
    if (intent.action !== "SNAPSHOT_ROLLBACK") throw new Error("OPERATIONS_CONTROL_EXECUTOR_UNSUPPORTED");
    const scope = { organizationId: intent.organizationId, projectId: intent.projectId };
    const context = createDatabaseAuthorizationContext(createProjectJobPrincipal({ ...scope, jobName: "operations-executor", correlationId: lease.correlationId }));
    const cut = <T>(execute: (tx: DatabaseTransaction, lifecycle: OperationalActionLifecycleRepository) => Promise<T>) =>
      runInAuthorizedDatabaseTransaction(context, async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0))::text`);
        for (const purpose of ["snapshot-publication","snapshot-input"])
          await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([purpose,scope.organizationId,scope.projectId])},0))::text`);
        const result = await execute(tx,new OperationalActionLifecycleRepository(tx)); cancelled(); return result;
      }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
    const begun = await cut((_tx,lifecycle) => lifecycle.begin(lease));
    if (begun.replayed) return begun.result;
    const sourcePublishSequence = begun.request.sourcePublishSequence;
    if (sourcePublishSequence === null) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
    const principal = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input", correlationId: lease.correlationId });
    const lookup = { requestId: begun.request.id, sourcePublishSequence };
    const inspected = await inspectSnapshotRollbackRunServer(principal,lookup);
    type Run = NonNullable<typeof inspected>;
    const finishResult = (finish: (tx: DatabaseTransaction) => Promise<Run>) => cut(async (tx,lifecycle) => {
      const current = await lifecycle.begin(lease); if (current.replayed) return current.result;
      const access = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT operational_executor_scope(${scope.organizationId},${scope.projectId}) AS allowed`);
      if (access[0]?.allowed !== true) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
      await tx.$executeRaw(Prisma.sql`SELECT set_config('app.actor_id','snapshot-publication',true)`);
      const run = await finish(tx);
      // Normal completion only. On error the whole cut rolls back; never query
      // restoration after a PostgreSQL-aborted statement.
      await tx.$executeRaw(Prisma.sql`SELECT set_config('app.actor_id','operations-executor',true)`);
      return lifecycle.succeedRolledBackSnapshot(lease,{ deliveryRunId: run.deliveryRunId,
        publishSequence: run.publishSequence, manifestSha256: run.manifestSha256 });
    });
    if (inspected) return finishResult(async () => inspected);
    try {
      cancelled(); const bound = await dependencies.resolveRollback(scope);
      if (bound.organizationId !== scope.organizationId || bound.projectId !== scope.projectId) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
      cancelled(); const finish = await createSnapshotRollbackServer(bound)(principal,{ ...scope,...lookup,
        jobRunId: lease.jobRunId, attempt: lease.attempt, workerId: lease.workerId, leaseAcquiredAt: lease.leaseAcquiredAt },signal);
      return await finishResult(finish);
    } catch (error) {
      try {
        const committed = await inspectSnapshotRollbackRunServer(principal,lookup);
        if (committed && !signal?.aborted) return await finishResult(async () => committed);
      } catch { /* Original failure retained; no stale lease may recover success. */ }
      throw error;
    }
  };
}
