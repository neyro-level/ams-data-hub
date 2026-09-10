import type { Logger } from "pino";
import { getLogger } from "../../../platform/observability/logger.ts";
import type { SyncLogEvent, SyncLogger } from "../application/ports/sync-logger.ts";

export class PinoSyncLogger implements SyncLogger {
  constructor(
    private readonly logger: Logger = getLogger({ runtime: "worker", module: "data-ingestion" }),
  ) {}

  log(event: SyncLogEvent): void {
    this.logger.info(event, event.event);
  }
}
