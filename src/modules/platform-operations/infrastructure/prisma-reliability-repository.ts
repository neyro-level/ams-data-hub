import {
  AuditActorType,
  IdempotencyStatus,
  JobRunStatus,
  OutboxStatus,
  Prisma,
} from "../../../generated/prisma/client.ts";
import {
  runInSystemJobDatabaseTransaction,
  type DatabaseTransaction,
} from "../../../platform/database/transaction.ts";
import type {
  ClaimReliabilityEventInput,
  ClaimedReliabilityEvent,
  CompleteReliabilityEventInput,
  EnqueueReliabilityEventInput,
  EnqueueReliabilityEventResult,
  FailReliabilityEventInput,
  FailReliabilityEventResult,
  OutboxHealth,
  ReliabilityRepository,
  TakeOverReliabilityEventInput,
} from "../application/ports/reliability-repository.ts";

function reliabilityError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function toClaimedEvent(event: {
  id: string;
  organizationId: string | null;
  topic: string;
  payload: Prisma.JsonValue;
  attempts: number;
  correlationId: string;
  schemaVersion: number;
  occurredAt: Date;
}, jobRunId: string, workerId: string): ClaimedReliabilityEvent {
  return {
    outboxEventId: event.id,
    jobRunId,
    workerId,
    organizationId: event.organizationId,
    topic: event.topic,
    payload: event.payload as Record<string, unknown>,
    attempt: event.attempts,
    correlationId: event.correlationId,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt.toISOString(),
  };
}

export class PrismaReliabilityRepository implements ReliabilityRepository {
  constructor(private readonly commandTransaction?: DatabaseTransaction) {}

