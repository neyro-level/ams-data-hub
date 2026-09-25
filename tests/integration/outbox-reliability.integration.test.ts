import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ReliabilityService } from "../../src/modules/platform-operations/application/reliability-service.ts";
import { PrismaReliabilityRepository } from "../../src/modules/platform-operations/infrastructure/prisma-reliability-repository.ts";
import { runReliabilityRetention } from "../../src/modules/platform-operations/infrastructure/retention-runtime.ts";
import { getOperationalReadiness } from "../../src/modules/platform-operations/infrastructure/readiness-runtime.ts";
import {
  OUTBOX_WORKER_RUNTIME,
  recordRuntimeHeartbeat,
} from "../../src/modules/platform-operations/infrastructure/runtime-heartbeat.ts";
import { runInSystemJobDatabaseTransaction } from "../../src/platform/database/transaction.ts";

function command(key: string, payload: Record<string, unknown> = { operation: "smoke" }) {
  return {
    organizationId: null,
    organizationScope: "platform",
    idempotencyScope: "e05.reliability",
    idempotencyKey: key,
    topic: "platform.maintenance.requested",
    payload,
    actorType: "SYSTEM" as const,
    actorId: null,
    action: "platform.maintenance.request",
    entityType: "Platform",
    entityId: null,
    source: "e05-integration",
    correlationId: randomUUID(),
  };
}

async function enqueue(now: Date, key: string, payload?: Record<string, unknown>) {
  return runInSystemJobDatabaseTransaction(
    { jobName: "e05-enqueue", correlationId: randomUUID() },
    (transaction) =>
      new ReliabilityService(new PrismaReliabilityRepository(transaction), () => now).enqueue(
        command(key, payload),
      ),
  );
}

function service(now: Date) {
  return new ReliabilityService(new PrismaReliabilityRepository(), () => now);
}

