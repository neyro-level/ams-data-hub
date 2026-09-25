import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createTestDatabaseUrl, readTestDatabaseTarget } from "./verify-test-database-env.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const localEnvPath = path.join(rootDir, ".env.local");
const requestedTestFiles = process.argv.slice(2);

if (existsSync(localEnvPath)) {
  process.loadEnvFile(localEnvPath);
}

process.env.APP_ENV = "test";
process.env.NODE_ENV = "test";

const target = readTestDatabaseTarget(process.env);
process.env.DATABASE_HOST = target.host;
process.env.DATABASE_PORT = String(target.port);
process.env.DATABASE_USER = target.user;
process.env.DATABASE_PASSWORD = target.password;
process.env.DATABASE_NAME = target.database;
process.env.DATABASE_SSLMODE = target.sslmode;
process.env.DATABASE_URL = createTestDatabaseUrl(target);

function runNodeScript(relativePath, args = []) {
  const result = spawnSync(process.execPath, [path.join(rootDir, relativePath), ...args], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

let cleanupStarted = false;
try {
  runNodeScript("scripts/reset-test-database.mjs");
  cleanupStarted = true;
  runNodeScript("scripts/prepare-rls-test-identities.mjs");
  runNodeScript("node_modules/prisma/build/index.js", ["generate"]);
  runNodeScript("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
  runNodeScript("scripts/pgboss-migrate.mjs");
  runNodeScript("node_modules/tsx/dist/cli.mjs", ["scripts/seed-bootstrap.ts"]);
  runNodeScript("node_modules/tsx/dist/cli.mjs", ["scripts/seed-test-database.ts"]);
  runNodeScript("node_modules/vitest/vitest.mjs", [
    "run",
    "--config",
    "vitest.integration.config.mts",
    ...requestedTestFiles,
  ]);
} finally {
  if (cleanupStarted) {
    runNodeScript("scripts/reset-test-database.mjs");
  }
}
