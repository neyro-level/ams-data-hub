import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { OperationsControlError } from "../contracts.ts";
import type {
  OperationsActionRepository,
  RecordOperationalActionRequest,
} from "../application/ports/operations-action-repository.ts";

const actionNames: Record<RecordOperationalActionRequest["action"], string> = {
  SUSPICIOUS_APPROVE: "operations-control.suspicious.approve.request",
  SUSPICIOUS_REJECT: "operations-control.suspicious.reject.request",
  SNAPSHOT_BUILD: "operations-control.snapshot.build.request",
  SNAPSHOT_PUBLISH: "operations-control.snapshot.publish.request",
  SNAPSHOT_ROLLBACK: "operations-control.snapshot.rollback.request",
  ACK_ROTATE: "operations-control.ack.rotate.request",
};

function duplicateRequestId(response: unknown): string | null {
  if (!response || typeof response !== "object" || Array.isArray(response)) return null;
  const value = (response as Record<string, unknown>).requestId;
  return typeof value === "string" ? value : null;
}

export class PrismaOperationsActionRepository implements OperationsActionRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async recordRequest(input: RecordOperationalActionRequest) {
    const project = await this.transaction.project.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!project) throw new OperationsControlError("OPERATIONS_CONTROL_REFERENCE_INVALID");
    if (input.sourceId) {
      const source = await this.transaction.source.findFirst({
        where: { id: input.sourceId, projectId: input.projectId, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!source) throw new OperationsControlError("OPERATIONS_CONTROL_REFERENCE_INVALID");
    }

    const scope = "operations-control.action";
    const lockKey = `${scope}:${input.organizationId}:${input.idempotencyKey}`;
    await this.transaction.$queryRaw(Prisma.sql`
      select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text as lock_result
    `);
    const uniqueWhere = { scope_organizationScope_key: { scope, organizationScope: input.organizationId, key: input.idempotencyKey } };
    const existing = await this.transaction.idempotencyKey.findUnique({
      where: uniqueWhere,
      select: { requestHash: true, response: true },
    });
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        throw new OperationsControlError("OPERATIONS_CONTROL_IDEMPOTENCY_CONFLICT");
      }
      const requestId = duplicateRequestId(existing.response);
      if (!requestId) throw new OperationsControlError("OPERATIONS_CONTROL_IDEMPOTENCY_CONFLICT");
      return { requestId, duplicate: true };
    }

    const audit = await this.transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: "USER",
        actorId: input.actorId,
        action: actionNames[input.action],
        entityType: input.sourceId ? "Source" : "Project",
        entityId: input.sourceId ?? input.projectId,
        afterMarker: {
          state: "REQUESTED",
          projectId: input.projectId,
          operation: input.action,
          ...(input.sourceRevisionId ? { sourceRevisionId: input.sourceRevisionId } : {}),
          ...(input.sourcePublishSequence ? { sourcePublishSequence: input.sourcePublishSequence } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        },
        source: "operations-control",
        correlationId: input.correlationId,
      },
      select: { id: true },
    });
    await this.transaction.idempotencyKey.create({
      data: {
        organizationId: input.organizationId,
        organizationScope: input.organizationId,
        scope,
        key: input.idempotencyKey,
        requestHash: input.requestHash,
        status: "COMPLETED",
        response: { requestId: audit.id },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return { requestId: audit.id, duplicate: false };
  }
}
