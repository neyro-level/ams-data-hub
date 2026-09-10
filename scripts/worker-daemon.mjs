import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import pino from "pino";

const workerId = process.env.OUTBOX_WORKER_ID?.trim() || "seo-monitor-outbox";
const pollDelayMs = Number(process.env.OUTBOX_POLL_DELAY_MS || 5000);
const logger = pino({
  level: process.env.LOG_LEVEL?.trim() || "info",
  base: undefined,
  messageKey: "message",
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  redact: {
    paths: ["password", "token", "authorization", "cookie", "DATABASE_URL", "env.DATABASE_URL"],
    censor: "[REDACTED]",
  },
}).child({ runtime: "worker", mode: "outbox-daemon", workerId });
let stopping = false;
let activeChild = null;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    if (activeChild && !activeChild.killed) {
      activeChild.kill(signal);
    }
  });
}

function runDrain() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist-collector/src/worker/main.js", "outbox-drain", workerId], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    activeChild = child;
    child.on("error", (error) => {
      activeChild = null;
      reject(error);
    });
    child.on("exit", (code, signal) => {
      activeChild = null;
      if (signal) {
        reject(new Error(`outbox drain exited by signal ${signal}`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

while (!stopping) {
  const exitCode = await runDrain().catch((error) => {
    logger.error({ err: error }, "outbox daemon iteration failed");
    return 1;
  });
  if (exitCode !== 0) {
    logger.warn({ exitCode }, "outbox daemon will retry after delay");
  }
  if (!stopping) {
    await sleep(pollDelayMs);
  }
}

logger.info("outbox daemon stopped");
