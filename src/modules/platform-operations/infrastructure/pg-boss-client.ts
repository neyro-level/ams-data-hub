import { PgBoss } from "pg-boss";
import { createPgPoolConfigFromEnvironment } from "../../../platform/database/prisma/pool-config.ts";
import { readDatabaseEnvironment } from "../../../platform/config/server-environment.ts";
import { getLogger } from "../../../platform/observability/logger.ts";
import {
  OUTBOX_DELIVERY_QUEUE,
  OUTBOX_EXPIRE_IN_SECONDS,
  OUTBOX_HANDLER_MAX_ATTEMPTS,
  OUTBOX_PGBOSS_CONNECTION_MAX,
  OUTBOX_RETRY_DELAY_MAX_SECONDS,
  OUTBOX_RETRY_DELAY_SECONDS,
} from "../domain/pg-boss.ts";

const logger = getLogger({ component: "pg-boss" });

let bossPromise: Promise<PgBoss> | null = null;

function createBoss() {
  const pool = createPgPoolConfigFromEnvironment(readDatabaseEnvironment());
  return new PgBoss({
    host: pool.host,
    port: pool.port,
    user: pool.user,
    password: typeof pool.password === "string" ? pool.password : undefined,
    database: pool.database,
    ssl: pool.ssl,
    schema: "pgboss",
    max: OUTBOX_PGBOSS_CONNECTION_MAX,
    application_name: "seo-monitor-pgboss",
    migrate: false,
    createSchema: false,
    useListenNotify: false,
  });
}

async function ensureQueue(boss: PgBoss) {
  await boss.createQueue(OUTBOX_DELIVERY_QUEUE, {
    retryLimit: OUTBOX_HANDLER_MAX_ATTEMPTS - 1,
    retryDelay: OUTBOX_RETRY_DELAY_SECONDS,
    retryBackoff: true,
    retryDelayMax: OUTBOX_RETRY_DELAY_MAX_SECONDS,
    expireInSeconds: OUTBOX_EXPIRE_IN_SECONDS,
    deleteAfterSeconds: 0,
  });
}

export async function getPgBoss(): Promise<PgBoss> {
  bossPromise ??= createBoss()
    .start()
    .then(async (boss) => {
      boss.on("error", (error) => {
        logger.error({ err: error }, "pg-boss runtime error");
      });
      await ensureQueue(boss);
      return boss;
    });
  return bossPromise;
}

export async function stopPgBoss(): Promise<void> {
  if (!bossPromise) {
    return;
  }
  const boss = await bossPromise;
  bossPromise = null;
  await boss.stop();
}
