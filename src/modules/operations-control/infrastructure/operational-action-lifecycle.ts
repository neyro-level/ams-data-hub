import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { lockOperationalOutboxLease } from "../../platform-operations/server.ts";
import type { ClaimedReliabilityEvent } from "../../platform-operations/index.ts";
import { OPERATIONAL_ACTION_TOPICS, operationalActionIntentSchema } from "../contracts.ts";

export const rejectedRevisionResultSchema = z.object({
  action: z.literal("SUSPICIOUS_REJECT"), sourceRevisionId: z.string().min(1).max(128),
}).strict();

/** Caller owns global -> domain locks -> outbox fence -> request and one atomic
 * domain/result commit. No outside IO or nested/principal-switching transaction. */
export class OperationalActionLifecycleRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async read(lease: ClaimedReliabilityEvent) {
    const intent = operationalActionIntentSchema.parse(lease.payload);
    if (lease.organizationId !== intent.organizationId || lease.topic !== OPERATIONAL_ACTION_TOPICS[intent.action]) {
      throw new Error("OPERATIONS_CONTROL_INTENT_INVALID");
    }
    const request = await this.transaction.operationalActionRequest.findFirst({ where: {
      id: intent.requestId, organizationId: intent.organizationId, projectId: intent.projectId,
      action: intent.action, outboxEventId: lease.outboxEventId,
    } });
    if (!request) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
    return request;
  }

  async begin(lease: ClaimedReliabilityEvent) {
    const intent = operationalActionIntentSchema.parse(lease.payload);
    await lockOperationalOutboxLease(this.transaction, lease, {
      organizationId: intent.organizationId, projectId: intent.projectId,
      topic: OPERATIONAL_ACTION_TOPICS[intent.action], payload: intent,
    });
    await this.transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "OperationalActionRequest"
      WHERE "id" = ${intent.requestId} AND "organizationId" = ${intent.organizationId}
        AND "projectId" = ${intent.projectId} FOR UPDATE`);
    const request = await this.read(lease);
    if (request.status === "SUCCEEDED") {
      const result = rejectedRevisionResultSchema.parse(request.result);
      if (request.action !== result.action || request.sourceRevisionId !== result.sourceRevisionId) {
        throw new Error("OPERATIONS_CONTROL_RESULT_INVALID");
      }
      return { replayed: true as const, request, result };
    }
    if (request.status === "FAILED") throw new Error("OPERATIONS_CONTROL_ALREADY_FAILED");
    await this.transaction.operationalActionRequest.update({ where: { id: request.id }, data: {
      status: "RUNNING", leaseJobRunId: lease.jobRunId, leaseAttempt: lease.attempt,
      leaseWorkerId: lease.workerId, leaseAcquiredAt: new Date(lease.leaseAcquiredAt),
      startedAt: request.startedAt ?? new Date(),
    } });
    return { replayed: false as const, request };
  }

  async succeedRejectedRevision(lease: ClaimedReliabilityEvent, rawResult: z.input<typeof rejectedRevisionResultSchema>) {
    const result = rejectedRevisionResultSchema.parse(rawResult);
    const intent = operationalActionIntentSchema.parse(lease.payload);
    if (intent.action !== result.action) throw new Error("OPERATIONS_CONTROL_RESULT_INVALID");
    await lockOperationalOutboxLease(this.transaction, lease, { organizationId: intent.organizationId,
      projectId: intent.projectId, topic: OPERATIONAL_ACTION_TOPICS[intent.action], payload: intent });
    const changed = await this.transaction.operationalActionRequest.updateMany({ where: {
      id: intent.requestId, organizationId: intent.organizationId, projectId: intent.projectId,
      sourceRevisionId: result.sourceRevisionId, action: result.action, outboxEventId: lease.outboxEventId,
      status: "RUNNING", leaseJobRunId: lease.jobRunId, leaseAttempt: lease.attempt,
      leaseWorkerId: lease.workerId, leaseAcquiredAt: new Date(lease.leaseAcquiredAt),
    }, data: { status: "SUCCEEDED", result, finishedAt: new Date() } });
    if (changed.count !== 1) throw new Error("OUTBOX_OPERATION_LEASE_LOST");
    return result;
  }
}
