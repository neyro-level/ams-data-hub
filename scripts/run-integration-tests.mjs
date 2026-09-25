import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  clearPostgresqlEvidenceFile,
  createPostgresqlEvidenceSummary,
  postgresqlEvidenceManifest,
  requiredPostgresqlEvidenceSuites,
  validatePostgresqlEvidenceManifest,
  writePostgresqlEvidenceFile,
} from "./postgresql-evidence.mjs";
import { createTestDatabaseUrl, readTestDatabaseTarget } from "./verify-test-database-env.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const localEnvPath = path.join(rootDir, ".env.local");
const requestedTestFiles = process.argv.slice(2);
const evidencePath = path.join(
  rootDir,
  ".local",
  "evidence",
  "postgresql-security-evidence.json",
);

await clearPostgresqlEvidenceFile(evidencePath);

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
  if (result.status !== 0) {
    throw Object.assign(
      new Error(`Integration lifecycle command failed: ${relativePath}`),
      { exitCode: result.status ?? 1 },
    );
  }
}

function prepareEmptyDatabase() {
  runNodeScript("scripts/reset-test-database.mjs");
  cleanupStarted = true;
  runNodeScript("scripts/prepare-rls-test-identities.mjs");
  runNodeScript("node_modules/prisma/build/index.js", ["generate"]);
  runNodeScript("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
  runNodeScript("scripts/pgboss-migrate.mjs");
  runNodeScript("node_modules/tsx/dist/cli.mjs", ["scripts/seed-bootstrap.ts"]);
  runNodeScript("node_modules/tsx/dist/cli.mjs", ["scripts/seed-test-database.ts"]);
}

function runVitest(testFiles) {
  const integrationFiles = testFiles.filter((file) => file.endsWith(".integration.test.ts"));
  const lifecycleFiles = testFiles.filter((file) => !file.endsWith(".integration.test.ts"));
  if (integrationFiles.length > 0) {
    runNodeScript("node_modules/vitest/vitest.mjs", [
      "run",
      "--config",
      "vitest.integration.config.mts",
      ...integrationFiles,
    ]);
  }
  if (lifecycleFiles.length > 0) {
    runNodeScript("node_modules/vitest/vitest.mjs", ["run", ...lifecycleFiles]);
  }
}

let cleanupStarted = false;
let evidenceSummary;
try {
  if (requestedTestFiles.length > 0) {
    prepareEmptyDatabase();
    runVitest(requestedTestFiles);
  } else {
    const suites = requiredPostgresqlEvidenceSuites();
    validatePostgresqlEvidenceManifest(
      postgresqlEvidenceManifest,
      suites.filter((suite) => existsSync(path.join(rootDir, suite))),
    );
    runNodeScript("scripts/verify-rls-coverage.mjs");

    prepareEmptyDatabase();
    runVitest(suites);

    prepareEmptyDatabase();
    for (const suite of [...suites].reverse()) {
      runVitest([suite]);
    }

    const migrationId = readdirSync(path.join(rootDir, "prisma", "migrations"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1);
    evidenceSummary = createPostgresqlEvidenceSummary({
      postgresMajor: 18,
      migrationId,
      runs: [
        { name: "clean", status: "PASS", suites },
        { name: "repeated-reverse", status: "PASS", suites: [...suites].reverse() },
      ],
    });
  }
} finally {
  if (cleanupStarted) {
    runNodeScript("scripts/reset-test-database.mjs");
  }
}

if (evidenceSummary) {
  await writePostgresqlEvidenceFile(evidencePath, evidenceSummary);
  process.stdout.write(`${JSON.stringify(evidenceSummary)}\n`);
  process.stdout.write("postgresql_evidence=.local/evidence/postgresql-security-evidence.json\n");
}
