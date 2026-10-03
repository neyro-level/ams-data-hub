import { readFile } from "node:fs/promises";

const [dockerfile, compose, packageJson, runtimeEntrypoint, webUnit, retentionUnit] = await Promise.all([
  readFile("Dockerfile", "utf8"),
  readFile("docker-compose.production.yml", "utf8"),
  readFile("package.json", "utf8").then(JSON.parse),
  readFile("scripts/runtime-entrypoint.mjs", "utf8"),
  readFile("ops/systemd/ams-data-hub-web.service", "utf8"),
  readFile("ops/systemd/ams-data-hub-outbox.service", "utf8"),
]);

const failures = [];
const requireContract = (condition, message) => {
  if (!condition) failures.push(message);
};

requireContract(!/apt-get\s+upgrade/u.test(dockerfile), "Dockerfile must not run apt-get upgrade");
requireContract(/FROM node:[^\n]+@sha256:[0-9a-f]{64}/u.test(dockerfile), "Runtime base image must be digest-pinned");
requireContract(packageJson.dependencies?.pino === "10.3.1", "pino must use an exact version");
requireContract(runtimeEntrypoint.includes('"--conditions=react-server"'), "Worker child must run with the react-server condition");
requireContract(!compose.includes("required: false"), "Production env files must be required");
requireContract((compose.match(/required: true/gu) ?? []).length === 10, "Every production env-file declaration must be required");
requireContract(compose.includes('"healthcheck"'), "Worker healthcheck must use the application heartbeat command");
requireContract(!compose.includes("process.kill(1, 0)"), "PID liveness is not a worker healthcheck");
requireContract(compose.includes('command: ["bootstrap-roles"]'), "Compose must expose the controlled role bootstrap");
requireContract(compose.includes('command: ["outbox-retention"]'), "Retention must remain a one-shot Compose command");
requireContract(webUnit.includes("up -d web worker"), "Host wrapper must manage the canonical Compose web/worker stack");
requireContract(retentionUnit.includes("maintenance outbox-retention"), "Retention timer must invoke only one-shot maintenance");
requireContract(!retentionUnit.includes("outbox-worker"), "Retention unit must not start a second permanent worker");

if (failures.length > 0) throw new Error(`Runtime contract failed:\n- ${failures.join("\n- ")}`);
process.stdout.write("runtime_contract=PASS\n");