describe("E05 outbox reliability", () => {
  it("allows only one competing worker to claim an event", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    await enqueue(now, `claim-${randomUUID()}`);

    const claims = await Promise.all([
      service(now).claim("worker-a"),
      service(now).claim("worker-b"),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    await service(now).complete(claims.find(Boolean)!);
  });

  it("rejects stale completion after lease recovery even for the same worker id", async () => {
    const startedAt = new Date("2026-01-02T00:00:00.000Z");
    await enqueue(startedAt, `lease-${randomUUID()}`);
    const first = await service(startedAt).claim("stable-worker", 1_000);
    expect(first).not.toBeNull();

    const recoveredAt = new Date(startedAt.getTime() + 2_000);
    const recovered = await service(recoveredAt).claim("stable-worker", 1_000);
    expect(recovered).not.toBeNull();
    expect(recovered?.attempt).toBe(2);
    expect(recovered?.leaseAcquiredAt).not.toBe(first?.leaseAcquiredAt);

    await expect(service(recoveredAt).complete(first!)).rejects.toMatchObject({
      code: "OUTBOX_LEASE_LOST",
    });
    await expect(service(recoveredAt).takeOver(first!, "handler-stale")).resolves.toBeNull();
    await expect(service(recoveredAt).complete(recovered!)).resolves.toBeUndefined();
  });

  it("rolls back lease takeover when its job run precondition is missing", async () => {
    const startedAt = new Date("2026-01-02T01:00:00.000Z");
    await enqueue(startedAt, `takeover-${randomUUID()}`);
    const claimed = await service(startedAt).claim("publisher-worker");
    await runInSystemJobDatabaseTransaction(
      { jobName: "e05-remove-job-run", correlationId: randomUUID() },
      (transaction) => transaction.jobRun.delete({ where: { id: claimed!.jobRunId } }),
    );

    await expect(service(new Date(startedAt.getTime() + 100)).takeOver(
      claimed!,
      "handler-worker",
    )).resolves.toBeNull();
    const lease = await runInSystemJobDatabaseTransaction(
      { jobName: "e05-takeover-proof", correlationId: randomUUID() },
      (transaction) => transaction.outboxEvent.findUniqueOrThrow({
        where: { id: claimed!.outboxEventId },
        select: { lockedBy: true, lockedAt: true },
      }),
    );
    expect(lease).toEqual({
      lockedBy: claimed!.workerId,
      lockedAt: new Date(claimed!.leaseAcquiredAt),
    });
    await runInSystemJobDatabaseTransaction(
      { jobName: "e05-settle-orphan-fixture", correlationId: randomUUID() },
      (transaction) => transaction.outboxEvent.update({
        where: { id: claimed!.outboxEventId },
        data: { status: "PROCESSED", processedAt: startedAt, lockedAt: null, lockedBy: null },
      }),
    );
  });

  it("rejects an idempotency key reused with changed payload", async () => {
    const now = new Date("2026-01-03T00:00:00.000Z");
    const key = `idempotency-${randomUUID()}`;
    const first = await enqueue(now, key, { version: 1 });

    await expect(enqueue(now, key, { version: 2 })).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    const count = await runInSystemJobDatabaseTransaction(
      { jobName: "e05-count", correlationId: randomUUID() },
      (transaction) => transaction.outboxEvent.count({ where: { id: first.outboxEventId } }),
    );
    expect(count).toBe(1);
    const claimed = await service(now).claim("idempotency-worker");
    await service(now).complete(claimed!);
  });

  it("creates one deduplicated notification after retry exhaustion", async () => {
    const startedAt = new Date("2026-01-04T00:00:00.000Z");
    const created = await enqueue(startedAt, `retry-${randomUUID()}`);
    const first = await service(startedAt).claim("retry-worker");
    const retry = await service(startedAt).fail(first!, "TEMPORARY_FAILURE", true, 2);
    expect(retry.status).toBe("pending");

    const retriedAt = new Date(retry.availableAt!);
    const second = await service(retriedAt).claim("retry-worker");
    const terminal = await service(retriedAt).fail(second!, "TEMPORARY_FAILURE", true, 2);
    expect(terminal.status).toBe("dead_letter");
    await expect(service(retriedAt).fail(second!, "TEMPORARY_FAILURE", true, 2)).rejects.toMatchObject({
      code: "OUTBOX_LEASE_LOST",
    });

    const notifications = await runInSystemJobDatabaseTransaction(
      { jobName: "e05-notifications", correlationId: randomUUID() },
      (transaction) =>
        transaction.notification.count({
          where: { dedupKey: `outbox-dead:${created.outboxEventId}` },
        }),
    );
    expect(notifications).toBe(1);
  });

  it("reports worker heartbeat and queue degradation without exposing payloads", async () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    await recordRuntimeHeartbeat({
      runtime: OUTBOX_WORKER_RUNTIME,
      workerId: "readiness-worker",
      now,
    });

    const readiness = await getOperationalReadiness(new Date(now.getTime() + 1_000));
    expect(readiness.worker).toEqual({
      status: "healthy",
      lastHeartbeatAt: now.toISOString(),
    });
    expect(readiness.queue.status).toBe("degraded");
    expect(readiness.queue.deadLetter).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(readiness)).not.toContain("TEMPORARY_FAILURE");
  });

  it("keeps runtime worker roles without schema DDL privileges", async () => {
    const [privileges] = await runInSystemJobDatabaseTransaction(
      { jobName: "e05-runtime-acl", correlationId: randomUUID() },
      (transaction) => transaction.$queryRaw<Array<{ public_create: boolean; pgboss_create: boolean }>>`
        select
          has_schema_privilege('ams_start_worker', 'public', 'CREATE') as public_create,
          has_schema_privilege('ams_start_worker', 'pgboss', 'CREATE') as pgboss_create
      `,
    );
    expect(privileges).toEqual({ public_create: false, pgboss_create: false });
  });

  it("removes expired settled events but preserves a live lease", async () => {
    const now = new Date("2026-02-20T00:00:00.000Z");
    const old = new Date("2025-12-01T00:00:00.000Z");
    const ids = await runInSystemJobDatabaseTransaction(
      { jobName: "e05-retention-fixture", correlationId: randomUUID() },
      async (transaction) => {
        const processed = await transaction.outboxEvent.create({
          data: {
            topic: "platform.maintenance.requested",
            payload: {},
            correlationId: randomUUID(),
            occurredAt: old,
            availableAt: old,
            status: "PROCESSED",
            processedAt: old,
          },
        });
        await transaction.jobRun.create({
          data: {
            outboxEventId: processed.id,
            jobType: processed.topic,
            status: "SUCCESS",
            attempt: 1,
            workerId: "retention-worker",
            startedAt: old,
            finishedAt: old,
            correlationId: processed.correlationId,
          },
        });
        const leased = await transaction.outboxEvent.create({
          data: {
            topic: "platform.maintenance.requested",
            payload: {},
            correlationId: randomUUID(),
            occurredAt: old,
            availableAt: old,
            status: "PROCESSING",
            attempts: 1,
            lockedAt: now,
            lockedBy: "live-worker",
          },
        });
        return { processed: processed.id, leased: leased.id };
      },
    );

    const result = await runReliabilityRetention(now);
    const remaining = await runInSystemJobDatabaseTransaction(
      { jobName: "e05-retention-proof", correlationId: randomUUID() },
      (transaction) => transaction.outboxEvent.findMany({
        where: { id: { in: [ids.processed, ids.leased] } },
        select: { id: true },
      }),
    );

    expect(result.deletedOutboxEvents).toBeGreaterThanOrEqual(1);
    expect(result.deletedJobRuns).toBeGreaterThanOrEqual(1);
    expect(remaining).toEqual([{ id: ids.leased }]);
  });
});
