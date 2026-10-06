import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";

const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });
const runtimeRole = "ams_data_hub_web";
let fixtureClient: pg.Client;
let runtimeClient: pg.Client;
let workerClient: pg.Client;
let organizationA: string;
let organizationB: string;
let projectA: string;
let projectASecondary: string;
let projectB: string;
const notificationId = "e03-platform-notification";
const actorA = "e03-platform-actor-a";
const actorB = "e03-platform-actor-b";

function createClient() {
  return new pg.Client({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: target.password,
    ssl: target.sslmode === "require",
  });
}

async function inTenantContext<T>(organizationId: string, projectIds: readonly string[] | "*", execute: () => Promise<T>): Promise<T> {
  await runtimeClient.query("begin");
  try {
    await runtimeClient.query("select set_config('app.principal_kind', $1, true)", ["tenant-user"]);
    await runtimeClient.query("select set_config('app.actor_id', $1, true)", ["tenant-test-user"]);
    await runtimeClient.query("select set_config('app.organization_id', $1, true)", [organizationId]);
    await runtimeClient.query("select set_config('app.project_ids', $1, true)", [projectIds === "*" ? "*" : projectIds.join(",")]);
    await runtimeClient.query("select set_config('app.correlation_id', $1, true)", ["e03-tenant-isolation"]);
    const result = await execute();
    await runtimeClient.query("commit");
    return result;
  } catch (error) {
    await runtimeClient.query("rollback");
    throw error;
  }
}

async function inPlatformContext<T>(actorId: string, execute: () => Promise<T>): Promise<T> {
  await runtimeClient.query("begin");
  try {
    await runtimeClient.query("select set_config('app.principal_kind', $1, true)", ["platform-admin"]);
    await runtimeClient.query("select set_config('app.actor_id', $1, true)", [actorId]);
    await runtimeClient.query("select set_config('app.organization_id', $1, true)", [""]);
    await runtimeClient.query("select set_config('app.correlation_id', $1, true)", ["e03-platform-read"]);
    const result = await execute();
    await runtimeClient.query("commit");
    return result;
  } catch (error) {
    await runtimeClient.query("rollback");
    throw error;
  }
}

async function inSystemJobContext<T>(execute: () => Promise<T>): Promise<T> {
  await workerClient.query("begin");
  try {
    await workerClient.query("select set_config('app.principal_kind', $1, true)", ["system-job"]);
    await workerClient.query("select set_config('app.actor_id', $1, true)", ["e03-worker"]);
    await workerClient.query("select set_config('app.organization_id', $1, true)", [""]);
    await workerClient.query("select set_config('app.correlation_id', $1, true)", ["e03-system-job"]);
    const result = await execute();
    await workerClient.query("commit");
    return result;
  } catch (error) {
    await workerClient.query("rollback");
    throw error;
  }
}

