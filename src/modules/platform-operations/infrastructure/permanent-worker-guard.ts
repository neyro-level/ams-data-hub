interface AdvisoryLockResult {
  acquired: boolean;
}

interface AdvisoryLockClient {
  query(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: unknown[] }>;
  release(): void;
}

interface AdvisoryLockPool {
  connect(): Promise<AdvisoryLockClient>;
}

const OUTBOX_WORKER_LOCK_NAMESPACE = 4_278_803;
const OUTBOX_WORKER_LOCK_KEY = 17_311;

export async function acquirePermanentOutboxWorkerGuard(pool: AdvisoryLockPool) {
  const client = await pool.connect();
  let released = false;
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [OUTBOX_WORKER_LOCK_NAMESPACE, OUTBOX_WORKER_LOCK_KEY],
    );
    if ((result.rows[0] as AdvisoryLockResult | undefined)?.acquired !== true) {
      throw new Error("A permanent outbox worker is already active");
    }
  } catch (error) {
    client.release();
    throw error;
  }

  return async () => {
    if (released) return;
    released = true;
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [
        OUTBOX_WORKER_LOCK_NAMESPACE,
        OUTBOX_WORKER_LOCK_KEY,
      ]);
    } finally {
      client.release();
    }
  };
}
