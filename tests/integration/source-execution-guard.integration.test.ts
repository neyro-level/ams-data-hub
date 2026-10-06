import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getPrismaPool } from "../../src/platform/database/prisma/client.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { ProjectJobPrincipal } from "../../src/platform/authorization/principal.ts";
import { acquireSourceExecutionGuard, sourceExecutionGuardKey } from "../../src/modules/ingestion-core/infrastructure/source-execution-guard.ts";
import { getPgBoss, stopPgBoss } from "../../src/modules/platform-operations/worker.ts";
import { PgBossSourceJobQueue, SOURCE_IMPORT_QUEUE, deferSourceImportJob, type SourceImportJob } from "../../src/modules/ingestion-core/worker.ts";

const pool = () => getPrismaPool();
const target = () => ({ organizationId: "synthetic-guard-org", projectId: "synthetic-guard-project", sourceId: randomUUID() });
async function guardianPid(scope: ReturnType<typeof target>) {
  const key = sourceExecutionGuardKey(scope);
  const result = await pool().query<{ pid: number }>(`SELECT pid FROM pg_locks WHERE locktype = 'advisory'
    AND mode = 'ShareLock' AND granted AND classid::bigint = $1 AND objid::bigint = $2 AND objsubid = 2`, [key[0] >>> 0, key[1] >>> 0]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!.pid;
}
const principal = (scope: ReturnType<typeof target>): ProjectJobPrincipal => ({ kind: "project-job", jobName: "source-import", ...scope, correlationId: randomUUID() });

describe("native Source session admission and transaction fencing", () => {
  it("denies the same scope, admits another Source and releases both leases", async () => {
    const scope = target(); const lease = await acquireSourceExecutionGuard(pool(), scope);
    const other = await acquireSourceExecutionGuard(pool(), { ...scope, sourceId: randomUUID() });
    try {
      await expect(acquireSourceExecutionGuard(pool(), scope)).rejects.toThrow("SOURCE_EXECUTION_BUSY");
      await runInPrincipalDatabaseTransaction(principal(scope), async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        await lease.fence(tx);
      });
    } finally { await lease.release(); await other.release(); }
    const next = await acquireSourceExecutionGuard(pool(), scope); await next.release();
  });

  it("blocks replacement inside a fenced transaction after the guardian connection dies", async () => {
    const scope = target(); const lease = await acquireSourceExecutionGuard(pool(), scope);
    const pid = await guardianPid(scope);
    try {
      await expect(runInPrincipalDatabaseTransaction(principal(scope), async (tx) => {
        await lease.fence(tx);
        expect((await pool().query("SELECT pg_terminate_backend($1) AS killed", [pid])).rows[0]?.killed).toBe(true);
        await expect(acquireSourceExecutionGuard(pool(), scope)).rejects.toThrow("SOURCE_EXECUTION_BUSY");
        // A post-body ownership check prevents even this old transaction committing.
        await lease.fence(tx);
      })).rejects.toThrow("SOURCE_EXECUTION_LEASE_LOST");
      const replacement = await acquireSourceExecutionGuard(pool(), scope);
      try {
        await expect(runInPrincipalDatabaseTransaction(principal(scope), (tx) => lease.fence(tx))).rejects.toThrow("SOURCE_EXECUTION_LEASE_LOST");
        await runInPrincipalDatabaseTransaction(principal(scope), (tx) => replacement.fence(tx));
      } finally { await replacement.release(); }
    } finally { await lease.release(); }
  });

  it("repeatedly defers native terminal-budget attempts and rejects stale active-attempt metadata", async () => {
    const scope = target(); const boss = await getPgBoss();
    await new PgBossSourceJobQueue(boss).reconcileSchedules([]);
    const id = await boss.send(SOURCE_IMPORT_QUEUE, { schemaVersion: 1, ...scope, trigger: "MANUAL", manualRequestId: randomUUID() }, { singletonKey: scope.sourceId });
    expect(id).toEqual(expect.any(String));
    try {
      await boss.getDb().executeSql("UPDATE pgboss.job SET retry_count = 3, retry_limit = 3 WHERE name = $1 AND id = $2::uuid", [SOURCE_IMPORT_QUEUE, id]);
      const [first] = await boss.fetch<SourceImportJob>(SOURCE_IMPORT_QUEUE, { batchSize: 1, includeMetadata: true });
      expect(first!.id).toBe(id); await deferSourceImportJob(boss, first!);
      for (let cycle = 0; cycle < 3; cycle += 1) {
        expect(await boss.getJobById(SOURCE_IMPORT_QUEUE, id!)).toMatchObject({ state: "created", retryCount: 3, retryLimit: 3, startedOn: null });
        // Advance only this synthetic queued job's delay; no global fake clock.
        await new Promise((resolve) => setTimeout(resolve, 5));
        await boss.update(SOURCE_IMPORT_QUEUE, undefined, { id: id!, startAfter: new Date() });
        const [next] = await boss.fetch<SourceImportJob>(SOURCE_IMPORT_QUEUE, { batchSize: 1, includeMetadata: true });
        expect(next).toMatchObject({ id, retryCount: 3 });
        await expect(deferSourceImportJob(boss, first!)).rejects.toThrow("SOURCE_JOB_LEASE_LOST");
        expect((await boss.getJobById(SOURCE_IMPORT_QUEUE, id!))?.state).toBe("active");
        await deferSourceImportJob(boss, next!);
      }
    } finally { if (id) await boss.deleteJob(SOURCE_IMPORT_QUEUE, id); await stopPgBoss(); }
  });
});
