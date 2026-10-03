import { OutboxStatus } from "../../../generated/prisma/client.ts";
import { runInSystemJobDatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  OUTBOX_WORKER_RUNTIME,
  RUNTIME_HEARTBEAT_WRITE_INTERVAL_MS,
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
  return now.getTime() - lastHeartbeatAt.getTime() <= WORKER_HEARTBEAT_STALE_MS
    ? "healthy"
    : "stale";
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
