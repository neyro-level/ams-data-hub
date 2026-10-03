import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquirePermanentOutboxWorkerGuard } from "../../src/modules/platform-operations/infrastructure/permanent-worker-guard.ts";
import {
  assertOutboxWorkerHeartbeatHealthy,
  WORKER_HEARTBEAT_STALE_MS,
} from "../../src/modules/platform-operations/infrastructure/readiness-runtime.ts";
import {
  OUTBOX_WORKER_RUNTIME,
  recordRuntimeHeartbeat,
} from "../../src/modules/platform-operations/infrastructure/runtime-heartbeat.ts";
import { createPrismaContext } from "../../src/platform/database/prisma/context.ts";
import { runInSystemJobDatabaseTransaction } from "../../src/platform/database/transaction.ts";

const workerId = "runtime-health-integration";

async function clearHeartbeat() {
  await runInSystemJobDatabaseTransaction(
    { jobName: "runtime-health-test", correlationId: crypto.randomUUID() },
    (transaction) =>
      transaction.runtimeHeartbeat.deleteMany({
        where: { runtime: OUTBOX_WORKER_RUNTIME, workerId },
      }),
  );
}

describe("worker runtime health", () => {
  beforeAll(clearHeartbeat);
  afterAll(clearHeartbeat);

  it("accepts a database heartbeat through two intervals and then reports stale", async () => {
    const now = new Date("2026-10-03T20:00:00.000Z");
    await recordRuntimeHeartbeat({ runtime: OUTBOX_WORKER_RUNTIME, workerId, now });
    await expect(
      assertOutboxWorkerHeartbeatHealthy(
        new Date(now.getTime() + WORKER_HEARTBEAT_STALE_MS),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertOutboxWorkerHeartbeatHealthy(
        new Date(now.getTime() + WORKER_HEARTBEAT_STALE_MS + 1),
      ),
    ).rejects.toThrow("stale");
  });

  it("allows only one permanent outbox worker advisory lock", async () => {
    const database = createPrismaContext(process.env);
    try {
      const releaseFirst = await acquirePermanentOutboxWorkerGuard(database.pool);
      await expect(acquirePermanentOutboxWorkerGuard(database.pool)).rejects.toThrow(
        "already active",
      );
      await releaseFirst();
      const releaseSecond = await acquirePermanentOutboxWorkerGuard(database.pool);
      await releaseSecond();
    } finally {
      await database.close();
    }
  });
});
