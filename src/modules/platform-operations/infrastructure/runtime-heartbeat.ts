import { Prisma } from "../../../generated/prisma/client.ts";
import { runInSystemJobDatabaseTransaction } from "../../../platform/database/transaction.ts";

export const OUTBOX_WORKER_RUNTIME = "outbox-worker";
export const RUNTIME_HEARTBEAT_WRITE_INTERVAL_MS = 60_000;

export interface RecordRuntimeHeartbeatInput {
  runtime: string;
  workerId: string;
  now?: Date;
}

export async function recordRuntimeHeartbeat({
  runtime,
  workerId,
  now = new Date(),
}: RecordRuntimeHeartbeatInput): Promise<boolean> {
  return runInSystemJobDatabaseTransaction(
    { jobName: runtime, correlationId: `heartbeat-${runtime}-${workerId}-${now.getTime()}` },
    async (transaction) => {
      const identity = { runtime_workerId: { runtime, workerId } };
      const existing = await transaction.runtimeHeartbeat.findUnique({
        where: identity,
        select: { heartbeatAt: true },
      });
      const writeBefore = new Date(now.getTime() - RUNTIME_HEARTBEAT_WRITE_INTERVAL_MS);

      if (existing) {
        if (existing.heartbeatAt.getTime() > writeBefore.getTime()) {
          return false;
        }
        const updated = await transaction.runtimeHeartbeat.updateMany({
          where: { runtime, workerId, heartbeatAt: { lte: writeBefore } },
          data: { heartbeatAt: now },
        });
        return updated.count === 1;
      }

      try {
        await transaction.runtimeHeartbeat.create({
          data: { runtime, workerId, startedAt: now, heartbeatAt: now },
        });
        return true;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return false;
        }
        throw error;
      }
    },
  );
}
