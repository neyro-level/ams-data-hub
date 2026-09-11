import {
  drainOutbox,
  runReliabilityRetention,
} from "../modules/platform-operations/worker.ts";
import { getLogger } from "../platform/observability/logger.ts";

const command = process.argv[2] ?? null;
const argument = process.argv[3] ?? null;
const logger = getLogger({ runtime: "worker", entrypoint: "main" });

async function main() {
  if (command === "module-smoke") {
    logger.info({ event: "worker_module_smoke_ok" }, "worker module smoke passed");
    return;
  }

  if (command === "outbox-drain") {
    const result = await drainOutbox({ workerId: argument ?? "ams-start-worker" });
    logger.info({ event: "outbox_drain_finished", ...result }, "outbox drain finished");
    if (result.failed > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "outbox-retention") {
    const result = await runReliabilityRetention();
    logger.info({ event: "outbox_retention_finished", ...result }, "outbox retention finished");
    return;
  }

  if (command !== "maintenance-smoke") {
    throw new Error(
      "Usage: worker module-smoke | maintenance-smoke | outbox-drain [worker-id] | outbox-retention",
    );
  }
  logger.info({ event: "worker_maintenance_smoke_ok" }, "maintenance smoke passed");
}

main().catch((error) => {
  logger.error({ err: error }, "worker failed");
  process.exit(1);
});
