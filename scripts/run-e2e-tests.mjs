import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createTestDatabaseUrl, readTestDatabaseTarget } from "./verify-test-database-env.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const configuredEnvFile = process.env.E2E_ENV_FILE;
const envFile = configuredEnvFile ? path.resolve(rootDir, configuredEnvFile) : path.join(rootDir, ".env.local");

if (!existsSync(envFile)) throw new Error("E2E test environment file is required");
process.loadEnvFile(envFile);
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

function run(relativePath, args = []) {
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
  run("scripts/reset-test-database.mjs");
  cleanupStarted = true;
  run("node_modules/prisma/build/index.js", ["generate"]);
  run("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
  run("scripts/pgboss-migrate.mjs");
  run("node_modules/tsx/dist/cli.mjs", ["scripts/seed-bootstrap.ts"]);
  run("node_modules/tsx/dist/cli.mjs", ["scripts/seed-test-database.ts"]);
  run("node_modules/@playwright/test/cli.js", ["test"]);
} finally {
  if (cleanupStarted) run("scripts/reset-test-database.mjs");
}
