import { OutboxStatus } from "../../../generated/prisma/client.ts";
import { getPrismaClient } from "../../../platform/database/prisma/client.ts";
import { OUTBOX_WORKER_RUNTIME } from "./runtime-heartbeat.ts";

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

export const WORKER_HEARTBEAT_STALE_MS = 3 * 60 * 1000;

export function toWorkerStatus(lastHeartbeatAt: Date | null, now: Date) {
  if (!lastHeartbeatAt) return "unknown" as const;
  return now.getTime() - lastHeartbeatAt.getTime() <= WORKER_HEARTBEAT_STALE_MS
    ? "healthy"
    : "stale";
}

export async function getOperationalReadiness(now = new Date()): Promise<OperationalReadiness> {
  const prisma = getPrismaClient();
  const [pending, processing, deadLetter, latestHeartbeat] =
    await Promise.all([
      prisma.outboxEvent.count({ where: { status: OutboxStatus.PENDING } }),
      prisma.outboxEvent.count({ where: { status: OutboxStatus.PROCESSING } }),
      prisma.outboxEvent.count({ where: { status: OutboxStatus.DEAD_LETTER } }),
      prisma.runtimeHeartbeat.findFirst({
        where: { runtime: OUTBOX_WORKER_RUNTIME },
        orderBy: { heartbeatAt: "desc" },
        select: { heartbeatAt: true },
      }),
    ]);

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
