import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(import.meta.dirname, "..");
const localEnvPath = path.join(rootDir, ".env.local");
const requestedTestFiles = process.argv.slice(2);

if (!process.env.TEST_DATABASE_NAME && existsSync(localEnvPath)) {
  process.loadEnvFile(localEnvPath);
}

await import("./verify-test-database-env.mjs");

const databaseUrl = new URL("postgresql://localhost");
databaseUrl.username = process.env.TEST_DATABASE_USER;
databaseUrl.password = process.env.TEST_DATABASE_PASSWORD;
databaseUrl.hostname = process.env.TEST_DATABASE_HOST;
databaseUrl.port = process.env.TEST_DATABASE_PORT?.trim() || "5432";
databaseUrl.pathname = `/${process.env.TEST_DATABASE_NAME}`;
databaseUrl.searchParams.set("sslmode", process.env.TEST_DATABASE_SSLMODE?.trim() || "disable");
process.env.DATABASE_HOST = process.env.TEST_DATABASE_HOST;
process.env.DATABASE_PORT = process.env.TEST_DATABASE_PORT?.trim() || "5432";
process.env.DATABASE_USER = process.env.TEST_DATABASE_USER;
process.env.DATABASE_PASSWORD = process.env.TEST_DATABASE_PASSWORD;
process.env.DATABASE_NAME = process.env.TEST_DATABASE_NAME;
process.env.DATABASE_SSLMODE = process.env.TEST_DATABASE_SSLMODE?.trim() || "disable";
process.env.DATABASE_URL = databaseUrl.toString();
process.env.APP_ENV = "test";

function runNodeScript(relativePath, args = []) {
  const result = spawnSync(process.execPath, [path.join(rootDir, relativePath), ...args], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runNodeScript("node_modules/prisma/build/index.js", ["generate"]);
runNodeScript("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
runNodeScript("scripts/pgboss-migrate.mjs");
runNodeScript("node_modules/tsx/dist/cli.mjs", ["scripts/seed-bootstrap.ts"]);
runNodeScript("scripts/seed-test-database.mjs");
runNodeScript("node_modules/vitest/vitest.mjs", [
  "run",
  "--config",
  "vitest.integration.config.mts",
  ...requestedTestFiles,
]);
