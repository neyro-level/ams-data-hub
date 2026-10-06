import {
  acquireOutboxWorkerGuard,
  checkOutboxWorkerHealth,
  drainOutbox,
  runOutboxWorker,
  runReliabilityRetention,
} from "../modules/platform-operations/worker.ts";
import { getLogger } from "../platform/observability/logger.ts";
import { runSourceWorker } from "../infrastructure/source-worker-runtime.ts";

const command = process.argv[2] ?? null;
const argument = process.argv[3] ?? null;
const logger = getLogger({ runtime: "worker", entrypoint: "main" });

async function main() {
  if (command === "module-smoke") {
    logger.info({ event: "worker_module_smoke_ok" }, "worker module smoke passed");
    return;
  }

  if (command === "healthcheck") {
    await checkOutboxWorkerHealth();
    return;
  }

  if (command === "outbox-drain") {
    const result = await drainOutbox({ workerId: argument ?? "ams-data-hub-worker" });
    logger.info({ event: "outbox_drain_finished", ...result }, "outbox drain finished");
    if (result.failed > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "outbox-worker" || command === "source-worker") {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const releaseWorkerGuard = await acquireOutboxWorkerGuard();
    try {
      const result = await (command === "source-worker" ? runSourceWorker : runOutboxWorker)({
        workerId: argument ?? process.env.OUTBOX_WORKER_ID ?? `ams-data-hub-worker-${process.pid}`,
        pollIntervalMs: Number(process.env.OUTBOX_POLL_DELAY_MS ?? 1_000),
        shutdownDrainTimeoutMs: Number(
          process.env.OUTBOX_SHUTDOWN_DRAIN_TIMEOUT_MS ?? 30_000,
        ),
        signal: controller.signal,
      });
      logger.info({ event: command === "source-worker" ? "source_worker_stopped" : "outbox_worker_stopped", ...result }, "worker stopped");
      // Handled delivery failures are operational outcomes (retry/dead-letter),
      // not worker-process failures. A resolved lifecycle therefore exits cleanly;
      // infrastructure/runtime failures still reject and reach the fatal catch below.
    } finally {
      await releaseWorkerGuard();
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
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
      "Usage: worker module-smoke | healthcheck | maintenance-smoke | outbox-worker [worker-id] | source-worker [worker-id] | outbox-drain [worker-id] | outbox-retention",
    );
  }
  logger.info({ event: "worker_maintenance_smoke_ok" }, "maintenance smoke passed");
}

main().catch((error) => {
  logger.error({ err: error }, "worker failed");
  process.exit(1);
});
