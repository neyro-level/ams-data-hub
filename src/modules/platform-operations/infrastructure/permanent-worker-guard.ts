interface AdvisoryLockResult {
  acquired: boolean;
}

interface AdvisoryLockClient {
  query(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: unknown[] }>;
  release(): void;
  on?(event: "error" | "end", listener: () => void): unknown;
  removeListener?(event: "error" | "end", listener: () => void): unknown;
}

interface AdvisoryLockPool {
  connect(): Promise<AdvisoryLockClient>;
}

const OUTBOX_WORKER_LOCK_NAMESPACE = 4_278_803;
const OUTBOX_WORKER_LOCK_KEY = 17_311;

export async function acquirePermanentOutboxWorkerGuard(pool: AdvisoryLockPool, onConnectionLost?: () => void) {
  const client = await pool.connect();
  let released = false;
  let lost = false;
  const connectionLost = () => {
    if (released || lost) return;
    lost = true; onConnectionLost?.();
  };
  const detach = () => {
    client.removeListener?.("error", connectionLost); client.removeListener?.("end", connectionLost);
  };
  try {
    if (onConnectionLost) {
      if (!client.on || !client.removeListener) throw new Error("WORKER_GUARD_MONITOR_UNAVAILABLE");
      client.on("error", connectionLost); client.on("end", connectionLost);
    }
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [OUTBOX_WORKER_LOCK_NAMESPACE, OUTBOX_WORKER_LOCK_KEY],
    );
    if (lost) throw new Error("WORKER_GUARD_LOST");
    if ((result.rows[0] as AdvisoryLockResult | undefined)?.acquired !== true) {
      throw new Error("A permanent outbox worker is already active");
    }
  } catch (error) {
    released = true; detach();
    client.release();
    throw error;
  }

  return async () => {
    if (released) return;
    released = true;
    detach();
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
