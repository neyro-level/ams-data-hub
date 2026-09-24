import pg from "pg";
import { readTestDatabaseTarget } from "./verify-test-database-env.mjs";

const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });
const client = new pg.Client({
  host: target.host,
  port: target.port,
  database: target.database,
  user: target.user,
  password: target.password,
  ssl: target.sslmode === "require",
  connectionTimeoutMillis: 5_000,
});

try {
  await client.connect();
  const result = await client.query("select current_user, current_database()");
  const identity = result.rows[0];
  if (identity.current_user !== target.user || identity.current_database !== target.database) {
    throw new Error("Connected PostgreSQL identity does not match the guarded test target.");
  }

  await client.query("DROP SCHEMA IF EXISTS pgboss CASCADE");
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query("GRANT ALL ON SCHEMA public TO CURRENT_USER");
  process.stdout.write("test_database_reset=complete\n");
} finally {
  await client.end().catch(() => undefined);
}
