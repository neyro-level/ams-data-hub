import { Prisma } from "../../../generated/prisma/client.ts";
import { runInSystemJobDatabaseTransaction } from "../../../platform/database/transaction.ts";

export const OUTBOX_WORKER_RUNTIME = "outbox-worker";
export const SOURCE_WORKER_RUNTIME = "source-worker";
export const RUNTIME_HEARTBEAT_WRITE_INTERVAL_MS = 60_000;

export function assertSourceWorkerId(workerId: string): void {
  if (typeof workerId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(workerId)) throw new Error("SOURCE_WORKER_ID_INVALID");
}

/** Published only by the active consumer after its actual queue probe succeeds. */
export async function recordSourceWorkerHeartbeat(workerId: string): Promise<void> {
  assertSourceWorkerId(workerId);
  await runInSystemJobDatabaseTransaction({ jobName: SOURCE_WORKER_RUNTIME, correlationId: "source-heartbeat" }, async (tx) => {
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    await tx.runtimeHeartbeat.upsert({ where: { runtime_workerId: { runtime: SOURCE_WORKER_RUNTIME, workerId } },
      create: { runtime: SOURCE_WORKER_RUNTIME, workerId, startedAt: clock!.now, heartbeatAt: clock!.now },
      update: { heartbeatAt: clock!.now } });
  });
}

export async function clearSourceWorkerHeartbeat(workerId: string): Promise<void> {
  assertSourceWorkerId(workerId);
  await runInSystemJobDatabaseTransaction({ jobName: SOURCE_WORKER_RUNTIME, correlationId: "source-heartbeat-clear" },
    (tx) => tx.runtimeHeartbeat.deleteMany({ where: { runtime: SOURCE_WORKER_RUNTIME, workerId } }));
}

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
