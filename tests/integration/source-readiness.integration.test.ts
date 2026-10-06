import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as database from "../../src/platform/database/transaction.ts";
import type { DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import { recordSourceWorkerHeartbeat, clearSourceWorkerHeartbeat, SOURCE_WORKER_RUNTIME } from "../../src/modules/platform-operations/infrastructure/runtime-heartbeat.ts";
import { getSourceWorkerReadiness, assertSourceWorkerHealthy } from "../../src/modules/platform-operations/infrastructure/readiness-runtime.ts";

describe("Source readiness native PostgreSQL exact owner and existing role grants", () => {
  it("uses DB time and worker DML/web read without granting more privileges or masking absent owners", async () => {
    const workerId = `readiness-${randomUUID()}`; const otherId = `readiness-${randomUUID()}`;
    const original = database.runInSystemJobDatabaseTransaction;
    let role: "worker" | "web" = "worker"; let executions = 0;
    async function scoped<T>(input: Parameters<typeof original>[0], execute: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
      return original(input, async (tx) => {
        await tx.$executeRawUnsafe(role === "worker" ? "SET LOCAL ROLE ams_data_hub_worker" : "SET LOCAL ROLE ams_data_hub_web");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user")).toEqual([{ rolbypassrls: false }]);
        executions += 1; return execute(tx);
      });
    }
    const lowered = vi.spyOn(database, "runInSystemJobDatabaseTransaction").mockImplementation(scoped);
    try {
      await recordSourceWorkerHeartbeat(otherId);
      expect(await getSourceWorkerReadiness(workerId)).toMatchObject({ pgBoss: "unconfirmed", sourceConsumer: "unconfirmed", heartbeat: { status: "unknown" } });
      await expect(assertSourceWorkerHealthy(workerId)).rejects.toThrow("SOURCE_WORKER_NOT_READY");
      await recordSourceWorkerHeartbeat(workerId); role = "web";
      expect(await getSourceWorkerReadiness(workerId)).toMatchObject({ pgBoss: "connected", sourceConsumer: "active", heartbeat: { status: "healthy" } });
      await assertSourceWorkerHealthy(workerId);
      for (const offset of ["interval '5 minutes' * -1", "interval '1 minute'"]) {
        await original({ jobName: "synthetic-readiness", correlationId: randomUUID() }, async (tx) => {
          if (offset === "interval '1 minute'") await tx.$executeRaw`UPDATE "RuntimeHeartbeat" SET "heartbeatAt" = clock_timestamp() + interval '1 minute' WHERE runtime = ${SOURCE_WORKER_RUNTIME} AND "workerId" = ${workerId}`;
          else await tx.$executeRaw`UPDATE "RuntimeHeartbeat" SET "heartbeatAt" = clock_timestamp() - interval '5 minutes' WHERE runtime = ${SOURCE_WORKER_RUNTIME} AND "workerId" = ${workerId}`;
        });
        expect(await getSourceWorkerReadiness(workerId)).toMatchObject({ pgBoss: "unconfirmed", sourceConsumer: "unconfirmed", heartbeat: { status: "stale" } });
      }
      role = "worker"; await clearSourceWorkerHeartbeat(workerId); role = "web";
      expect((await getSourceWorkerReadiness(workerId)).heartbeat.status).toBe("unknown");
      expect((await getSourceWorkerReadiness(otherId)).heartbeat.status).toBe("healthy");
      expect(executions).toBeGreaterThan(6);
    } finally {
      lowered.mockRestore(); await clearSourceWorkerHeartbeat(workerId); await clearSourceWorkerHeartbeat(otherId);
    }
  });
});
