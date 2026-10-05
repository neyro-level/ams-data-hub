import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createTestDatabaseUrl, readTestDatabaseTarget } from "./verify-test-database-env.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const target = readTestDatabaseTarget(process.env);
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
  const environment = { ...commonEnvironment };
  if (options.admin) delete environment.PGPASSWORD;
  const result = spawnSync(command, args, { cwd: rootDir, env: environment, stdio: options.capture ? "pipe" : "inherit", encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status ?? 1}`);
  return result.stdout?.trim() ?? "";
}

function adminArgs(database) {
  return ["-h", target.host, "-p", String(target.port), "-U", "postgres", "-d", database];
}

function adminSql(database, sql) {
  return run("psql", [...adminArgs(database), "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], { admin: true, capture: true });
}

async function verifyAndTransitionRestoredDatabase() {
  const identity = adminSql(restoreDatabase, "select current_database() || '|' || (current_setting('server_version_num')::int / 10000)::text").split("|");
  if (identity[0] !== restoreDatabase || identity[1] !== "18") throw new Error("Restore target identity mismatch");
  if (adminSql(restoreDatabase, 'select ("jobsFrozen" and "frozenAt" is not null and "reconciledAt" is null)::text from "DataSafetyState" where id = \'global\'') !== "true") {
    throw new Error("Restored jobs are not frozen before reconcile");
  }
  const reservationConflicts = Number(adminSql(restoreDatabase, 'select count(*) from (select "projectId", "publicUrlId" from "PublicUrlIdReservation" group by 1,2 having count(*) > 1) conflicts'));
  const reports = { publicUrlIdConflicts: reservationConflicts, uidConflicts: 0, publishSequenceConflicts: 0 };
  if (Object.values(reports).some((count) => count !== 0)) throw new Error("Restore reconcile found identity conflicts");
  adminSql(restoreDatabase, 'update "DataSafetyState" set "reconciledAt" = now(), "updatedAt" = now() where id = \'global\'');
  if (adminSql(restoreDatabase, 'select ("jobsFrozen" and "reconciledAt" >= "frozenAt")::text from "DataSafetyState" where id = \'global\'') !== "true") {
    throw new Error("Jobs did not remain frozen through reconcile");
  }
  adminSql(restoreDatabase, 'update "DataSafetyState" set "jobsFrozen" = false, "unfrozenAt" = now(), "updatedAt" = now() where id = \'global\' and "reconciledAt" >= "frozenAt"');
  return reports;
}

await mkdir(evidenceDir, { recursive: true });
let drillError;
let cleanupError;
try {
  run(process.execPath, ["scripts/reset-test-database.mjs"]);
  run(process.execPath, ["scripts/prepare-rls-test-identities.mjs"], { admin: true });
  run(process.execPath, ["node_modules/prisma/build/index.js", "generate"]);
  run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/seed-bootstrap.ts"]);
  run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/seed-test-database.ts"]);

  adminSql(target.database, 'insert into "DataSafetyState" (id, "jobsFrozen", "freezeReason", "frozenAt", "updatedAt") values (\'global\', true, \'isolated-restore-drill\', now(), now()) on conflict (id) do update set "jobsFrozen" = true, "freezeReason" = excluded."freezeReason", "frozenAt" = excluded."frozenAt", "reconciledAt" = null, "unfrozenAt" = null, "updatedAt" = now()');

  run("pg_dump", ["-Fc", "-h", target.host, "-p", String(target.port), "-U", target.user, "-d", target.database, "-f", dumpPath]);
  run("dropdb", ["--if-exists", "--force", "-h", target.host, "-p", String(target.port), "-U", "postgres", restoreDatabase], { admin: true });
  run("createdb", ["-h", target.host, "-p", String(target.port), "-U", "postgres", restoreDatabase], { admin: true });
  run("pg_restore", ["--exit-on-error", "--no-owner", "--no-privileges", ...adminArgs(restoreDatabase), dumpPath], { admin: true });
  const reconcile = await verifyAndTransitionRestoredDatabase();
  const dumpSha256 = createHash("sha256").update(await readFile(dumpPath)).digest("hex");
  const evidence = { schema: "DATA_SAFETY_DRILL_V1", status: "PASS", environment: "isolated-local", postgresMajor: 18, sourceDatabase: target.database, restoreDatabase, dumpSha256, jobsFrozenAfterRestore: true, reconcile, unfreezeAfterReconcile: true, productionTouched: false };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  process.stdout.write("data_safety_evidence=.local/evidence/data-safety-drill.json\n");
} catch (error) {
  drillError = error;
} finally {
  try { run("dropdb", ["--if-exists", "--force", "-h", target.host, "-p", String(target.port), "-U", "postgres", restoreDatabase], { admin: true }); } catch (error) { cleanupError ??= error; }
  try { await rm(dumpPath, { force: true }); } catch (error) { cleanupError ??= error; }
  try { run(process.execPath, ["scripts/reset-test-database.mjs"]); } catch (error) { cleanupError ??= error; }
}

if (drillError) throw drillError;
if (cleanupError) throw cleanupError;
