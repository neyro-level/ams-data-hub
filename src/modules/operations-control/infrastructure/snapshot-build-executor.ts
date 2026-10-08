import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ClaimedReliabilityEvent } from "../../platform-operations/index.ts";
import { captureSnapshotInput, createSnapshotStagedBuildServer, inspectStagedSnapshotServer } from "../../snapshot-delivery/server.ts";
import { operationalActionIntentSchema } from "../contracts.ts";
import { operationalSnapshotBuildRequest } from "../application/operational-snapshot-build.ts";
import { OperationalActionLifecycleRepository } from "./operational-action-lifecycle.ts";

/** No domain/current publication; two short full-lease cuts surround actual BUILD IO. */
export function createOperationalSnapshotBuildExecutor(dependencies: {
  resolveStage(scope: { organizationId: string; projectId: string }): Parameters<typeof createSnapshotStagedBuildServer>[0]
    | Promise<Parameters<typeof createSnapshotStagedBuildServer>[0]>;
}) {
  return async (lease: ClaimedReliabilityEvent, signal?: AbortSignal) => {
    const checkCancelled = () => { if (signal?.aborted) throw new Error("OPERATIONS_CONTROL_EXECUTION_CANCELLED"); };
    checkCancelled();
    const intent = operationalActionIntentSchema.parse(lease.payload);
    if (intent.action !== "SNAPSHOT_BUILD") throw new Error("OPERATIONS_CONTROL_EXECUTOR_UNSUPPORTED");
    const scope = { organizationId: intent.organizationId, projectId: intent.projectId };
    const executor = createProjectJobPrincipal({ ...scope, jobName: "operations-executor", correlationId: lease.correlationId });
    const context = createDatabaseAuthorizationContext(executor);
    const cut = <T>(execute: (lifecycle: OperationalActionLifecycleRepository) => Promise<T>) =>
      runInAuthorizedDatabaseTransaction(context, async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text`);
        const result = await execute(new OperationalActionLifecycleRepository(tx));
        checkCancelled(); return result;
      }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
    const begun = await cut((lifecycle) => lifecycle.begin(lease));
    if (begun.replayed) return begun.result;
    const principal = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input", correlationId: lease.correlationId });
    const { request, lookup } = operationalSnapshotBuildRequest(scope, intent.requestId);
    let receipt = await inspectStagedSnapshotServer(principal, lookup);
    if (!receipt) {
      checkCancelled();
      const bound = await dependencies.resolveStage(scope);
      if (bound.organizationId !== scope.organizationId || bound.projectId !== scope.projectId) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
      checkCancelled();
      await captureSnapshotInput(principal, request);
      checkCancelled();
      receipt = await createSnapshotStagedBuildServer(bound)(principal, lookup, signal);
    }
    checkCancelled();
    const result = { action: "SNAPSHOT_BUILD" as const, buildInputId: receipt.buildInputId, inputHash: receipt.inputHash,
      manifestSha256: receipt.manifestSha256, publishSequence: receipt.publishSequence };
    return cut((lifecycle) => lifecycle.succeedStagedSnapshot(lease, result));
  };
}