  async enqueueEvent(
    input: EnqueueReliabilityEventInput,
  ): Promise<EnqueueReliabilityEventResult> {
    const transaction = this.commandTransaction;
    if (!transaction) {
      throw reliabilityError(
        "COMMAND_TRANSACTION_REQUIRED",
        "Outbox enqueue requires the command transaction",
      );
    }
    const uniqueWhere = {
      scope_organizationScope_key: {
        scope: input.idempotencyScope,
        organizationScope: input.organizationScope,
        key: input.idempotencyKey,
      },
    };

    const lockKey = `${input.idempotencyScope}:${input.organizationScope}:${input.idempotencyKey}`;
    await transaction.$queryRaw(Prisma.sql`
      select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text as lock_result
    `);

    const existing = await transaction.idempotencyKey.findUnique({
      where: uniqueWhere,
      select: { requestHash: true, outboxEventId: true },
    });
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        throw reliabilityError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency key was reused with a different request",
        );
      }
      if (!existing.outboxEventId) {
        throw reliabilityError("IDEMPOTENCY_IN_PROGRESS", "Idempotent command is in progress");
      }
      return { outboxEventId: existing.outboxEventId, duplicate: true };
    }

    const marker = await transaction.idempotencyKey.create({
      data: {
        organizationId: input.organizationId,
        organizationScope: input.organizationScope,
        scope: input.idempotencyScope,
        key: input.idempotencyKey,
        requestHash: input.requestHash,
        status: IdempotencyStatus.PROCESSING,
        expiresAt: new Date(input.expiresAt),
      },
      select: { id: true },
    });
    const event = await transaction.outboxEvent.create({
      data: {
        organizationId: input.organizationId,
        topic: input.topic,
        payload: input.payload as Prisma.InputJsonValue,
        correlationId: input.correlationId,
        schemaVersion: input.schemaVersion,
        occurredAt: new Date(input.occurredAt),
        availableAt: new Date(input.availableAt),
      },
      select: { id: true },
    });
    await transaction.idempotencyKey.update({
      where: { id: marker.id },
      data: {
        status: IdempotencyStatus.COMPLETED,
        outboxEventId: event.id,
        response: { outboxEventId: event.id },
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType:
          input.actorType === "USER" ? AuditActorType.USER : AuditActorType.SYSTEM,
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        afterMarker: { outboxEventId: event.id, topic: input.topic },
        source: input.source,
        correlationId: input.correlationId,
      },
    });

    return { outboxEventId: event.id, duplicate: false };
  }

  async claimNextEvent(
    input: ClaimReliabilityEventInput,
  ): Promise<ClaimedReliabilityEvent | null> {
    const now = new Date(input.now);
    const expiredLease = new Date(now.getTime() - input.leaseTimeoutMs);

    return runInSystemJobDatabaseTransaction(
      { jobName: "outbox-claim", correlationId: `outbox-claim-${input.workerId}-${input.now}` },
      async (transaction) => {
      const claimable = {
        OR: [
          { status: OutboxStatus.PENDING, availableAt: { lte: now } },
          { status: OutboxStatus.PROCESSING, lockedAt: { lte: expiredLease } },
        ],
      } satisfies Prisma.OutboxEventWhereInput;
      const candidate = await transaction.outboxEvent.findFirst({
        where: claimable,
        orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          organizationId: true,
          topic: true,
          payload: true,
          attempts: true,
          correlationId: true,
          schemaVersion: true,
          occurredAt: true,
        },
      });
      if (!candidate) {
        return null;
      }

      const claimed = await transaction.outboxEvent.updateMany({
        where: { id: candidate.id, ...claimable },
        data: {
          status: OutboxStatus.PROCESSING,
          attempts: { increment: 1 },
          lockedAt: now,
          lockedBy: input.workerId,
        },
      });
      if (claimed.count !== 1) {
        return null;
      }

      const attempt = candidate.attempts + 1;
      const jobRun = await transaction.jobRun.create({
        data: {
          organizationId: candidate.organizationId,
          outboxEventId: candidate.id,
          jobType: candidate.topic,
          status: JobRunStatus.RUNNING,
          attempt,
          workerId: input.workerId,
          startedAt: now,
          correlationId: candidate.correlationId,
        },
        select: { id: true },
      });

      return toClaimedEvent(
        {
          ...candidate,
          attempts: attempt,
        },
        jobRun.id,
        input.workerId,
      );
      },
    );
  }

  async takeOverEvent(
    input: TakeOverReliabilityEventInput,
  ): Promise<ClaimedReliabilityEvent | null> {
    const now = new Date(input.now);
    return runInSystemJobDatabaseTransaction(
      { jobName: "outbox-takeover", correlationId: `outbox-takeover-${input.workerId}-${input.now}` },
      async (transaction) => {
      const event = await transaction.outboxEvent.findFirst({
        where: {
          id: input.outboxEventId,
          status: OutboxStatus.PROCESSING,
        },
        select: {
          id: true,
          organizationId: true,
          topic: true,
          payload: true,
          attempts: true,
          correlationId: true,
          schemaVersion: true,
          occurredAt: true,
        },
      });
      if (!event) {
        return null;
      }
      const updatedEvent = await transaction.outboxEvent.updateMany({
        where: {
          id: input.outboxEventId,
          status: OutboxStatus.PROCESSING,
        },
        data: {
          lockedAt: now,
          lockedBy: input.workerId,
        },
      });
      const updatedJob = await transaction.jobRun.updateMany({
        where: {
          id: input.jobRunId,
          outboxEventId: input.outboxEventId,
          status: JobRunStatus.RUNNING,
        },
        data: {
          workerId: input.workerId,
          startedAt: now,
        },
      });
      if (updatedEvent.count !== 1 || updatedJob.count !== 1) {
        return null;
      }
      return toClaimedEvent(event, input.jobRunId, input.workerId);
      },
    );
  }

  async completeEvent(input: CompleteReliabilityEventInput): Promise<void> {
    await runInSystemJobDatabaseTransaction(
      { jobName: "outbox-complete", correlationId: `outbox-complete-${input.workerId}-${input.finishedAt}` },
      async (transaction) => {
      const event = await transaction.outboxEvent.updateMany({
        where: {
          id: input.outboxEventId,
          status: OutboxStatus.PROCESSING,
          lockedBy: input.workerId,
        },
        data: {
          status: OutboxStatus.PROCESSED,
          processedAt: new Date(input.finishedAt),
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: null,
        },
      });
      const job = await transaction.jobRun.updateMany({
        where: {
          id: input.jobRunId,
          outboxEventId: input.outboxEventId,
          workerId: input.workerId,
          status: JobRunStatus.RUNNING,
        },
        data: {
          status: JobRunStatus.SUCCESS,
          finishedAt: new Date(input.finishedAt),
          safeErrorCode: null,
        },
      });
      if (event.count !== 1 || job.count !== 1) {
        throw reliabilityError("OUTBOX_LEASE_LOST", "Outbox lease ownership was lost");
      }
      },
    );
  }

  async failEvent(input: FailReliabilityEventInput): Promise<FailReliabilityEventResult> {
    return runInSystemJobDatabaseTransaction(
      { jobName: "outbox-fail", correlationId: `outbox-fail-${input.workerId}-${input.finishedAt}` },
      async (transaction) => {
      const event = await transaction.outboxEvent.findFirst({
        where: {
          id: input.outboxEventId,
          status: OutboxStatus.PROCESSING,
          lockedBy: input.workerId,
        },
        select: { attempts: true, organizationId: true, topic: true },
      });
      if (!event) {
        throw reliabilityError("OUTBOX_LEASE_LOST", "Outbox lease ownership was lost");
      }

      const terminal = !input.retryable || event.attempts >= input.maxAttempts;
      const backoffSeconds = Math.min(3600, 30 * 2 ** Math.max(0, event.attempts - 1));
      const availableAt = terminal
        ? null
        : new Date(new Date(input.finishedAt).getTime() + backoffSeconds * 1000);

      const updated = await transaction.outboxEvent.updateMany({
        where: {
          id: input.outboxEventId,
          status: OutboxStatus.PROCESSING,
          lockedBy: input.workerId,
        },
        data: {
          status: terminal ? OutboxStatus.DEAD_LETTER : OutboxStatus.PENDING,
          availableAt: availableAt ?? undefined,
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: input.safeErrorCode,
        },
      });
      const job = await transaction.jobRun.updateMany({
        where: {
          id: input.jobRunId,
          outboxEventId: input.outboxEventId,
          workerId: input.workerId,
          status: JobRunStatus.RUNNING,
        },
        data: {
          status: JobRunStatus.FAILED,
          finishedAt: new Date(input.finishedAt),
          safeErrorCode: input.safeErrorCode,
        },
      });
      if (updated.count !== 1 || job.count !== 1) {
        throw reliabilityError("OUTBOX_LEASE_LOST", "Outbox lease ownership was lost");
      }
      if (terminal) {
        await transaction.notification.createMany({
          data: [{ organizationId: null, category: "QUEUE", severity: "ERROR", visibility: "PLATFORM_ADMIN_ONLY", title: "Задание остановлено", message: `Задание ${event.topic} помещено в dead letter. Код: ${input.safeErrorCode}`, route: "/admin/operations/", sourceType: "OutboxEvent", sourceId: input.outboxEventId, dedupKey: `outbox-dead:${input.outboxEventId}`, occurredAt: new Date(input.finishedAt) }],
          skipDuplicates: true,
        });
      }

      return {
        status: terminal ? "dead_letter" : "pending",
        availableAt: availableAt?.toISOString() ?? null,
      };
      },
    );
  }

  async getOutboxHealth(): Promise<OutboxHealth> {
    const [pending, processing, deadLetter] = await runInSystemJobDatabaseTransaction(
      { jobName: "outbox-health", correlationId: `outbox-health-${Date.now()}` },
      (transaction) => Promise.all([
        transaction.outboxEvent.count({ where: { status: OutboxStatus.PENDING } }),
        transaction.outboxEvent.count({ where: { status: OutboxStatus.PROCESSING } }),
        transaction.outboxEvent.count({ where: { status: OutboxStatus.DEAD_LETTER } }),
      ]),
    );
    return { pending, processing, deadLetter };
  }
}
