import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ClaimedReliabilityEvent } from "../../platform-operations/index.ts";
import { prepareSuspiciousRevisionRejection } from "../../ingestion-core/server.ts";
import { operationalActionIntentSchema } from "../contracts.ts";
import { OperationalActionLifecycleRepository } from "./operational-action-lifecycle.ts";

/** Real domain adapter; shared queue registration follows with its runtime proof. */
export async function executeSuspiciousRejection(lease: ClaimedReliabilityEvent, signal?: AbortSignal) {
  const checkCancelled = () => {
    if (signal?.aborted) throw new Error("OPERATIONS_CONTROL_EXECUTION_CANCELLED");
  };
  checkCancelled();
  const intent = operationalActionIntentSchema.parse(lease.payload);
  if (intent.action !== "SUSPICIOUS_REJECT") throw new Error("OPERATIONS_CONTROL_EXECUTOR_UNSUPPORTED");
  const principal = createProjectJobPrincipal({ ...intent, jobName: "operations-executor", correlationId: lease.correlationId });
  return runInAuthorizedDatabaseTransaction(createDatabaseAuthorizationContext(principal), async (transaction) => {
    await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text`);
    const lifecycle = new OperationalActionLifecycleRepository(transaction);
    const request = await lifecycle.read(lease);
    if (request.status === "SUCCEEDED") {
      const recovered = await lifecycle.begin(lease);
      if (!recovered.replayed) throw new Error("OPERATIONS_CONTROL_RESULT_INVALID");
      checkCancelled();
      return recovered.result; // Durable committed replay precedes mutable admission.
    }
    if (!request.sourceId || !request.sourceRevisionId || !request.reason) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
    const reject = await prepareSuspiciousRevisionRejection(transaction, { organizationId: intent.organizationId,
      projectId: intent.projectId, sourceId: request.sourceId, sourceRevisionId: request.sourceRevisionId,
      requestId: request.id, requestedBy: request.requestedBy, reason: request.reason, correlationId: lease.correlationId });
    const begun = await lifecycle.begin(lease);
    checkCancelled();
    if (begun.replayed) return begun.result;
    const result = await reject();
    checkCancelled();
    const completed = await lifecycle.succeedRejectedRevision(lease, result);
    checkCancelled(); // A late cancellation still rolls the caller transaction back.
    return completed;
  }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
}
