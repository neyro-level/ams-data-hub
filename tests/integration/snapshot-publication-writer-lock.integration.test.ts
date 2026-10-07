import pg from "pg";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createUlid } from "@ams-data-hub/data-contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import { lockSourceIdentities } from "../../src/modules/ingestion-core/infrastructure/source-identity-lock.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";

const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });
const config = { host: target.host, port: target.port, database: target.database,
  user: target.user, password: target.password, ssl: target.sslmode === "require", options: "-c timezone=UTC" };
const holder = new pg.Client(config); const writer = new pg.Client(config);
const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-writer-lock", correlationId: randomUUID() };
beforeAll(async () => { await holder.connect(); await writer.connect(); });
afterAll(async () => { await writer.end(); await holder.end(); });
const tables = ["Project", "DataSafetyState", "Source", "SourceSafetyPolicy", "InventoryIdentity",
  "ProjectCatalogSubscription", "ProjectCatalogSubscriptionCity", "ProjectCatalogSubscriptionSelection",
  "ProjectPublicContact", "Agent", "ListingAgentBinding", "MediaSource", "MediaAsset", "SharedMediaAsset",
  "Developer", "Development", "Building"];

async function holdGlobal() {
  await holder.query("BEGIN");
  await holder.query("SELECT set_config('app.principal_kind','platform-admin',true)");
  await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0))");
}
async function waitForGlobal(pid: () => number) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const locks = await holder.query(`SELECT w.pid FROM pg_locks w JOIN pg_locks owner
      ON w.locktype = owner.locktype AND w.database = owner.database
      AND w.classid = owner.classid AND w.objid = owner.objid AND w.objsubid = owner.objsubid
      WHERE owner.pid = pg_backend_pid() AND owner.locktype = 'advisory' AND owner.granted
      AND NOT w.granted AND w.pid = $1`, [pid()]);
    if (locks.rowCount) return;
    await delay(20);
  }
  throw new Error("SYNTHETIC_OWNED_GLOBAL_WAITER_MISSING");
}
async function prepareWriter(role: "ams_data_hub_web" | "ams_data_hub_worker") {
  await writer.query("BEGIN");
  // Role comes only from the closed literal union above.
  await writer.query(`SET LOCAL ROLE ${role}`);
  await writer.query("SET LOCAL lock_timeout = '2s'");
  await writer.query("SELECT set_config('app.principal_kind','platform-admin',true)");
  expect((await writer.query("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user")).rows)
    .toEqual([{ rolbypassrls: false, rolsuper: false }]);
  return (await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
}

describe("snapshot publication fact-writer serialization", () => {
  it("installs BEFORE STATEMENT locks for all three DML operations", async () => {
    const rows = await holder.query<{ table: string; statement: boolean; before: boolean; insert: boolean; update: boolean; delete: boolean }>(`
      SELECT c.relname AS "table", (t.tgtype & 1)=0 AS statement, (t.tgtype & 2)<>0 AS "before",
        (t.tgtype & 4)<>0 AS "insert", (t.tgtype & 16)<>0 AS "update", (t.tgtype & 8)<>0 AS "delete"
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE p.proname='lock_snapshot_publication_fact_writer' ORDER BY c.relname`);
    expect(rows.rows.map((row) => row.table)).toEqual([...tables].sort());
    expect(rows.rows.every((row) => row.statement && row.before && row.insert && row.update && row.delete)).toBe(true);
  });

  it("blocks zero-row DML on every gate table under actual NOBYPASS runtime grants", async () => {
    for (const table of tables) {
      const qualified = `public."${table}"`;
      const grants = await holder.query<{ web: boolean; worker: boolean }>(`SELECT
        has_table_privilege('ams_data_hub_web',$1,'UPDATE') AS web,
        has_table_privilege('ams_data_hub_worker',$1,'UPDATE') AS worker`, [qualified]);
      const appendOnly = table === "MediaAsset";
      if (appendOnly) expect(grants.rows[0]).toEqual({ web: false, worker: false });
      else expect(grants.rows[0]!.web || grants.rows[0]!.worker, table).toBe(true);
      let pending: Promise<{ error: unknown; count: number | null }> | undefined;
      try {
        await holdGlobal();
        const pid = await prepareWriter(appendOnly || grants.rows[0]!.web ? "ams_data_hub_web" : "ams_data_hub_worker");
        const column = table === "Project" || table === "DataSafetyState" ? "id"
          : ["Developer", "Development", "Building"].includes(table) ? "uid" : "organizationId";
        const statement = appendOnly
          ? 'INSERT INTO "MediaAsset" ("organizationId") SELECT NULL::text WHERE false'
          : `UPDATE "${table}" SET "${column}"="${column}" WHERE false`;
        pending = writer.query(statement)
          .then((result) => ({ error: null, count: result.rowCount }), (error: unknown) => ({ error, count: null }));
        await waitForGlobal(() => pid);
        await holder.query("ROLLBACK");
        expect(await pending).toEqual({ error: null, count: 0 });
      } finally {
        await holder.query("ROLLBACK");
        if (pending) await pending;
        await writer.query("ROLLBACK");
      }
    }
  }, 30_000);

  it("blocks an actual consent/visibility mutation before the Agent row and releases on rollback", async () => {
    const agent = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const org = await tx.organization.create({ data: { name: "Synthetic writer", slug: `writer-${suffix}` } });
      const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic writer", slug: `writer-${suffix}` } });
      return tx.agent.create({ data: { organizationId: org.id, projectId: project.id,
        uid: createUlid(), slug: `writer-${suffix}`, fullName: "Synthetic Agent",
        showOnSite: true, consentConfirmedAt: new Date(), consentBasis: "synthetic" } });
    });
    let pending: Promise<{ error: unknown; count: number | null }> | undefined;
    try {
      await holdGlobal(); const pid = await prepareWriter("ams_data_hub_web");
      pending = writer.query('UPDATE "Agent" SET "showOnSite"=false, "consentConfirmedAt"=NULL WHERE "id"=$1', [agent.id])
        .then((result) => ({ error: null, count: result.rowCount }), (error: unknown) => ({ error, count: null }));
      await waitForGlobal(() => pid);
      expect((await holder.query('SELECT "id" FROM "Agent" WHERE "id"=$1 FOR UPDATE NOWAIT', [agent.id])).rows)
        .toEqual([{ id: agent.id }]);
      await holder.query("ROLLBACK"); expect(await pending).toEqual({ error: null, count: 1 });
    } finally {
      await holder.query("ROLLBACK"); if (pending) await pending; await writer.query("ROLLBACK");
    }
    expect((await holder.query('SELECT "showOnSite" FROM "Agent" WHERE "id"=$1', [agent.id])).rows)
      .toEqual([{ showOnSite: true }]);
  });

  it("legacy identity waits for global before owning the Source domain key", async () => {
    const scope = { organizationId: "synthetic-org", projectId: "synthetic-project", sourceId: randomUUID() };
    let pid = 0; let pending: Promise<unknown> | undefined;
    try {
      await holdGlobal();
      pending = runInPrincipalDatabaseTransaction(admin, async (tx) => {
        pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
        await lockSourceIdentities(tx, scope);
      }).then(() => null, (error: unknown) => error);
      await waitForGlobal(() => pid);
      const key = JSON.stringify(["source-identities", scope.organizationId, scope.projectId, scope.sourceId]);
      expect((await holder.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired", [key])).rows)
        .toEqual([{ acquired: true }]);
      await holder.query("ROLLBACK"); expect(await pending).toBeNull();
    } finally { await holder.query("ROLLBACK"); if (pending) await pending; }
  });

  it("subscription membership INSERT and DELETE wait before parent/child row locks", async () => {
    const scope = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const org = await tx.organization.create({ data: { name: "Synthetic membership", slug: `member-${suffix}` } });
      const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic membership", slug: `member-${suffix}` } });
      const cities = await tx.city.findMany({ orderBy: { uid: "asc" }, take: 2, select: { uid: true } });
      expect(cities).toHaveLength(2);
      await tx.projectCatalogSubscription.create({ data: { organizationId: org.id, projectId: project.id,
        mode: "CURATED", cities: { create: { cityUid: cities[0]!.uid } } } });
      return { organizationId: org.id, projectId: project.id, existingCity: cities[0]!.uid, nextCity: cities[1]!.uid };
    });
    for (const operation of ["INSERT", "DELETE"] as const) {
      let pending: Promise<{ error: unknown; count: number | null }> | undefined;
      try {
        await holdGlobal(); const pid = await prepareWriter("ams_data_hub_web");
        const query = operation === "INSERT"
          ? writer.query('INSERT INTO "ProjectCatalogSubscriptionCity" ("organizationId","projectId","cityUid") VALUES ($1,$2,$3)',
            [scope.organizationId, scope.projectId, scope.nextCity])
          : writer.query('DELETE FROM "ProjectCatalogSubscriptionCity" WHERE "projectId"=$1 AND "cityUid"=$2',
            [scope.projectId, scope.existingCity]);
        pending = query.then((result) => ({ error: null, count: result.rowCount }),
          (error: unknown) => ({ error, count: null }));
        await waitForGlobal(() => pid);
        expect((await holder.query('SELECT "projectId" FROM "ProjectCatalogSubscription" WHERE "projectId"=$1 FOR UPDATE NOWAIT',
          [scope.projectId])).rowCount).toBe(1);
        expect((await holder.query('SELECT "cityUid" FROM "ProjectCatalogSubscriptionCity" WHERE "projectId"=$1 FOR UPDATE NOWAIT',
          [scope.projectId])).rows).toEqual([{ cityUid: scope.existingCity }]);
        await holder.query("ROLLBACK"); expect(await pending).toEqual({ error: null, count: 1 });
      } finally { await holder.query("ROLLBACK"); if (pending) await pending; await writer.query("ROLLBACK"); }
    }
    expect((await holder.query('SELECT "cityUid" FROM "ProjectCatalogSubscriptionCity" WHERE "projectId"=$1',
      [scope.projectId])).rows).toEqual([{ cityUid: scope.existingCity }]);
  });
});