describe("PostgreSQL tenant isolation", () => {
  beforeAll(async () => {
    fixtureClient = createClient();
    runtimeClient = createClient();
    workerClient = createClient();
    await fixtureClient.connect();
    await runtimeClient.connect();
    await workerClient.connect();
    await runtimeClient.query(`set role ${runtimeRole}`);
    await workerClient.query("set role ams_data_hub_worker");

    const orgA = await fixtureClient.query(
      "insert into \"Organization\" (\"id\", \"name\", \"slug\", \"updatedAt\") values ($1, $2, $3, now()) returning \"id\"",
      ["e03-org-a", "E03 Organization A", "e03-org-a"],
    );
    const orgB = await fixtureClient.query(
      "insert into \"Organization\" (\"id\", \"name\", \"slug\", \"updatedAt\") values ($1, $2, $3, now()) returning \"id\"",
      ["e03-org-b", "E03 Organization B", "e03-org-b"],
    );
    organizationA = orgA.rows[0].id;
    organizationB = orgB.rows[0].id;
    const projects = await Promise.all([
      fixtureClient.query(
        "insert into \"Project\" (\"id\", \"organizationId\", \"slug\", \"name\", \"status\", \"updatedAt\") values ($1, $2, $3, $4, 'ACTIVE', now()) returning \"id\"",
        ["e03-project-a", organizationA, "e03-project-a", "E03 Project A"],
      ),
      fixtureClient.query(
        "insert into \"Project\" (\"id\", \"organizationId\", \"slug\", \"name\", \"status\", \"updatedAt\") values ($1, $2, $3, $4, 'ACTIVE', now()) returning \"id\"",
        ["e03-project-a-secondary", organizationA, "e03-project-a-secondary", "E03 Project A Secondary"],
      ),
      fixtureClient.query(
        "insert into \"Project\" (\"id\", \"organizationId\", \"slug\", \"name\", \"status\", \"updatedAt\") values ($1, $2, $3, $4, 'ACTIVE', now()) returning \"id\"",
        ["e03-project-b", organizationB, "e03-project-b", "E03 Project B"],
      ),
    ]);
    projectA = projects[0].rows[0].id;
    projectASecondary = projects[1].rows[0].id;
    projectB = projects[2].rows[0].id;
    await fixtureClient.query(
      "insert into \"User\" (\"id\", \"name\", \"email\", \"updatedAt\") values ($1, $2, $3, now()), ($4, $5, $6, now())",
      [actorA, "E03 Actor A", "e03-actor-a@example.test", actorB, "E03 Actor B", "e03-actor-b@example.test"],
    );
    await fixtureClient.query(
      "insert into \"Notification\" (\"id\", \"category\", \"severity\", \"visibility\", \"title\", \"message\", \"sourceType\", \"dedupKey\", \"occurredAt\") values ($1, 'QUEUE', 'INFO', 'PLATFORM_ADMIN_ONLY', 'E03 platform', 'actor-bound read proof', 'test', $2, now())",
      [notificationId, notificationId],
    );
    await fixtureClient.query(
      "insert into \"NotificationRead\" (\"notificationId\", \"userId\", \"readAt\") values ($1, $2, now()), ($1, $3, now())",
      [notificationId, actorA, actorB],
    );
  });

  afterAll(async () => {
    await runtimeClient.end();
    await workerClient.end();
    await fixtureClient.end();
  });

  it("defaults to deny without transaction-local tenant context", async () => {
    const result = await runtimeClient.query("select \"id\" from \"Project\" order by \"id\"");
    expect(result.rows).toEqual([]);
  });

  it("allows only the selected tenant and clears context on commit", async () => {
    const result = await inTenantContext(organizationA, [projectA], () =>
      runtimeClient.query("select \"id\" from \"Project\" order by \"id\""),
    );
    expect(result.rows.map((row) => row.id)).toEqual([projectA]);
    const [{ organization_id: organizationIdAfterCommit }] = (
      await runtimeClient.query("select current_setting('app.organization_id', true) as organization_id")
    ).rows;
    expect(organizationIdAfterCommit).toBeFalsy();
  });

  it("silently rejects cross-tenant reads and writes under RLS", async () => {
    const result = await inTenantContext(organizationA, [projectA], () =>
      runtimeClient.query("update \"Project\" set \"name\" = $1 where \"id\" = $2", ["must not write", projectB]),
    );
    expect(result.rowCount).toBe(0);
  });

  it("denies reads and writes to another project in the same organization", async () => {
    const visibleProjects = await inTenantContext(organizationA, [projectA], () =>
      runtimeClient.query("select \"id\" from \"Project\" order by \"id\""),
    );
    expect(visibleProjects.rows.map((row) => row.id)).toEqual([projectA]);
    const result = await inTenantContext(organizationA, [projectA], () =>
      runtimeClient.query("update \"Project\" set \"name\" = $1 where \"id\" = $2", ["must not write", projectASecondary]),
    );
    expect(result.rowCount).toBe(0);
  });

  it("rejects a cross-tenant relation at the database constraint", async () => {
    await expect(
      fixtureClient.query(
        "insert into \"Notification\" (\"id\", \"organizationId\", \"projectId\", \"category\", \"severity\", \"visibility\", \"title\", \"message\", \"sourceType\", \"dedupKey\", \"occurredAt\") values ($1, $2, $3, 'PROJECT', 'INFO', 'PLATFORM_TEAM', 'E03', 'cross tenant', 'test', $4, now())",
        ["e03-cross-tenant-notification", organizationA, projectB, "e03-cross-tenant-notification"],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("keeps idempotency and outbox organization scopes aligned while allowing global work", async () => {
    await fixtureClient.query(
      "insert into \"OutboxEvent\" (\"id\", \"organizationId\", \"topic\", \"payload\", \"correlationId\", \"updatedAt\") values ($1, $2, 'e03.scope', '{}'::jsonb, $3, now())",
      ["e03-org-a-outbox", organizationA, "e03-org-a-outbox"],
    );
    await expect(
      fixtureClient.query(
        "insert into \"IdempotencyKey\" (\"id\", \"organizationScope\", \"organizationId\", \"scope\", \"key\", \"requestHash\", \"status\", \"outboxEventId\", \"expiresAt\", \"updatedAt\") values ($1, $2, $3, 'e03.scope', $4, 'e03', 'COMPLETED', $5, now() + interval '1 hour', now())",
        ["e03-mismatched-idempotency", organizationB, organizationB, "e03-mismatched-idempotency", "e03-org-a-outbox"],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await fixtureClient.query(
      "insert into \"IdempotencyKey\" (\"id\", \"organizationScope\", \"organizationId\", \"scope\", \"key\", \"requestHash\", \"status\", \"outboxEventId\", \"expiresAt\", \"updatedAt\") values ($1, $2, $3, 'e03.scope', $4, 'e03', 'COMPLETED', $5, now() + interval '1 hour', now())",
      ["e03-matched-idempotency", organizationA, organizationA, "e03-matched-idempotency", "e03-org-a-outbox"],
    );
    await expect(
      fixtureClient.query(
        "update \"OutboxEvent\" set \"organizationId\" = $1 where \"id\" = $2",
        [organizationB, "e03-org-a-outbox"],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("keeps runtime identities non-owner and unable to bypass RLS", async () => {
    const { rows } = await fixtureClient.query(
      "select rolname, rolcanlogin, rolsuper, rolcreaterole, rolbypassrls from pg_roles where rolname = any($1::text[]) order by rolname",
      [["ams_data_hub_backup", "ams_data_hub_migrator", "ams_data_hub_web", "ams_data_hub_worker"]],
    );
    expect(rows).toHaveLength(4);
    for (const role of rows) {
      expect(role.rolcanlogin).toBe(true);
      expect(role.rolsuper).toBe(false);
      expect(role.rolcreaterole).toBe(false);
      expect(role.rolbypassrls).toBe(false);
    }
  });

  it("gives each runtime role only the tables required by its contract", async () => {
    const webTables = [
      "User", "Session", "Account", "Verification", "RateLimit",
      "AccountSetupToken", "PlatformRecoveryToken",
    ];
    const [{ web_auth_tables: webAuthTables, web_runtime_heartbeat: webRuntimeHeartbeat, worker_user_table: workerUserTable, worker_runtime_heartbeat: workerRuntimeHeartbeat }] = (
      await fixtureClient.query(
        `select
          bool_and(has_table_privilege('ams_data_hub_web', format('%I', table_name), 'SELECT, INSERT, UPDATE, DELETE')) as web_auth_tables,
          has_table_privilege('ams_data_hub_web', '"RuntimeHeartbeat"', 'SELECT') as web_runtime_heartbeat,
          has_table_privilege('ams_data_hub_worker', '"User"', 'SELECT') as worker_user_table,
          has_table_privilege('ams_data_hub_worker', '"RuntimeHeartbeat"', 'SELECT, INSERT, UPDATE, DELETE') as worker_runtime_heartbeat
        from unnest($1::text[]) as table_name`,
        [webTables],
      )
    ).rows;

    expect(webAuthTables).toBe(true);
    expect(webRuntimeHeartbeat).toBe(true);
    expect(workerUserTable).toBe(false);
    expect(workerRuntimeHeartbeat).toBe(true);
  });

  it("binds NotificationRead visibility and writes to the transaction actor", async () => {
    const visibleReads = await inPlatformContext(actorA, () =>
      runtimeClient.query("select \"userId\" from \"NotificationRead\" where \"notificationId\" = $1", [notificationId]),
    );
    expect(visibleReads.rows.map((row) => row.userId)).toEqual([actorA]);

    await expect(inPlatformContext(actorA, () =>
      runtimeClient.query(
        "insert into \"NotificationRead\" (\"notificationId\", \"userId\", \"readAt\") values ($1, $2, now())",
        [notificationId, actorB],
      ),
    )).rejects.toMatchObject({ code: "42501" });
  });

  it("allows system-job operational rows but denies identity data to the worker role", async () => {
    await expect(inSystemJobContext(() =>
      workerClient.query("select \"id\" from \"User\" limit 1"),
    )).rejects.toMatchObject({ code: "42501" });

    const outboxRows = await inSystemJobContext(() =>
      workerClient.query("select \"id\" from \"OutboxEvent\" order by \"id\" limit 1"),
    );
    expect(outboxRows.rowCount).toBeGreaterThanOrEqual(0);
  });
});
