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
    await run(process.execPath, [
      "node_modules/tsx/dist/cli.mjs",
      "src/worker/main.ts",
      "outbox-worker",
      args[0] ?? process.env.OUTBOX_WORKER_ID ?? `ams-start-outbox-${process.pid}`,
    ]);
    break;
  case "outbox-drain":
    await run(process.execPath, [
      "node_modules/tsx/dist/cli.mjs",
      "src/worker/main.ts",
      "outbox-drain",
      args[0] ?? process.env.OUTBOX_WORKER_ID ?? "ams-start-outbox",
    ]);
    break;
  case "outbox-retention":
    await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/worker/main.ts", "outbox-retention"]);
    break;
  case "migrate":
    await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"]);
    await run(process.execPath, ["scripts/pgboss-migrate.mjs"]);
    break;
  case "bootstrap":
    await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/seed-bootstrap.ts"]);
    break;
  case "verify-web-env":
    await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/verify-web-environment.ts"]);
    break;
  default:
    throw new Error(`Unsupported container entrypoint mode: ${mode}`);
}
