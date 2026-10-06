import "server-only";
import { createHash } from "node:crypto";
import type { PgBoss } from "pg-boss";
import type { ClaimedReliabilityEvent, OutboxHandlerResult } from "../../platform-operations/index.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import type { ProjectJobPrincipal } from "../../../platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { SourceManualRequestRepository } from "../application/ports/source-job-repository.ts";
import { SOURCE_IMPORT_QUEUE, sourceImportJobSchema, sourceManualRequestIntentSchema } from "../domain/source-jobs.ts";
import { PrismaSourceJobRepository } from "./prisma-source-job-repository.ts";

export function sourceManualJobId(requestId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(requestId)) throw new Error("SOURCE_MANUAL_REQUEST_INVALID");
  const bytes = createHash("sha1").update(`ams-data-hub/source-manual/${requestId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createPrismaSourceManualRequests(): SourceManualRequestRepository {
  return {
    load: (principal, sourceId, requestId) => runInPrincipalDatabaseTransaction(principal, (tx) =>
      tx.sourceManualRunRequest.findFirst({ where: { organizationId: principal.organizationId, projectId: principal.projectId,
        sourceId, id: requestId }, select: { status: true } })),
    fail: async (principal, sourceId, requestId) => { await runInPrincipalDatabaseTransaction(principal, (tx) =>
      tx.sourceManualRunRequest.updateMany({ where: { organizationId: principal.organizationId, projectId: principal.projectId,
        sourceId, id: requestId, status: { in: ["REQUESTED", "CLAIMED"] } }, data: { status: "FAILED" } })); },
  };
}

/** Only persisted outbox payloads reach this dispatcher. No intake or external
 * side effect occurs inside the request/config database transactions. */
export async function dispatchSourceManualRequest(boss: Pick<PgBoss, "send" | "getJobById">,
  event: ClaimedReliabilityEvent): Promise<OutboxHandlerResult> {
  const parsed = sourceManualRequestIntentSchema.safeParse(event.payload);
  if (!parsed.success || event.organizationId !== parsed.data.organizationId) throw Object.assign(new Error("SOURCE_MANUAL_INTENT_INVALID"),
    { code: "SOURCE_MANUAL_INTENT_INVALID", retryable: false });
  const payload = parsed.data;
  try {
    const principal = createProjectJobPrincipal({ jobName: "source-import", organizationId: payload.organizationId,
      projectId: payload.projectId }) as ProjectJobPrincipal;
    const requests = createPrismaSourceManualRequests();
    const request = await requests.load(principal, payload.sourceId, payload.manualRequestId);
    if (!request) throw Object.assign(new Error("SOURCE_MANUAL_REQUEST_NOT_FOUND"), { code: "SOURCE_MANUAL_REQUEST_NOT_FOUND", retryable: false });
    if (request.status === "COMPLETED" || request.status === "FAILED") return;
    const source = await runInPrincipalDatabaseTransaction(principal, (tx) => new PrismaSourceJobRepository(tx).loadExecutionContext(principal, payload.sourceId));
    if (!source || !source.enabled || source.serviceState !== "ACTIVE") {
      await requests.fail(principal, payload.sourceId, payload.manualRequestId); return;
    }
    const job = sourceImportJobSchema.parse({ ...payload, trigger: "MANUAL" });
    const id = sourceManualJobId(payload.manualRequestId);
    const sent = await boss.send(SOURCE_IMPORT_QUEUE, job, { id, singletonKey: payload.sourceId });
    if (sent) return;
    const existing = await boss.getJobById(SOURCE_IMPORT_QUEUE, id);
    if (existing) {
      const actual = sourceImportJobSchema.safeParse(existing.data);
      if (!actual.success || JSON.stringify(actual.data) !== JSON.stringify(job)) throw Object.assign(new Error("SOURCE_MANUAL_JOB_CONFLICT"),
        { code: "SOURCE_MANUAL_JOB_CONFLICT", retryable: false });
      if (existing.state === "failed" || existing.state === "cancelled") await requests.fail(principal, payload.sourceId, payload.manualRequestId);
      return;
    }
    return { deferred: true, code: "SOURCE_JOB_QUEUE_BUSY" };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error
      && ["SOURCE_MANUAL_JOB_CONFLICT", "SOURCE_MANUAL_REQUEST_NOT_FOUND"].includes(String(error.code))) throw error;
    throw Object.assign(new Error("SOURCE_MANUAL_DISPATCH_FAILED"), { code: "SOURCE_MANUAL_DISPATCH_FAILED", retryable: true });
  }
}

/** Restart-safe terminal intent reconciliation. Completion is never overwritten;
 * busy/reserved deferrals never enter the terminal-event input. */
export async function settleTerminalSourceManualRequests(events: readonly { organizationId: string | null; payload: unknown }[]) {
  if (events.length > 100) throw new Error("SOURCE_MANUAL_TERMINAL_BATCH_INVALID");
  const requests = createPrismaSourceManualRequests();
  for (const event of events) {
    const parsed = sourceManualRequestIntentSchema.safeParse(event.payload);
    if (!parsed.success || parsed.data.organizationId !== event.organizationId) continue;
    const payload = parsed.data;
    const principal = createProjectJobPrincipal({ jobName: "source-import", organizationId: payload.organizationId,
      projectId: payload.projectId }) as ProjectJobPrincipal;
    await requests.fail(principal, payload.sourceId, payload.manualRequestId);
  }
}
