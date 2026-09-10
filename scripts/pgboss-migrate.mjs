import { PgBoss } from "pg-boss";
import pg from "pg";
import {
  formatDatabaseTargetSummary,
  inspectDatabaseTarget,
} from "../src/platform/config/database-target.ts";

function readDatabaseOptions(env) {
  if (env.DATABASE_URL?.trim()) {
    return {
      connectionString: env.DATABASE_URL.trim(),
    };
  }
  if (!env.DATABASE_HOST || !env.DATABASE_USER || !env.DATABASE_PASSWORD || !env.DATABASE_NAME) {
    throw new Error("Database environment is invalid or incomplete");
  }
  return {
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT ? Number(env.DATABASE_PORT) : 5432,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    database: env.DATABASE_NAME,
    ssl: env.DATABASE_SSLMODE === "disable" ? false : undefined,
  };
}

function requireSafeIdentifier(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${label} must be a plain PostgreSQL identifier`);
  }
  return `"${value}"`;
}

async function grantRuntimePrivileges(databaseOptions, schema, runtimeRole) {
  if (!runtimeRole) return;

  const schemaIdentifier = requireSafeIdentifier(schema, "PGBOSS_SCHEMA");
  const roleIdentifier = requireSafeIdentifier(runtimeRole, "PGBOSS_RUNTIME_ROLE");
  const pool = new pg.Pool({ ...databaseOptions, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`GRANT USAGE ON SCHEMA ${schemaIdentifier} TO ${roleIdentifier}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schemaIdentifier} TO ${roleIdentifier}`,
    );
    await client.query(
      `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${schemaIdentifier} TO ${roleIdentifier}`,
    );
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schemaIdentifier} TO ${roleIdentifier}`);
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdentifier} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${roleIdentifier}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdentifier} GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${roleIdentifier}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdentifier} GRANT EXECUTE ON FUNCTIONS TO ${roleIdentifier}`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const target = inspectDatabaseTarget(process.env);
process.stdout.write(`database_target=${formatDatabaseTargetSummary(target)}\n`);
const databaseOptions = readDatabaseOptions(process.env);
const schema = process.env.PGBOSS_SCHEMA?.trim() || "pgboss";
const runtimeRole = process.env.PGBOSS_RUNTIME_ROLE?.trim() || null;

const boss = new PgBoss({
  ...databaseOptions,
  schema,
  max: 1,
  application_name: "seo-monitor-pgboss-migrate",
  migrate: true,
  createSchema: true,
  supervise: false,
  schedule: false,
});

await boss.start();
await boss.stop();
await grantRuntimePrivileges(databaseOptions, schema, runtimeRole);
process.stdout.write("pgboss_schema_ready\n");
