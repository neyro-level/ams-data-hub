import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction, type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ClaimedReliabilityEvent } from "../../platform-operations/index.ts";
import { createSelectedSnapshotPublicationServer, inspectSelectedSnapshotRunServer } from "../../snapshot-delivery/server.ts";
import { operationalActionIntentSchema } from "../contracts.ts";
import { OperationalActionLifecycleRepository } from "./operational-action-lifecycle.ts";

/** Fixed bridge only: actor changes, never role, principal kind, scope or correlation.
 * Restore on normal completion; on error let the entire transaction roll back,
 * avoiding restoration queries on a PostgreSQL-aborted transaction. */
async function finishAsSnapshot<T>(tx: DatabaseTransaction, scope: { organizationId: string; projectId: string }, finish: (tx: DatabaseTransaction) => Promise<T>) {
  const access = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`
    SELECT operational_executor_scope(${scope.organizationId}, ${scope.projectId}) AS allowed`);
  if (access[0]?.allowed !== true) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
  await tx.$executeRaw(Prisma.sql`SELECT set_config('app.actor_id', 'snapshot-publication', true)`);
  const result = await finish(tx);
  await tx.$executeRaw(Prisma.sql`SELECT set_config('app.actor_id', 'operations-executor', true)`);
  return result;
}

export function createOperationalSnapshotPublishExecutor(dependencies: {
  resolvePublication(scope: { organizationId: string; projectId: string }): Parameters<typeof createSelectedSnapshotPublicationServer>[0]
    | Promise<Parameters<typeof createSelectedSnapshotPublicationServer>[0]>;
}) {
  return async (lease: ClaimedReliabilityEvent, signal?: AbortSignal) => {
    const cancelled = () => { if (signal?.aborted) throw new Error("OPERATIONS_CONTROL_EXECUTION_CANCELLED"); };
    cancelled(); const intent = operationalActionIntentSchema.parse(lease.payload);
    if (intent.action !== "SNAPSHOT_PUBLISH") throw new Error("OPERATIONS_CONTROL_EXECUTOR_UNSUPPORTED");
    const scope = { organizationId: intent.organizationId, projectId: intent.projectId };
    const context = createDatabaseAuthorizationContext(createProjectJobPrincipal({ ...scope, jobName: "operations-executor", correlationId: lease.correlationId }));
    const cut = <T>(execute: (tx: DatabaseTransaction, lifecycle: OperationalActionLifecycleRepository) => Promise<T>) =>
      runInAuthorizedDatabaseTransaction(context, async (tx) => {
        // Same snapshot lock identity/order, before the complete lease and request fence.
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text`);
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["snapshot-publication", scope.organizationId, scope.projectId])}, 0))::text`);
        const result = await execute(tx, new OperationalActionLifecycleRepository(tx)); cancelled(); return result;
      }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
    const begun = await cut((_tx, lifecycle) => lifecycle.begin(lease));
    const buildInputId = begun.request.buildInputId;
    if (!buildInputId) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID"); // Legacy NULL, never latest.
    const principal = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input", correlationId: lease.correlationId });
    const lookup = { buildInputId };
    const inspected = await inspectSelectedSnapshotRunServer(principal, lookup); // Config/capture/IO-free replay.
    if (begun.replayed) return begun.result;
    type Run = NonNullable<typeof inspected>;
    const finishResult = async (finish: (tx: DatabaseTransaction) => Promise<Run>) => cut(async (tx, lifecycle) => {
      const current = await lifecycle.begin(lease);
      if (current.replayed) return current.result;
      const run = await finishAsSnapshot(tx, scope, finish);
      return lifecycle.succeedPublishedSnapshot(lease, { action: "SNAPSHOT_PUBLISH", buildInputId,
        deliveryRunId: run.deliveryRunId, manifestSha256: run.manifestSha256, publishSequence: run.publishSequence });
    });
    if (inspected) return finishResult(async () => inspected);
    try {
      cancelled(); const bound = await dependencies.resolvePublication(scope);
      if (bound.organizationId !== scope.organizationId || bound.projectId !== scope.projectId) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
      cancelled(); const finish = await createSelectedSnapshotPublicationServer(bound)(principal, lookup, signal);
      return await finishResult(finish);
    } catch (error) {
      // Concurrent committed domain success survives configuration/trust changes;
      // recovery still requires the same complete live lease before request success.
      const committed = await inspectSelectedSnapshotRunServer(principal, lookup);
      if (committed && !signal?.aborted) return finishResult(async () => committed);
      throw error;
    }
  };
}
