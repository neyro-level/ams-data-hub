import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext,runInAuthorizedDatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ClaimedReliabilityEvent } from "../../platform-operations/index.ts";
import { applySuspiciousRevisionApproval } from "../../ingestion-core/server.ts";
import { operationalActionIntentSchema } from "../contracts.ts";
import { OperationalActionLifecycleRepository } from "./operational-action-lifecycle.ts";

export async function executeSuspiciousApproval(lease: ClaimedReliabilityEvent, signal?: AbortSignal) {
  const cancelled = () => { if (signal?.aborted) throw new Error("OPERATIONS_CONTROL_EXECUTION_CANCELLED"); };
  cancelled(); const intent = operationalActionIntentSchema.parse(lease.payload);
  if (intent.action !== "SUSPICIOUS_APPROVE") throw new Error("OPERATIONS_CONTROL_EXECUTOR_UNSUPPORTED");
  const principal = createProjectJobPrincipal({ ...intent,jobName: "operations-executor",correlationId: lease.correlationId });
  return runInAuthorizedDatabaseTransaction(createDatabaseAuthorizationContext(principal),async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0))::text`);
    const lifecycle = new OperationalActionLifecycleRepository(tx); const request = await lifecycle.read(lease);
    if (!request.sourceId || !request.sourceRevisionId || !request.reason) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["source-identities",intent.organizationId,intent.projectId,request.sourceId])},0))::text`);
    const begun = await lifecycle.begin(lease); cancelled(); if (begun.replayed) return begun.result;
    const access = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT operational_executor_scope(${intent.organizationId},${intent.projectId}) AS allowed`);
    if (access[0]?.allowed !== true) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
    await tx.$executeRaw(Prisma.sql`SELECT set_config('app.actor_id','source-import',true)`);
    const result = await applySuspiciousRevisionApproval(tx,{ organizationId: intent.organizationId,projectId: intent.projectId,
      sourceId: request.sourceId,sourceRevisionId: request.sourceRevisionId,requestId: request.id,correlationId: lease.correlationId },signal);
    await tx.$executeRaw(Prisma.sql`SELECT set_config('app.actor_id','operations-executor',true)`);
    const completed = await lifecycle.succeedApprovedRevision(lease,result); cancelled(); return completed;
  },{ isolationLevel: "ReadCommitted",maxWait: 2000,timeout: 15_000 });
}
