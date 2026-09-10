import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const mode = process.argv[2] ?? "status";
if (!new Set(["status", "start"]).has(mode)) {
  throw new Error(`Unsupported local development mode: ${mode}`);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";
const port = 3001;
const baseUrl = `http://${host}:${port}`;

function readDatabaseTarget() {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    return {
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      ssl: url.searchParams.get("sslmode") === "require",
    };
  }

  return {
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSLMODE === "require",
  };
}

function runDatabaseStatus() {
  const result = spawnSync(process.execPath, [path.join(projectRoot, "scripts", "local-postgres.mjs"), "status"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error("Native local PostgreSQL is not ready");
}

async function readLocalSummary() {
  const target = readDatabaseTarget();
  const client = new pg.Client({ ...target, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const result = await client.query(`
      select
        exists(
          select 1 from "User"
          where username = 'superadmin'
            and "systemRole" = 'PLATFORM_ADMIN'
            and "disabledAt" is null
        ) as superadmin_ready,
        (select count(*)::int from "Project") as project_count,
        (select count(*)::int from "Site") as site_count,
        (select count(*)::int from "ReportSnapshot") as report_count
    `);
    return result.rows[0];
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function readWebStatus() {
  try {
    const response = await fetch(`${baseUrl}/api/health/live`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.status === "ok" && body?.service === "ams-seo-monitor" ? body : null;
  } catch {
    return null;
  }
}

function isPortListening() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1_500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function printSummary(summary, webReady) {
  console.log(`local_superadmin=${summary.superadmin_ready ? "ready" : "missing"} username=superadmin`);
  console.log(`local_data=projects:${summary.project_count} sites:${summary.site_count} reports:${summary.report_count}`);
  console.log(`local_web=${webReady ? "ready" : "stopped"} url=${baseUrl}`);
}

function preserveGeneratedFiles() {
  return ["next-env.d.ts"].map((relativePath) => {
    const filePath = path.join(projectRoot, relativePath);
    return { filePath, content: readFileSync(filePath) };
  });
}

function restoreGeneratedFiles(snapshots) {
  for (const snapshot of snapshots) {
    const current = readFileSync(snapshot.filePath);
    if (!current.equals(snapshot.content)) writeFileSync(snapshot.filePath, snapshot.content);
  }
}

runDatabaseStatus();
const summary = await readLocalSummary();
let web = await readWebStatus();

if (mode === "status") {
  printSummary(summary, Boolean(web));
  process.exit(summary.superadmin_ready ? 0 : 1);
}

if (!summary.superadmin_ready) {
  throw new Error("Local superadmin is missing or disabled; use the documented recovery flow");
}

if (!web) {
  if (await isPortListening()) {
    throw new Error(`Port ${port} is occupied by another application; it was not stopped`);
  }

  const generatedFiles = preserveGeneratedFiles();
  try {
    const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
    const logDir = path.join(projectRoot, ".next");
    mkdirSync(logDir, { recursive: true });
    const stdout = openSync(path.join(logDir, "local-dev-3001.log"), "a");
    const stderr = openSync(path.join(logDir, "local-dev-3001.error.log"), "a");
    const child = spawn(process.execPath, [nextBin, "dev", "--hostname", host, "--port", String(port)], {
      cwd: projectRoot,
      detached: true,
      env: process.env,
      stdio: ["ignore", stdout, stderr],
      windowsHide: true,
    });
    child.unref();

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      web = await readWebStatus();
      if (web) break;
    }
    if (!web) throw new Error("AMS IMPULSE did not become ready on port 3001; inspect .next/local-dev-3001.error.log");
  } finally {
    restoreGeneratedFiles(generatedFiles);
  }
}

printSummary(summary, true);
console.log(`open_url=${baseUrl}/analyst`);
