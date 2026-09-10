import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts"
import { Pool } from "pg";
import { ReliabilityService } from "../src/modules/platform-operations/index.ts";
import { PrismaReliabilityRepository } from "../src/modules/platform-operations/server.ts";
import { createPgPoolConfigFromEnvironment } from "../src/platform/database/prisma/pool-config.ts";
import { drainOutbox } from "../src/modules/platform-operations/worker.ts";
import { runReliabilityRetention } from "../src/modules/platform-operations/infrastructure/retention-runtime.ts";
import {
  OUTBOX_WORKER_RUNTIME,
  recordRuntimeHeartbeat,
} from "../src/modules/platform-operations/infrastructure/runtime-heartbeat.ts";

const integrationEnabled = Boolean(
  process.env.TEST_DATABASE_HOST &&
    process.env.TEST_DATABASE_USER &&
    process.env.TEST_DATABASE_PASSWORD &&
    process.env.TEST_DATABASE_NAME,
);
const integrationDescription = integrationEnabled ? describe : describe.skip;
const correlationId = "00000000-0000-4000-8000-000000000030";

integrationDescription("reliability foundation", () => {
  let prisma: PrismaClient;
  let pool: Pool;
  let organizationId: string;
  let now = new Date("2026-09-03T00:00:00.000Z");
  const repository = new PrismaReliabilityRepository();
  const service = new ReliabilityService(repository, () => now);

  beforeAll(async () => {
    pool = new Pool(
      createPgPoolConfigFromEnvironment({
        DATABASE_HOST: process.env.TEST_DATABASE_HOST,
        DATABASE_PORT: process.env.TEST_DATABASE_PORT,
        DATABASE_USER: process.env.TEST_DATABASE_USER,
        DATABASE_PASSWORD: process.env.TEST_DATABASE_PASSWORD,
        DATABASE_NAME: process.env.TEST_DATABASE_NAME,
        DATABASE_SSLMODE: process.env.TEST_DATABASE_SSLMODE,
      }),
    );
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    organizationId = (
      await prisma.organization.findUniqueOrThrow({
        where: { slug: "alpha" },
        select: { id: true },
      })
    ).id;
    await prisma.jobRun.deleteMany();
    await prisma.runtimeHeartbeat.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.auditEvent.deleteMany();
    await prisma.outboxEvent.deleteMany();
  });

  afterAll(async () => {
    await prisma.jobRun.deleteMany();
    await prisma.runtimeHeartbeat.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.auditEvent.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.$disconnect();
    await pool.end();
  });

  it("atomically enqueues audit, idempotency and outbox records", async () => {
    const command = {
      organizationId,
      organizationScope: organizationId,
      idempotencyScope: "project.sync.enqueue",
      idempotencyKey: "request-001",
      topic: "test.reliability",
      payload: { projectSlug: "alpha", trigger: "manual" },
      actorType: "USER" as const,
      actorId: "platform-admin-test",
      action: "project.sync.enqueue",
      entityType: "Project",
      entityId: "alpha",
      source: "integration-test",
      correlationId,
    };

    const first = await service.enqueue(command);
    const duplicate = await service.enqueue({
      ...command,
      payload: { trigger: "manual", projectSlug: "alpha" },
    });

    expect(first.duplicate).toBe(false);
    expect(duplicate).toEqual({ outboxEventId: first.outboxEventId, duplicate: true });
    expect(await prisma.auditEvent.count()).toBe(1);
    expect(await prisma.idempotencyKey.count()).toBe(1);
    const outboxEvent = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: first.outboxEventId },
      select: { schemaVersion: true, occurredAt: true },
    });
    expect(outboxEvent.schemaVersion).toBe(1);
    expect(outboxEvent.occurredAt.toISOString()).toBe("2026-09-03T00:00:00.000Z");
    expect(await prisma.outboxEvent.count()).toBe(1);
    await expect(
      service.enqueue({ ...command, payload: { projectSlug: "other", trigger: "manual" } }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("claims with ownership, retries with backoff and completes exactly once", async () => {
    const firstClaim = await service.claim("worker-a", 60_000);
    expect(firstClaim).toMatchObject({ workerId: "worker-a", attempt: 1 });
    expect(await service.claim("worker-b", 60_000)).toBeNull();

    await expect(
      service.complete({ ...firstClaim!, workerId: "worker-b" }),
    ).rejects.toMatchObject({ code: "OUTBOX_LEASE_LOST" });

    const failure = await service.fail(firstClaim!, "TEMPORARY_FAILURE", true, 3);
    expect(failure.status).toBe("pending");
    expect(failure.availableAt).toBe("2026-09-03T00:00:30.000Z");

    now = new Date("2026-09-03T00:00:31.000Z");
    const secondClaim = await service.claim("worker-b", 60_000);
    expect(secondClaim).toMatchObject({ workerId: "worker-b", attempt: 2 });
    await service.complete(secondClaim!);

    expect(await service.getHealth()).toEqual({ pending: 0, processing: 0, deadLetter: 0 });
    expect(
      await prisma.jobRun.findMany({ orderBy: { attempt: "asc" }, select: { status: true } }),
    ).toEqual([{ status: "FAILED" }, { status: "SUCCESS" }]);
  });

  it("does not lease one event to two concurrent drainers", async () => {
    const enqueue = (key: string) => service.enqueue({
      organizationId: null,
      organizationScope: "platform",
      idempotencyScope: "outbox.concurrent",
      idempotencyKey: key,
      topic: "test.concurrent",
      payload: { key },
      actorType: "SYSTEM",
      actorId: null,
      action: "outbox.test.enqueue",
      entityType: "OutboxEvent",
      entityId: null,
      source: "integration-test",
      correlationId,
    });
    await Promise.all([enqueue("concurrent-1"), enqueue("concurrent-2")]);

    const concurrent = await Promise.all([
      service.claim("concurrent-worker-a", 60_000),
      service.claim("concurrent-worker-b", 60_000),
    ]);
    const claimed = concurrent.filter((item): item is NonNullable<typeof item> => item !== null);
    expect(new Set(claimed.map((item) => item.outboxEventId)).size).toBe(claimed.length);
    for (const item of claimed) {
      await service.complete(item);
    }
    const remaining = await service.claim("concurrent-worker-c", 60_000);
    if (remaining) {
      expect(claimed.map((item) => item.outboxEventId)).not.toContain(remaining.outboxEventId);
      await service.complete(remaining);
    }
    expect(await service.getHealth()).toEqual({ pending: 0, processing: 0, deadLetter: 0 });
  });

  it("moves unknown topics to dead letter through the real outbox processor", async () => {
    await service.enqueue({
      organizationId: null,
      organizationScope: "platform",
      idempotencyScope: "outbox.unknown",
      idempotencyKey: "request-unknown",
      topic: "unknown.topic",
      payload: { value: "test" },
      actorType: "SYSTEM",
      actorId: null,
      action: "outbox.test.enqueue",
      entityType: "OutboxEvent",
      entityId: null,
      source: "integration-test",
      correlationId,
    });

    const dispatched = await drainOutbox({ workerId: "integration-worker", maxEvents: 1 });
    expect(dispatched).toEqual({ claimed: 1, completed: 0, failed: 0 });
    expect(await service.getHealth()).toEqual({ pending: 0, processing: 1, deadLetter: 0 });

    const processed = await drainOutbox({ workerId: "integration-worker", maxEvents: 1 });
    expect(processed).toEqual({ claimed: 1, completed: 0, failed: 1 });
    expect(await service.getHealth()).toEqual({ pending: 0, processing: 0, deadLetter: 1 });
  });

  it("stores one throttled heartbeat per runtime and worker", async () => {
    const first = new Date("2026-09-06T12:00:00.000Z");
    expect(
      await recordRuntimeHeartbeat({ runtime: OUTBOX_WORKER_RUNTIME, workerId: "idle-worker", now: first }),
    ).toBe(true);
    expect(
      await recordRuntimeHeartbeat({
        runtime: OUTBOX_WORKER_RUNTIME,
        workerId: "idle-worker",
        now: new Date(first.getTime() + 30_000),
      }),
    ).toBe(false);
    expect(
      await recordRuntimeHeartbeat({
        runtime: OUTBOX_WORKER_RUNTIME,
        workerId: "idle-worker",
        now: new Date(first.getTime() + 61_000),
      }),
    ).toBe(true);

    const heartbeats = await prisma.runtimeHeartbeat.findMany({
      where: { runtime: OUTBOX_WORKER_RUNTIME, workerId: "idle-worker" },
      select: { heartbeatAt: true },
    });
    expect(heartbeats).toEqual([{ heartbeatAt: new Date(first.getTime() + 61_000) }]);
  });

  it("retains only old processed and dead-letter outbox history", async () => {
    const processed = await prisma.outboxEvent.create({
      data: {
        organizationId,
        topic: "retention.processed",
        payload: { value: "processed" },
        schemaVersion: 1,
        occurredAt: new Date("2026-07-01T00:00:00.000Z"),
        status: "PROCESSED",
        correlationId,
        processedAt: new Date("2026-07-01T00:00:00.000Z"),
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
    await prisma.jobRun.create({
      data: {
        organizationId,
        outboxEventId: processed.id,
        jobType: "retention.processed",
        status: "SUCCESS",
        attempt: 1,
        workerId: "retention-worker",
        startedAt: new Date("2026-07-01T00:00:00.000Z"),
        finishedAt: new Date("2026-07-01T00:00:01.000Z"),
        correlationId,
      },
    });
    const deadLetter = await prisma.outboxEvent.create({
      data: {
        organizationId,
        topic: "retention.dead-letter",
        payload: { value: "dead-letter" },
        schemaVersion: 1,
        occurredAt: new Date("2026-06-01T00:00:00.000Z"),
        status: "DEAD_LETTER",
        correlationId,
        lastErrorCode: "UNKNOWN_OUTBOX_TOPIC",
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
    await prisma.jobRun.create({
      data: {
        organizationId,
        outboxEventId: deadLetter.id,
        jobType: "retention.dead-letter",
        status: "FAILED",
        attempt: 1,
        workerId: "retention-worker",
        startedAt: new Date("2026-06-01T00:00:00.000Z"),
        finishedAt: new Date("2026-06-01T00:00:01.000Z"),
        safeErrorCode: "UNKNOWN_OUTBOX_TOPIC",
        correlationId,
      },
    });
    const recent = await prisma.outboxEvent.create({
      data: {
        organizationId,
        topic: "retention.recent",
        payload: { value: "recent" },
        schemaVersion: 1,
        occurredAt: new Date("2026-09-02T00:00:00.000Z"),
        status: "PROCESSED",
        correlationId,
        processedAt: new Date("2026-09-02T00:00:00.000Z"),
        createdAt: new Date("2026-09-02T00:00:00.000Z"),
      },
      select: { id: true },
    });

    const result = await runReliabilityRetention(new Date("2026-09-04T00:00:00.000Z"));
    expect(result.deletedOutboxEvents).toBe(2);
    expect(result.deletedJobRuns).toBe(2);
    expect(await prisma.outboxEvent.findUnique({ where: { id: processed.id } })).toBeNull();
    expect(await prisma.outboxEvent.findUnique({ where: { id: deadLetter.id } })).toBeNull();
    expect(await prisma.outboxEvent.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(await prisma.retentionRun.findUnique({ where: { id: result.retentionRunId } })).not.toBeNull();
  });
});
