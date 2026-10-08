import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { lockOperationalOutboxLease, lockOperationalOutboxTerminal } from "../../platform-operations/server.ts";
import type { ClaimedReliabilityEvent } from "../../platform-operations/index.ts";
import { OPERATIONAL_ACTION_TOPICS, operationalActionIntentSchema } from "../contracts.ts";
import { operationalSnapshotBuildRequest } from "../application/operational-snapshot-build.ts";

export const rejectedRevisionResultSchema = z.object({
  action: z.literal("SUSPICIOUS_REJECT"), sourceRevisionId: z.string().min(1).max(128),
}).strict();
export const stagedSnapshotResultSchema = z.object({ action: z.literal("SNAPSHOT_BUILD"),
  buildInputId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u), inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u), publishSequence: z.number().int().positive().max(2_147_483_647),
}).strict();
export const publishedSnapshotResultSchema = z.object({ action: z.literal("SNAPSHOT_PUBLISH"),
  buildInputId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u), deliveryRunId: z.string().min(1).max(128),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u), publishSequence: z.number().int().positive().max(2_147_483_647),
}).strict();
export const rolledBackSnapshotResultSchema = z.object({ action: z.literal("SNAPSHOT_ROLLBACK"),
  sourcePublishSequence: z.number().int().positive().max(2_147_483_647), sourceDeliveryRunId: z.string().min(1).max(128),
  deliveryRunId: z.string().min(1).max(128), manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  publishSequence: z.number().int().positive().max(2_147_483_647),
}).strict();
export const rotatedAckResultSchema = z.object({ action: z.literal("ACK_ROTATE"), phase: z.enum(["STAGE", "PROMOTE"]),
  previousCredentialVersion: z.number().int().positive().max(2_147_483_646), credentialVersion: z.number().int().positive().max(2_147_483_647) }).strict();
const operationalResultSchema = z.discriminatedUnion("action", [rejectedRevisionResultSchema, stagedSnapshotResultSchema, publishedSnapshotResultSchema, rolledBackSnapshotResultSchema, rotatedAckResultSchema]);

/** Caller owns global -> domain locks -> outbox fence -> request and one atomic
 * domain/result commit. No outside IO, nested transaction or arbitrary principal
 * switch. A fixed same-scope snapshot actor bridge may compose publication. */
