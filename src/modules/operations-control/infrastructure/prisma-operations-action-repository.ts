import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { OperationsControlError, OPERATIONAL_ACTION_TOPICS, operationalActionIntentSchema } from "../contracts.ts";
import { PrismaReliabilityRepository } from "../../platform-operations/server.ts";
import { assertOperationalRawPinAdmission } from "../../snapshot-delivery/server.ts";
import type {
  OperationsActionRepository,
  RecordOperationalActionRequest,
} from "../application/ports/operations-action-repository.ts";

function duplicateRequestId(response: unknown): string | null {
  if (!response || typeof response !== "object" || Array.isArray(response)) return null;
  const value = (response as Record<string, unknown>).requestId;
  return typeof value === "string" ? value : null;
}

export class PrismaOperationsActionRepository implements OperationsActionRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async recordRequest(input: RecordOperationalActionRequest) {
    // Pending targets are retention pins from acceptance onward. Fence their
    // INSERT before idempotency/outbox locks, not only executor UPDATE later.
    await this.transaction.$queryRaw(Prisma.sql`
      select pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text
    `);
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

    // Replay is durable: a completed review may legitimately no longer be
    // SUSPICIOUS. Mutable admission applies only to a genuinely new request.
    const project = await this.transaction.project.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId }, select: { id: true },
    });
    if (!project) throw new OperationsControlError("OPERATIONS_CONTROL_REFERENCE_INVALID");
    if (input.action === "SNAPSHOT_PUBLISH" || input.action === "SNAPSHOT_ROLLBACK") {
      await assertOperationalRawPinAdmission(this.transaction, input, {
        buildInputId: input.action === "SNAPSHOT_PUBLISH" ? input.buildInputId : null,
        sourcePublishSequence: input.action === "SNAPSHOT_ROLLBACK" ? input.sourcePublishSequence : null,
      });
    }
    if (input.sourceId) {
      const revision = await this.transaction.sourceRevision.findFirst({ where: {
        id: input.sourceRevisionId ?? "", sourceId: input.sourceId,
        organizationId: input.organizationId, projectId: input.projectId, status: "SUSPICIOUS",
      }, select: { id: true } });
      if (!revision) throw new OperationsControlError("OPERATIONS_CONTROL_REFERENCE_INVALID");
    }

    const audit = await this.transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: "USER",
        actorId: input.actorId,
        action: OPERATIONAL_ACTION_TOPICS[input.action],
        entityType: input.sourceId ? "Source" : "Project",
        entityId: input.sourceId ?? input.projectId,
        afterMarker: {
          state: "REQUESTED",
          projectId: input.projectId,
          operation: input.action,
          ...(input.sourceRevisionId ? { sourceRevisionId: input.sourceRevisionId } : {}),
          ...(input.sourcePublishSequence ? { sourcePublishSequence: input.sourcePublishSequence } : {}),
          ...(input.buildInputId ? { buildInputId: input.buildInputId } : {}),
          ...(input.action === "ACK_ROTATE" ? { ackRotationPhase: input.ackRotationPhase, ackCredentialVersion: input.ackCredentialVersion } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        },
        source: "operations-control",
        correlationId: input.correlationId,
      },
      select: { id: true },
    });
    const payload = operationalActionIntentSchema.parse({ schemaVersion: 1,
      organizationId: input.organizationId, projectId: input.projectId,
      requestId: audit.id, action: input.action });
    const now = new Date();
    const intent = await new PrismaReliabilityRepository(this.transaction).enqueueEvent({
      organizationId: input.organizationId, organizationScope: input.organizationId,
      idempotencyScope: "operations-control.action.intent", idempotencyKey: audit.id,
      requestHash: input.requestHash, topic: OPERATIONAL_ACTION_TOPICS[input.action], payload,
      actorType: "USER", actorId: input.actorId, action: "operations-control.action.enqueued",
      entityType: "Project", entityId: input.projectId, source: "operations-control",
      correlationId: input.correlationId, schemaVersion: 1, occurredAt: now.toISOString(),
      availableAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 24 * 3_600_000).toISOString(),
    });
    try { await this.transaction.operationalActionRequest.create({ data: {
      id: audit.id, organizationId: input.organizationId, projectId: input.projectId,
      action: input.action, sourceId: input.sourceId, sourceRevisionId: input.sourceRevisionId,
      sourcePublishSequence: input.sourcePublishSequence, reason: input.reason,
      buildInputId: input.buildInputId,
      ackRotationPhase: input.ackRotationPhase ?? null, ackCredentialVersion: input.ackCredentialVersion ?? null,
      requestHash: input.requestHash, requestedBy: input.actorId, outboxEventId: intent.outboxEventId,
    } }); } catch (error) {
      if (input.action === "SNAPSHOT_PUBLISH" && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new OperationsControlError("OPERATIONS_CONTROL_REFERENCE_INVALID");
      }
      throw error;
    }
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
