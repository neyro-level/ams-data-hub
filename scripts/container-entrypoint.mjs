import { spawn } from "node:child_process";

const mode = process.argv[2] ?? "web";
const args = process.argv.slice(3);

function run(command, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    const forwardSignal = (signal) => {
      if (!child.killed) {
        child.kill(signal);
      }
    };
    const forwardSigterm = () => forwardSignal("SIGTERM");
    const forwardSigint = () => forwardSignal("SIGINT");
    const cleanupSignalHandlers = () => {
      process.off("SIGTERM", forwardSigterm);
      process.off("SIGINT", forwardSigint);
    };

    process.once("SIGTERM", forwardSigterm);
    process.once("SIGINT", forwardSigint);
    child.on("error", (error) => {
      cleanupSignalHandlers();
      reject(error);
    });
    child.on("exit", (code, signal) => {
      cleanupSignalHandlers();
      if (signal) {
        reject(new Error(`${command} exited by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

switch (mode) {
  case "web":
    await run(process.execPath, [".next/standalone/server.js"]);
    break;
  case "outbox-worker":
    await run(process.execPath, ["scripts/worker-daemon.mjs"]);
    break;
  case "outbox-drain":
    await run(process.execPath, [
      "dist-collector/src/worker/main.js",
      "outbox-drain",
      args[0] ?? process.env.OUTBOX_WORKER_ID ?? "seo-monitor-outbox",
    ]);
    break;
  case "outbox-retention":
    await run(process.execPath, ["dist-collector/src/worker/main.js", "outbox-retention"]);
    break;
  case "projects-sync":
    await run(process.execPath, [
      "dist-collector/src/worker/main.js",
      "projects-sync",
      args[0] ?? "daily",
    ]);
    break;
  case "project-sync": {
    if (!args[0]) {
      throw new Error("Usage: container-entrypoint project-sync <project-slug> [trigger]");
    }
    await run(process.execPath, [
      "dist-collector/src/worker/main.js",
      "project-sync",
      args[0],
      args[1] ?? "manual",
    ]);
    break;
  }
  case "migrate":
    await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"]);
    await run(process.execPath, ["scripts/pgboss-migrate.mjs"]);
    break;
  case "bootstrap":
    await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/seed-bootstrap.ts"]);
    break;
  case "config-sync":
    await run(process.execPath, [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/config-sync.ts",
      ...args,
    ]);
    break;
  case "verify-web-env":
    await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/verify-web-environment.ts"]);
    break;
  default:
    throw new Error(`Unsupported container entrypoint mode: ${mode}`);
}