export class OperationalActionLifecycleRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async settleDeadLetter(outboxEventId: string, rawIntent: unknown) {
    const intent = operationalActionIntentSchema.parse(rawIntent);
    const bound = await this.transaction.operationalActionRequest.findFirst({ where: {
      id: intent.requestId, organizationId: intent.organizationId, projectId: intent.projectId,
      action: intent.action, outboxEventId,
    }, select: { id: true } });
    if (!bound) return false; // Well-shaped orphan, not an accepted request.
    const terminal = await lockOperationalOutboxTerminal(this.transaction, outboxEventId, {
      organizationId: intent.organizationId, projectId: intent.projectId,
      topic: OPERATIONAL_ACTION_TOPICS[intent.action], payload: intent,
    });
    if (!terminal) return false;
    await this.transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "OperationalActionRequest"
      WHERE "id" = ${intent.requestId} AND "organizationId" = ${intent.organizationId}
        AND "projectId" = ${intent.projectId} FOR UPDATE`);
    const request = await this.transaction.operationalActionRequest.findFirst({ where: {
      id: intent.requestId, organizationId: intent.organizationId, projectId: intent.projectId,
      action: intent.action, outboxEventId,
    } });
    if (!request) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
    // The domain commit can succeed before queue ACK is lost/exhausted. Never
    // replace that durable success with an infrastructure failure.
    if (request.status === "SUCCEEDED" || request.status === "FAILED") return false;
    const finishedAt = new Date(Math.max(Date.now(), terminal.finishedAt.getTime(), request.startedAt?.getTime() ?? 0));
    await this.transaction.operationalActionRequest.update({ where: { id: request.id }, data: {
      status: "FAILED", safeErrorCode: "OPERATIONS_CONTROL_EXECUTION_FAILED", finishedAt,
      startedAt: request.startedAt ?? terminal.startedAt, leaseJobRunId: terminal.id,
      leaseAttempt: terminal.attempt, leaseWorkerId: terminal.workerId, leaseAcquiredAt: terminal.startedAt,
    } });
    return true;
  }

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
      const result = operationalResultSchema.parse(request.result);
      if (request.action !== result.action || (result.action === "SUSPICIOUS_REJECT" && request.sourceRevisionId !== result.sourceRevisionId)) {
        throw new Error("OPERATIONS_CONTROL_RESULT_INVALID");
      }
      if (result.action === "SNAPSHOT_BUILD") await this.assertStagedResult(request, result);
      if (result.action === "SNAPSHOT_PUBLISH") await this.assertPublishedResult(request, result);
      if (result.action === "SNAPSHOT_ROLLBACK") await this.assertRollbackResult(request, result);
      if (result.action === "ACK_ROTATE") await this.assertRotatedAckResult(request, result);
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

  private async assertStagedResult(scope: { organizationId: string; projectId: string; id: string }, result: z.output<typeof stagedSnapshotResultSchema>) {
    const { lookup } = operationalSnapshotBuildRequest(scope, scope.id);
    const receipt = await this.transaction.snapshotArtifactStageReceipt.findUnique({ where: {
      organizationId_projectId_buildInputId: { organizationId: scope.organizationId, projectId: scope.projectId, buildInputId: result.buildInputId },
    } });
    if (!receipt || receipt.idempotencyKeyHash !== lookup.idempotencyKeyHash || receipt.requestHash !== lookup.requestHash || receipt.inputHash !== result.inputHash
      || receipt.manifestSha256 !== result.manifestSha256 || receipt.publishSequence !== result.publishSequence) {
      throw new Error("OPERATIONS_CONTROL_RESULT_INVALID");
    }
    return receipt;
  }

  async succeedStagedSnapshot(lease: ClaimedReliabilityEvent, rawResult: z.input<typeof stagedSnapshotResultSchema>) {
    const result = stagedSnapshotResultSchema.parse(rawResult); const intent = operationalActionIntentSchema.parse(lease.payload);
    if (intent.action !== result.action) throw new Error("OPERATIONS_CONTROL_RESULT_INVALID");
    await lockOperationalOutboxLease(this.transaction, lease, { organizationId: intent.organizationId,
      projectId: intent.projectId, topic: OPERATIONAL_ACTION_TOPICS[intent.action], payload: intent });
    const receipt = await this.assertStagedResult({ ...intent, id: intent.requestId }, result);
    const changed = await this.transaction.operationalActionRequest.updateMany({ where: {
      id: intent.requestId, organizationId: intent.organizationId, projectId: intent.projectId,
      action: result.action, outboxEventId: lease.outboxEventId, status: "RUNNING",
      leaseJobRunId: lease.jobRunId, leaseAttempt: lease.attempt, leaseWorkerId: lease.workerId,
      leaseAcquiredAt: new Date(lease.leaseAcquiredAt),
    }, data: { status: "SUCCEEDED", result, finishedAt: new Date(Math.max(Date.now(), receipt.stagedAt.getTime())) } });
    if (changed.count !== 1) throw new Error("OUTBOX_OPERATION_LEASE_LOST");
    return result;
  }

  private async assertPublishedResult(scope: { organizationId: string; projectId: string; buildInputId: string | null }, result: z.output<typeof publishedSnapshotResultSchema>) {
    if (scope.buildInputId !== result.buildInputId) throw new Error("OPERATIONS_CONTROL_RESULT_INVALID");
    const stage = await this.transaction.snapshotArtifactStageReceipt.findUnique({ where: {
      organizationId_projectId_buildInputId: { organizationId: scope.organizationId, projectId: scope.projectId, buildInputId: result.buildInputId },
    } });
    const run = await this.transaction.deliveryRun.findFirst({ where: { id: result.deliveryRunId,
      organizationId: scope.organizationId, projectId: scope.projectId, publishSequence: result.publishSequence,
      manifestSha256: result.manifestSha256 } });
    if (!stage || !run || stage.publishSequence !== result.publishSequence || stage.manifestSha256 !== result.manifestSha256) {
      throw new Error("OPERATIONS_CONTROL_RESULT_INVALID");
    }
    return { stage, run };
  }

  async succeedPublishedSnapshot(lease: ClaimedReliabilityEvent, rawResult: z.input<typeof publishedSnapshotResultSchema>) {
    const result = publishedSnapshotResultSchema.parse(rawResult); const intent = operationalActionIntentSchema.parse(lease.payload);
    if (intent.action !== result.action) throw new Error("OPERATIONS_CONTROL_RESULT_INVALID");
    await lockOperationalOutboxLease(this.transaction, lease, { organizationId: intent.organizationId,
      projectId: intent.projectId, topic: OPERATIONAL_ACTION_TOPICS[intent.action], payload: intent });
    const request = await this.read(lease);
    const { stage, run } = await this.assertPublishedResult(request, result);
    const changed = await this.transaction.operationalActionRequest.updateMany({ where: {
      id: intent.requestId, organizationId: intent.organizationId, projectId: intent.projectId,
      action: result.action, buildInputId: result.buildInputId, outboxEventId: lease.outboxEventId, status: "RUNNING",
      leaseJobRunId: lease.jobRunId, leaseAttempt: lease.attempt, leaseWorkerId: lease.workerId,
      leaseAcquiredAt: new Date(lease.leaseAcquiredAt),
    }, data: { status: "SUCCEEDED", result, finishedAt: new Date(Math.max(Date.now(), stage.stagedAt.getTime(), run.publishedAt.getTime(), request.startedAt?.getTime() ?? 0)) } });
    if (changed.count !== 1) throw new Error("OUTBOX_OPERATION_LEASE_LOST");
    return result;
  }

  private async rollbackProof(scope: { organizationId: string; projectId: string; id: string; sourcePublishSequence: number | null }) {
    if (scope.sourcePublishSequence === null) throw new Error("OPERATIONS_CONTROL_RESULT_INVALID");
    const access = await this.transaction.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT operational_executor_scope(${scope.organizationId},${scope.projectId}) AS allowed`);
    if (access[0]?.allowed !== true) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
    await this.transaction.$executeRaw(Prisma.sql`SELECT set_config('app.actor_id','snapshot-publication',true)`);
    const rows = await this.transaction.$queryRaw<{ sourceDeliveryRunId: string; deliveryRunId: string; publishSequence: number;
      manifestSha256: string; stagedAt: Date; publishedAt: Date }[]>(Prisma.sql`
      SELECT * FROM snapshot_rollback_operation_proof(${scope.organizationId},${scope.projectId},${scope.id},${scope.sourcePublishSequence}::integer)`);
    await this.transaction.$executeRaw(Prisma.sql`SELECT set_config('app.actor_id','operations-executor',true)`);
    if (rows.length !== 1) throw new Error("OPERATIONS_CONTROL_RESULT_INVALID"); return rows[0]!;
  }

  private async assertRollbackResult(scope: { organizationId: string; projectId: string; id: string; sourcePublishSequence: number | null }, result: z.output<typeof rolledBackSnapshotResultSchema>) {
    const proof = await this.rollbackProof(scope);
    if (result.sourcePublishSequence !== scope.sourcePublishSequence || result.sourceDeliveryRunId !== proof.sourceDeliveryRunId
      || result.deliveryRunId !== proof.deliveryRunId || result.publishSequence !== proof.publishSequence
      || result.manifestSha256 !== proof.manifestSha256) throw new Error("OPERATIONS_CONTROL_RESULT_INVALID");
    return proof;
  }

  async succeedRolledBackSnapshot(lease: ClaimedReliabilityEvent, run: { deliveryRunId: string; publishSequence: number; manifestSha256: string }) {
    const intent = operationalActionIntentSchema.parse(lease.payload);
    if (intent.action !== "SNAPSHOT_ROLLBACK") throw new Error("OPERATIONS_CONTROL_RESULT_INVALID");
    await lockOperationalOutboxLease(this.transaction, lease, { organizationId: intent.organizationId, projectId: intent.projectId,
      topic: OPERATIONAL_ACTION_TOPICS[intent.action], payload: intent });
    const request = await this.read(lease); const proof = await this.rollbackProof(request);
    const result = rolledBackSnapshotResultSchema.parse({ action: "SNAPSHOT_ROLLBACK", sourcePublishSequence: request.sourcePublishSequence,
      sourceDeliveryRunId: proof.sourceDeliveryRunId, ...run });
    await this.assertRollbackResult(request, result);
    const changed = await this.transaction.operationalActionRequest.updateMany({ where: { id: intent.requestId,
      organizationId: intent.organizationId, projectId: intent.projectId, action: result.action, outboxEventId: lease.outboxEventId, status: "RUNNING",
      leaseJobRunId: lease.jobRunId, leaseAttempt: lease.attempt, leaseWorkerId: lease.workerId, leaseAcquiredAt: new Date(lease.leaseAcquiredAt) },
      data: { status: "SUCCEEDED", result, finishedAt: new Date(Math.max(Date.now(),proof.stagedAt.getTime(),proof.publishedAt.getTime(),request.startedAt?.getTime() ?? 0)) } });
    if (changed.count !== 1) throw new Error("OUTBOX_OPERATION_LEASE_LOST"); return result;
  }

  private async assertRotatedAckResult(request: { organizationId: string; projectId: string; id: string; ackRotationPhase: string | null; ackCredentialVersion: number | null }, result: z.output<typeof rotatedAckResultSchema>) {
    const access = await this.transaction.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT operational_executor_scope(${request.organizationId},${request.projectId}) AS allowed`);
    if (access[0]?.allowed !== true) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
    await this.transaction.$executeRaw(Prisma.sql`SELECT set_config('app.actor_id','snapshot-ack-rotation',true)`);
    const rows = await this.transaction.$queryRaw<{ phase: string; previousCredentialVersion: number; credentialVersion: number; createdAt: Date }[]>(Prisma.sql`
      SELECT * FROM snapshot_ack_rotation_operation_proof(${request.organizationId},${request.projectId},${request.id})`);
    await this.transaction.$executeRaw(Prisma.sql`SELECT set_config('app.actor_id','operations-executor',true)`);
    const proof = rows[0];
    if (rows.length !== 1 || !proof || proof.phase !== request.ackRotationPhase || proof.previousCredentialVersion !== request.ackCredentialVersion
      || result.phase !== proof.phase || result.previousCredentialVersion !== proof.previousCredentialVersion || result.credentialVersion !== proof.credentialVersion)
      throw new Error("OPERATIONS_CONTROL_RESULT_INVALID");
    return proof;
  }

  async succeedRotatedAck(lease: ClaimedReliabilityEvent, rawResult: z.input<typeof rotatedAckResultSchema>) {
    const result = rotatedAckResultSchema.parse(rawResult); const intent = operationalActionIntentSchema.parse(lease.payload);
    if (intent.action !== result.action) throw new Error("OPERATIONS_CONTROL_RESULT_INVALID");
    await lockOperationalOutboxLease(this.transaction, lease, { organizationId: intent.organizationId, projectId: intent.projectId,
      topic: OPERATIONAL_ACTION_TOPICS[intent.action], payload: intent });
    const request = await this.read(lease); const proof = await this.assertRotatedAckResult(request,result);
    const changed = await this.transaction.operationalActionRequest.updateMany({ where: { id: request.id,
      organizationId: request.organizationId, projectId: request.projectId, action: result.action, outboxEventId: lease.outboxEventId,
      status: "RUNNING", leaseJobRunId: lease.jobRunId, leaseAttempt: lease.attempt, leaseWorkerId: lease.workerId, leaseAcquiredAt: new Date(lease.leaseAcquiredAt) },
      data: { status: "SUCCEEDED", result, finishedAt: new Date(Math.max(Date.now(),proof.createdAt.getTime(),request.startedAt?.getTime() ?? 0)) } });
    if (changed.count !== 1) throw new Error("OUTBOX_OPERATION_LEASE_LOST"); return result;
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
