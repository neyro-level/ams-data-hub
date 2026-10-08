import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction, type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ClaimedReliabilityEvent } from "../../platform-operations/index.ts";
import { assertMutatingJobsAllowed, PrismaDataSafetyRepository } from "../../platform-operations/server.ts";
import { createSnapshotAckRotationServer } from "../../snapshot-delivery/server.ts";
import { operationalActionIntentSchema } from "../contracts.ts";
import { OperationalActionLifecycleRepository } from "./operational-action-lifecycle.ts";

export function createOperationalAckRotationExecutor(dependencies: Parameters<typeof createSnapshotAckRotationServer>[0]) {
  return async (lease: ClaimedReliabilityEvent, signal?: AbortSignal) => {
    const cancelled = () => { if (signal?.aborted) throw new Error("OPERATIONS_CONTROL_EXECUTION_CANCELLED"); };
    cancelled(); const intent = operationalActionIntentSchema.parse(lease.payload);
    if (intent.action !== "ACK_ROTATE") throw new Error("OPERATIONS_CONTROL_EXECUTOR_UNSUPPORTED");
    const scope = { organizationId: intent.organizationId, projectId: intent.projectId };
    const context = createDatabaseAuthorizationContext(createProjectJobPrincipal({ ...scope, jobName: "operations-executor", correlationId: lease.correlationId }));
    const cut = <T>(execute: (tx: DatabaseTransaction, lifecycle: OperationalActionLifecycleRepository) => Promise<T>) =>
      runInAuthorizedDatabaseTransaction(context, async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0))::text`);
        for (const purpose of ["snapshot-publication","snapshot-input","snapshot-ack-rotation"])
          await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([purpose,scope.organizationId,scope.projectId])},0))::text`);
        const result = await execute(tx,new OperationalActionLifecycleRepository(tx)); cancelled(); return result;
      }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
    const preflight = async (tx: DatabaseTransaction) => {
      await assertMutatingJobsAllowed(new PrismaDataSafetyRepository(tx));
      const project = await tx.project.findFirst({ where: { organizationId: scope.organizationId, id: scope.projectId }, select: { status: true, serviceState: true } });
      if (project?.status !== "ACTIVE" || project.serviceState !== "ACTIVE") throw new Error("SOURCE_OPERATION_REVIEW_BLOCKED");
    };
    const begun = await cut(async (tx,lifecycle) => { const result = await lifecycle.begin(lease); if (!result.replayed) await preflight(tx); return result; });
    if (begun.replayed) return begun.result;
    const request = begun.request;
    if ((request.ackRotationPhase !== "STAGE" && request.ackRotationPhase !== "PROMOTE") || request.ackCredentialVersion === null)
      throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
    try {
      const finish = await createSnapshotAckRotationServer(dependencies)(createProjectJobPrincipal({ ...scope, jobName: "snapshot-ack-rotation", correlationId: lease.correlationId }),
        { requestId: request.id, phase: request.ackRotationPhase, expectedVersion: request.ackCredentialVersion },signal);
      return await cut(async (tx,lifecycle) => {
        const latest = await lifecycle.begin(lease); if (latest.replayed) return latest.result;
        await preflight(tx);
        const access = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT operational_executor_scope(${scope.organizationId},${scope.projectId}) AS allowed`);
        if (access[0]?.allowed !== true) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
        await tx.$executeRaw(Prisma.sql`SELECT set_config('app.actor_id','snapshot-ack-rotation',true)`);
        const result = await finish(tx);
        await tx.$executeRaw(Prisma.sql`SELECT set_config('app.actor_id','operations-executor',true)`);
        return lifecycle.succeedRotatedAck(lease,result);
      });
    } catch (error) {
      try {
        return await cut(async (_tx,lifecycle) => {
          const current = await lifecycle.begin(lease);
          if (current.replayed) return current.result;
          throw error; // No new RUNNING mutation commits on a failed recovery.
        });
      } catch { throw error; } // Preserve original diagnostics; no stale lease can recover success.
    }
  };
}
