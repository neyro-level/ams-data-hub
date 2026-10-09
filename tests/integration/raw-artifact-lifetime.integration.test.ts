import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";
import { runInAuthorizedDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import { acquireRawArtifactLifetimeGuard, type RawArtifactLifetimeLease } from "../../src/modules/ingestion-core/infrastructure/raw-artifact-lifetime-guard.ts";

const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });
describe("raw project/hash lifetime exclusion under native NOBYPASS PostgreSQL", () => {
  it("permits dedup producers, excludes DELETE through registration, and isolates projects", async () => {
    const pool = new pg.Pool({ host: target.host, port: target.port, database: target.database,
      user: target.user, password: target.password, options: "-c role=ams_data_hub_worker", max: 5 });
    const connect = async () => {
      const client = await pool.connect();
      expect((await client.query("SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows)
        .toEqual([{ role: "ams_data_hub_worker", rolsuper: false, rolbypassrls: false }]);
      return client;
    };
    const own = { organizationId: "synthetic-org", projectId: "synthetic-project", rawArtifactHash: randomBytes(32).toString("hex") };
    const leases: RawArtifactLifetimeLease[] = [];
    try {
      const a = await acquireRawArtifactLifetimeGuard({ connect }, own, "producer"); leases.push(a);
      const b = await acquireRawArtifactLifetimeGuard({ connect }, own, "producer"); leases.push(b);
      await expect(acquireRawArtifactLifetimeGuard({ connect }, own, "retention")).rejects.toThrow("RAW_ARTIFACT_BUSY");
      const foreign = await acquireRawArtifactLifetimeGuard({ connect }, { ...own, projectId: "other-project" }, "retention"); leases.push(foreign);
      const fence = (lease: RawArtifactLifetimeLease) => runInAuthorizedDatabaseTransaction({ principalKind: "project-job",
        actorId: "source-import", organizationId: own.organizationId, projectIds: [own.projectId], correlationId: "synthetic-raw-fence" },
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        await lease.fence(tx);
      });
      await fence(a); await fence(b);
      await a.release();
      // Settled PUT is not sufficient: another producer's registration lease
      // still protects the shared key until that producer commits and releases.
      await expect(acquireRawArtifactLifetimeGuard({ connect }, own, "retention")).rejects.toThrow("RAW_ARTIFACT_BUSY");
      await b.release();
      const deletion = await acquireRawArtifactLifetimeGuard({ connect }, own, "retention"); leases.push(deletion);
      await fence(deletion);
      await expect(acquireRawArtifactLifetimeGuard({ connect }, own, "producer")).rejects.toThrow("RAW_ARTIFACT_BUSY");
      await deletion.release(); await deletion.release();
      await expect(fence(deletion)).rejects.toThrow("RAW_ARTIFACT_LEASE_LOST");
      const resumed = await acquireRawArtifactLifetimeGuard({ connect }, own, "producer"); leases.push(resumed);
      await fence(resumed);
    } finally { for (const lease of leases) await lease.release(); await pool.end(); }
  });

  it.each(["producer", "retention"] as const)("keeps transaction exclusion after loss of its own %s guardian", async (mode) => {
    const pool = new pg.Pool({ host: target.host, port: target.port, database: target.database,
      user: target.user, password: target.password, options: "-c role=ams_data_hub_worker", max: 5 });
    // Fault injection uses the test session owner, without changing runtime
    // worker grants. PostgreSQL identifies backend ownership by session_user,
    // not the worker role selected through startup options.
    const faultPool = new pg.Pool({ host: target.host, port: target.port, database: target.database,
      user: target.user, password: target.password, max: 1 });
    let guardianPid: number | undefined;
    const connect = async () => {
      const client = await pool.connect();
      const identity = (await client.query("SELECT pg_backend_pid() AS pid,current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
      expect(identity).toMatchObject({ role: "ams_data_hub_worker", rolsuper: false, rolbypassrls: false });
      guardianPid ??= identity.pid;
      return client;
    };
    const own = { organizationId: "synthetic-org", projectId: "synthetic-project", rawArtifactHash: randomBytes(32).toString("hex") };
    const leases: RawArtifactLifetimeLease[] = [];
    try {
      const lease = await acquireRawArtifactLifetimeGuard({ connect }, own, mode); leases.push(lease);
      await expect(runInAuthorizedDatabaseTransaction({ principalKind: "project-job", actorId: "source-import",
        organizationId: own.organizationId, projectIds: [own.projectId], correlationId: "synthetic-guardian-loss" }, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        await lease.fence(tx);
        // Terminate only this test's exact, verified worker guardian backend.
        // No other process or application connection is selected or killed.
        expect(Number.isInteger(guardianPid)).toBe(true);
        const captured = (await faultPool.query("SELECT classid::text,objid::text,objsubid FROM pg_locks WHERE pid=$1::integer AND locktype='advisory' AND granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())", [guardianPid])).rows;
        expect(captured).toHaveLength(3); // Lifetime key and both nonce markers.
        expect((await faultPool.query("SELECT pg_terminate_backend($1::integer) AS terminated", [guardianPid])).rows)
          .toEqual([{ terminated: true }]);
        const deadline = Date.now() + 5_000;
        while (true) {
          const remaining = (await faultPool.query(`SELECT count(*)::integer AS count FROM pg_locks l
            WHERE l.pid=$1::integer AND l.locktype='advisory' AND l.granted
            AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
            AND EXISTS (SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS captured(classid text,objid text,objsubid integer)
              WHERE l.classid::text=captured.classid AND l.objid::text=captured.objid AND l.objsubid=captured.objsubid)`,
          [guardianPid, JSON.stringify(captured)])).rows[0]?.count;
          if (remaining === 0) break;
          if (Date.now() >= deadline) throw new Error("SYNTHETIC_GUARDIAN_LOCKS_NOT_RELEASED");
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        await expect(acquireRawArtifactLifetimeGuard({ connect }, own, "retention")).rejects.toThrow("RAW_ARTIFACT_BUSY");
        if (mode === "retention")
          await expect(acquireRawArtifactLifetimeGuard({ connect }, own, "producer")).rejects.toThrow("RAW_ARTIFACT_BUSY");
        await expect(lease.fence(tx)).rejects.toThrow("RAW_ARTIFACT_LEASE_LOST");
        throw new Error("SYNTHETIC_TRANSACTION_ROLLBACK");
      })).rejects.toThrow("SYNTHETIC_TRANSACTION_ROLLBACK");
      const resumed = await acquireRawArtifactLifetimeGuard({ connect }, own, "retention"); leases.push(resumed);
      await resumed.release();
    } finally { for (const lease of leases) await lease.release(); await pool.end(); await faultPool.end(); }
  });
});
