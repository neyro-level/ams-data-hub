import { OutboxStatus } from "../../../generated/prisma/client.ts";
import { runInSystemJobDatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  OUTBOX_WORKER_RUNTIME,
  RUNTIME_HEARTBEAT_WRITE_INTERVAL_MS,
  SOURCE_WORKER_RUNTIME,
  assertSourceWorkerId,
} from "./runtime-heartbeat.ts";

export interface WorkerHeartbeatHealth {
  status: "healthy" | "stale" | "unknown";
  lastHeartbeatAt: string | null;
}

export interface QueueHealth {
  status: "healthy" | "degraded";
  pending: number;
  processing: number;
  deadLetter: number;
}

export interface OperationalReadiness {
  queue: QueueHealth;
  worker: WorkerHeartbeatHealth;
}

export const WORKER_HEARTBEAT_STALE_MS = 2 * RUNTIME_HEARTBEAT_WRITE_INTERVAL_MS;

export function toWorkerStatus(lastHeartbeatAt: Date | null, now: Date) {
  if (!lastHeartbeatAt) return "unknown" as const;
  const age = now.getTime() - lastHeartbeatAt.getTime();
  return Number.isFinite(age) && age >= 0 && age <= WORKER_HEARTBEAT_STALE_MS
    ? "healthy"
    : "stale";
}

export interface SourceWorkerReadiness {
  pgBoss: "connected" | "unconfirmed";
  sourceConsumer: "active" | "unconfirmed";
  heartbeat: WorkerHeartbeatHealth;
}

/** Exact owner, not the latest unrelated runtime. These are TTL-qualified
 * observations, not a new connection opened by the reader. */
export async function getSourceWorkerReadiness(workerId: string): Promise<SourceWorkerReadiness> {
  assertSourceWorkerId(workerId);
  const { heartbeatAt, now } = await runInSystemJobDatabaseTransaction(
    { jobName: "source-worker-healthcheck", correlationId: "source-healthcheck" }, async (tx) => {
      const row = await tx.runtimeHeartbeat.findUnique({ where: { runtime_workerId: { runtime: SOURCE_WORKER_RUNTIME, workerId } },
        select: { heartbeatAt: true } });
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      return { heartbeatAt: row?.heartbeatAt ?? null, now: clock!.now };
    });
  const status = toWorkerStatus(heartbeatAt, now);
  const qualified = status === "healthy";
  return { pgBoss: qualified ? "connected" : "unconfirmed", sourceConsumer: qualified ? "active" : "unconfirmed",
    heartbeat: { status, lastHeartbeatAt: heartbeatAt?.toISOString() ?? null } };
}

export async function assertSourceWorkerHealthy(workerId: string): Promise<void> {
  if ((await getSourceWorkerReadiness(workerId)).heartbeat.status !== "healthy") throw new Error("SOURCE_WORKER_NOT_READY");
}

export async function getOutboxWorkerHeartbeatHealth(
  now = new Date(),
): Promise<WorkerHeartbeatHealth> {
  const latestHeartbeat = await runInSystemJobDatabaseTransaction(
    {
      jobName: "outbox-worker-healthcheck",
      correlationId: `worker-healthcheck-${now.getTime()}`,
    },
    (transaction) =>
      transaction.runtimeHeartbeat.findFirst({
        where: { runtime: OUTBOX_WORKER_RUNTIME },
        orderBy: { heartbeatAt: "desc" },
        select: { heartbeatAt: true },
      }),
  );
  const lastHeartbeatAt = latestHeartbeat?.heartbeatAt ?? null;
  return {
    status: toWorkerStatus(lastHeartbeatAt, now),
    lastHeartbeatAt: lastHeartbeatAt?.toISOString() ?? null,
  };
}

export async function assertOutboxWorkerHeartbeatHealthy(now = new Date()): Promise<void> {
  const heartbeat = await getOutboxWorkerHeartbeatHealth(now);
  if (heartbeat.status !== "healthy") {
    throw new Error(`Outbox worker heartbeat is ${heartbeat.status}`);
  }
}

export async function getOperationalReadiness(now = new Date()): Promise<OperationalReadiness> {
  const [pending, processing, deadLetter, latestHeartbeat] =
    await runInSystemJobDatabaseTransaction(
      {
        jobName: "operations-readiness",
        correlationId: `readiness-${now.getTime()}`,
      },
      (transaction) =>
        Promise.all([
          transaction.outboxEvent.count({ where: { status: OutboxStatus.PENDING } }),
          transaction.outboxEvent.count({ where: { status: OutboxStatus.PROCESSING } }),
          transaction.outboxEvent.count({ where: { status: OutboxStatus.DEAD_LETTER } }),
          transaction.runtimeHeartbeat.findFirst({
            where: { runtime: OUTBOX_WORKER_RUNTIME },
            orderBy: { heartbeatAt: "desc" },
            select: { heartbeatAt: true },
          }),
        ]),
    );

  const lastHeartbeatDate = latestHeartbeat?.heartbeatAt ?? null;

  return {
    queue: {
      status: deadLetter > 0 ? "degraded" : "healthy",
      pending,
      processing,
      deadLetter,
    },
    worker: {
      status: toWorkerStatus(lastHeartbeatDate, now),
      lastHeartbeatAt: lastHeartbeatDate?.toISOString() ?? null,
    },
  };
}
