import "server-only";
import { Prisma } from "../../generated/prisma/client.ts";
import { createProjectJobPrincipal } from "../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction } from "../../platform/database/transaction.ts";
import type { ClaimedReliabilityEvent } from "../platform-operations/index.ts";
import { operationalActionIntentSchema, OPERATIONAL_ACTION_TOPICS } from "./contracts.ts";
import { executeSuspiciousRejection } from "./infrastructure/suspicious-rejection-executor.ts";
import { OperationalActionLifecycleRepository } from "./infrastructure/operational-action-lifecycle.ts";
import type { createOperationalSnapshotBuildExecutor } from "./infrastructure/snapshot-build-executor.ts";
import type { createOperationalSnapshotPublishExecutor } from "./infrastructure/snapshot-publish-executor.ts";
import type { createOperationalSnapshotRollbackExecutor } from "./infrastructure/snapshot-rollback-executor.ts";
import type { createOperationalAckRotationExecutor } from "./infrastructure/ack-rotation-executor.ts";

export const OPERATIONAL_EXECUTOR_TOPICS = Object.freeze([OPERATIONAL_ACTION_TOPICS.SUSPICIOUS_REJECT]);

/** No raw exception text, cancellation reason or arbitrary diagnostic code
 * reaches generic outbox persistence. Retry/defer is not request FAILED. */
export async function handleOperationalOutboxEvent(event: ClaimedReliabilityEvent, signal?: AbortSignal,
  build?: ReturnType<typeof createOperationalSnapshotBuildExecutor>, publish?: ReturnType<typeof createOperationalSnapshotPublishExecutor>,
  rollback?: ReturnType<typeof createOperationalSnapshotRollbackExecutor>, ackRotation?: ReturnType<typeof createOperationalAckRotationExecutor>) {
  if (event.topic !== OPERATIONAL_ACTION_TOPICS.SUSPICIOUS_REJECT && !(event.topic === OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD && build)
    && !(event.topic === OPERATIONAL_ACTION_TOPICS.SNAPSHOT_PUBLISH && publish)
    && !(event.topic === OPERATIONAL_ACTION_TOPICS.SNAPSHOT_ROLLBACK && rollback)
    && !(event.topic === OPERATIONAL_ACTION_TOPICS.ACK_ROTATE && ackRotation)) {
    throw Object.assign(new Error("OPERATIONS_CONTROL_EXECUTOR_UNSUPPORTED"), {
      code: "OPERATIONS_CONTROL_EXECUTOR_UNSUPPORTED", retryable: false,
    });
  }
  try {
    if (event.topic === OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD && build) await build(event, signal);
    else if (event.topic === OPERATIONAL_ACTION_TOPICS.SNAPSHOT_PUBLISH && publish) await publish(event, signal);
    else if (event.topic === OPERATIONAL_ACTION_TOPICS.SNAPSHOT_ROLLBACK && rollback) await rollback(event, signal);
    else if (event.topic === OPERATIONAL_ACTION_TOPICS.ACK_ROTATE && ackRotation) await ackRotation(event,signal);
    else await executeSuspiciousRejection(event, signal);
  }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (["DATA_SAFETY_JOBS_FROZEN", "SOURCE_OPERATION_REVIEW_BLOCKED", "OPERATIONS_CONTROL_EXECUTION_CANCELLED",
      "OUTBOX_OPERATION_LEASE_LOST", "SNAPSHOT_INPUT_JOBS_FROZEN", "SNAPSHOT_INPUT_PROJECT_BLOCKED",
      "SNAPSHOT_PUBLICATION_JOBS_FROZEN", "SNAPSHOT_PUBLICATION_PROJECT_BLOCKED", "SNAPSHOT_PUBLICATION_CANCELLED"].includes(message)) {
      return { deferred: true as const, code: "OPERATIONS_CONTROL_EXECUTION_DEFERRED" as const };
    }
    // Unexpected infrastructure failures consume the existing bounded retry
    // budget. Deterministic invalid revision/request cases are terminal.
    const retryable = !["SOURCE_REVISION_SAFETY_INVALID", "SOURCE_OPERATION_REVIEW_INVALID",
      "OPERATIONS_CONTROL_REFERENCE_INVALID", "OPERATIONS_CONTROL_ALREADY_FAILED", "ACK_CREDENTIAL_STALE", "ACK_ROTATION_ALREADY_STAGED",
      "ACK_ROTATION_NOT_STAGED", "ACK_ROTATION_TRANSITION_INVALID", "ACK_CREDENTIAL_NOT_CONFIGURED"].includes(message);
    throw Object.assign(new Error("OPERATIONS_CONTROL_EXECUTION_FAILED"), {
      code: "OPERATIONS_CONTROL_EXECUTION_FAILED", retryable,
    });
  }
}

export async function settleTerminalOperationalRequests(events: readonly {
  id: string; organizationId: string | null; payload: unknown;
}[]) {
  for (const event of events) {
    const intent = operationalActionIntentSchema.safeParse(event.payload);
    if (!intent.success || intent.data.organizationId !== event.organizationId) {
      continue; // Quarantined by existing DEAD_LETTER; never fabricate a request.
    }
    const principal = createProjectJobPrincipal({ ...intent.data, jobName: "operations-executor",
      correlationId: `operations-terminal-${event.id}` });
    await runInAuthorizedDatabaseTransaction(createDatabaseAuthorizationContext(principal), async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text`);
      return new OperationalActionLifecycleRepository(tx).settleDeadLetter(event.id, intent.data);
    }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
  }
}
