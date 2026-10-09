import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createTestDatabaseUrl, readTestDatabaseTarget } from "./verify-test-database-env.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const target = readTestDatabaseTarget(process.env);
if (target.database !== "ams_data_hub_test" || target.port !== 5435) {
  throw new Error("DATA_SAFETY_DRILL_TARGET_DENIED");
}
const restoreDatabase = target.database.replace(/_test$/, "_restore_test");
if (restoreDatabase === target.database || !restoreDatabase.endsWith("_restore_test")) {
  throw new Error("Unsafe restore drill database name");
}
const evidenceDir = path.join(rootDir, ".local", "evidence");
const dumpPath = path.join(evidenceDir, `data-safety-${randomUUID()}.dump`);
const evidencePath = path.join(evidenceDir, "data-safety-drill.json");
const commonEnvironment = {
  ...process.env,
  APP_ENV: "test",
  NODE_ENV: "test",
  DATABASE_HOST: target.host,
  DATABASE_PORT: String(target.port),
  DATABASE_USER: target.user,
  DATABASE_PASSWORD: target.password,
  DATABASE_NAME: target.database,
  DATABASE_SSLMODE: target.sslmode,
  DATABASE_URL: createTestDatabaseUrl(target),
  PGPASSWORD: target.password,
};

function run(command, args, options = {}) {
  const environment = { ...commonEnvironment, ...(options.environment ?? {}) };
  if (options.admin) delete environment.PGPASSWORD;
  const result = spawnSync(command, args, { cwd: rootDir, env: environment, stdio: options.capture ? "pipe" : "inherit", encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status ?? 1}`);
  return result.stdout?.trim() ?? "";
}

function adminArgs(database) {
  return ["-h", target.host, "-p", String(target.port), "-U", "postgres", "-d", database];
}

function runRecoveryProof(phase, database) {
  const proofTarget = { ...target, database };
  run(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.data-safety.config.mts"], {
    environment: { DATA_SAFETY_DRILL_PHASE: phase, TEST_DATABASE_NAME: database,
      DATABASE_NAME: database, DATABASE_URL: createTestDatabaseUrl(proofTarget) },
  });
}
await mkdir(evidenceDir, { recursive: true });
// Never leave an earlier PASS masquerading as this run's result.
await rm(evidencePath, { force: true });
await rm(path.join(evidenceDir, "data-safety-source-state.json"), { force: true });
await rm(path.join(evidenceDir, "data-safety-restored-state.json"), { force: true });
let drillError;
let cleanupError;
let completedEvidence;
try {
  run(process.execPath, ["scripts/reset-test-database.mjs"]);
  run(process.execPath, ["scripts/prepare-rls-test-identities.mjs"], { admin: true });
  run(process.execPath, ["node_modules/prisma/build/index.js", "generate"]);
  run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/seed-bootstrap.ts"]);
  run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/seed-test-database.ts"]);

  runRecoveryProof("prepare", target.database);

  run("pg_dump", ["-Fc", "-h", target.host, "-p", String(target.port), "-U", target.user, "-d", target.database, "-f", dumpPath]);
  run("dropdb", ["--if-exists", "--force", "-h", target.host, "-p", String(target.port), "-U", "postgres", restoreDatabase], { admin: true });
  run("createdb", ["-h", target.host, "-p", String(target.port), "-U", "postgres", restoreDatabase], { admin: true });
  // Preserve fixed runtime function owners and ACLs. Stripping these would
  // silently turn NOBYPASS definers into superuser-owned functions after restore.
  run("pg_restore", ["--exit-on-error", ...adminArgs(restoreDatabase), dumpPath], { admin: true });
  runRecoveryProof("restore", restoreDatabase);
  const restored = JSON.parse(await readFile(path.join(evidenceDir, "data-safety-restored-state.json"), "utf8"));
  const dumpSha256 = createHash("sha256").update(await readFile(dumpPath)).digest("hex");
  completedEvidence = { schema: "DATA_SAFETY_DRILL_V2", status: "PASS", environment: "isolated-local", postgresMajor: 18,
    sourceDatabase: target.database, restoreDatabase, dumpSha256, ...restored };
} catch (error) {
  drillError = error;
} finally {
  try { run("dropdb", ["--if-exists", "--force", "-h", target.host, "-p", String(target.port), "-U", "postgres", restoreDatabase], { admin: true }); } catch (error) { cleanupError ??= error; }
  try { await rm(dumpPath, { force: true }); } catch (error) { cleanupError ??= error; }
  try { run(process.execPath, ["scripts/reset-test-database.mjs"]); } catch (error) { cleanupError ??= error; }
}

if (drillError) throw drillError;
if (cleanupError) throw cleanupError;
if (!completedEvidence) throw new Error("DATA_SAFETY_DRILL_EVIDENCE_MISSING");
await writeFile(evidencePath, `${JSON.stringify({ ...completedEvidence, cleanupComplete: true }, null, 2)}\n`, "utf8");
process.stdout.write("data_safety_drill=PASS data_safety_evidence=.local/evidence/data-safety-drill.json\n");
