import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] ?? "status";
if (!new Set(["status", "start"]).has(mode)) {
  throw new Error(`Unsupported local development mode: ${mode}`);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";
const port = 3001;
const baseUrl = `http://${host}:${port}`;

function runDatabaseStatus() {
  const result = spawnSync(process.execPath, [path.join(projectRoot, "scripts", "local-postgres.mjs"), "status"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error("Native local PostgreSQL is not ready");
}

async function readWebStatus() {
  try {
    const response = await fetch(`${baseUrl}/api/health/live`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.status === "ok" && body?.service === "ams-data-hub" ? body : null;
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

function printSummary(webReady) {
  console.log(`local_web=${webReady ? "ready" : "stopped"} url=${baseUrl}`);
  console.log(`open_url=${baseUrl}/dashboard`);
}

runDatabaseStatus();
let web = await readWebStatus();

if (mode === "status") {
  printSummary(Boolean(web));
  process.exit(web ? 0 : 1);
}

if (!web) {
  if (await isPortListening()) {
    throw new Error(`Port ${port} is occupied by another application; it was not stopped`);
  }

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
  if (!web) throw new Error("AMS Data Hub did not become ready on port 3001; inspect .next/local-dev-3001.error.log");
}

printSummary(true);
