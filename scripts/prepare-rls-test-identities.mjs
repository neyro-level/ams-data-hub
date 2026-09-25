import path from "node:path";
import { spawnSync } from "node:child_process";
import { readTestDatabaseTarget } from "./verify-test-database-env.mjs";

const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });
const rootDir = path.resolve(import.meta.dirname, "..");
const sqlFile = path.join(rootDir, "scripts", "sql", "prepare-rls-test-identities.sql");

const result = spawnSync("psql", [
  "-X",
  "-v", "ON_ERROR_STOP=1",
  "-v", `test_role=${target.user}`,
  "-h", target.host,
  "-p", String(target.port),
  "-U", "postgres",
  "-d", target.database,
  "-f", sqlFile,
], { cwd: rootDir, stdio: "inherit" });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
