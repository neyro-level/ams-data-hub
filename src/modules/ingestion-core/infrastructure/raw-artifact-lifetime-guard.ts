import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient, QueryConfig } from "pg";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";

export interface RawArtifactLifetimeTarget { organizationId: string; projectId: string; rawArtifactHash: string }
export type RawArtifactLifetimeMode = "producer" | "retention";

const MAX_GUARDS = 5;
const ACQUIRE_TIMEOUT_MS = 5_000;
let reservations = 0;

function guardKey(target: RawArtifactLifetimeTarget, namespace: string): readonly [number, number] {
  const hash = createHash("sha256").update(JSON.stringify([
    namespace, target.organizationId, target.projectId, target.rawArtifactHash,
  ])).digest();
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
}
export function rawArtifactLifetimeGuardKey(target: RawArtifactLifetimeTarget): readonly [number, number] {
  return guardKey(target, "ams-raw-artifact-lifetime-v1");
}

export interface RawArtifactLifetimeLease {
  readonly signal: AbortSignal;
  assertActive(): void;
  fence(transaction: DatabaseTransaction): Promise<void>;
  release(): Promise<void>;
}

/** Shared producers span PUT through durable registration. Admission is held
 * only during acquisition and transaction cuts; lifetime is session-owned.
 * Retention fences take exclusive admission, not their own exclusive lifetime
 * key on another connection. Producers MUST also consult the durable
 * pending-delete ledger before PUT: advisory locks cannot settle orphaned IO. */
export async function acquireRawArtifactLifetimeGuard(pool: Pick<Pool, "connect">, target: RawArtifactLifetimeTarget, mode: RawArtifactLifetimeMode): Promise<RawArtifactLifetimeLease> {
  if (![target.organizationId, target.projectId].every((id) => /^[A-Za-z0-9_-]{1,128}$/u.test(id))
    || !/^[a-f0-9]{64}$/u.test(target.rawArtifactHash) || !["producer", "retention"].includes(mode))
    throw new Error("RAW_ARTIFACT_GUARD_TARGET_INVALID");
  if (reservations >= MAX_GUARDS) throw new Error("RAW_ARTIFACT_BUSY");
  reservations += 1;
  let counted = true;
  const unreserve = () => { if (counted) { counted = false; reservations -= 1; } };
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = Promise.resolve().then(() => pool.connect()).then((client) => {
    if (timedOut) { try { client.release(); } finally { unreserve(); } throw new Error("RAW_ARTIFACT_BUSY"); }
    return client;
  }, () => { unreserve(); throw new Error("RAW_ARTIFACT_GUARD_UNAVAILABLE"); });
  let client: PoolClient;
  try {
    client = await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; reject(new Error("RAW_ARTIFACT_BUSY")); }, ACQUIRE_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
  const controller = new AbortController();
  let released = false;
  const lose = () => controller.abort();
  client.on("error", lose);
  client.on("end", lose);
  const key = rawArtifactLifetimeGuardKey(target);
  const admissionKey = guardKey(target, "ams-raw-artifact-admission-v1");
  // Two independent opaque markers distinguish the original session even
  // after PID reuse, without access to another role's pg_stat_activity fields.
  const nonce = randomBytes(16);
  const markers = [0, 8].map((offset) => ({ value: nonce.readBigInt64BE(offset).toString(),
    high: nonce.readUInt32BE(offset), low: nonce.readUInt32BE(offset + 4) }));
  // One-bigint markers occupy a different advisory keyspace from the two-int scope.
  const query = (text: string, values: (number | string)[] = [...key]) => {
    const config: QueryConfig & { query_timeout: number } = { text, values, query_timeout: ACQUIRE_TIMEOUT_MS };
    return client.query(config);
  };
  const discard = (error?: Error) => {
    try { client.release(error); } finally {
      client.removeListener("error", lose); client.removeListener("end", lose); unreserve();
    }
  };
  let backend: { pid: number };
  try {
    const admission = await query(mode === "producer"
      ? "SELECT pg_try_advisory_lock_shared($1::integer, $2::integer) AS acquired"
      : "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired", [...admissionKey]);
    if (admission.rows[0]?.acquired !== true) { discard(); throw new Error("RAW_ARTIFACT_BUSY"); }
    const lifetime = await query(mode === "producer"
      ? "SELECT pg_try_advisory_lock_shared($1::integer, $2::integer) AS acquired"
      : "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired");
    if (lifetime.rows[0]?.acquired !== true) throw new Error("RAW_ARTIFACT_BUSY");
    if ((await query(mode === "producer"
      ? "SELECT pg_advisory_unlock_shared($1::integer, $2::integer) AS unlocked"
      : "SELECT pg_advisory_unlock($1::integer, $2::integer) AS unlocked", [...admissionKey])).rows[0]?.unlocked !== true)
      throw new Error("RAW_ARTIFACT_LEASE_LOST");
    for (const marker of markers) {
      // Do not wait for even an accidental marker collision.
      const marked = await query("SELECT pg_try_advisory_lock($1::bigint) AS acquired", [marker.value]);
      if (marked.rows[0]?.acquired !== true) throw new Error("RAW_ARTIFACT_GUARD_UNAVAILABLE");
    }
    const identity = await query("SELECT pg_backend_pid() AS pid", []);
    backend = identity.rows[0];
    if (!Number.isInteger(backend?.pid) || controller.signal.aborted) throw new Error("RAW_ARTIFACT_LEASE_LOST");
  } catch (error) {
    if (counted) discard(new Error("RAW_ARTIFACT_GUARD_UNAVAILABLE"));
    if (error instanceof Error && error.message === "RAW_ARTIFACT_BUSY") throw error;
    throw new Error("RAW_ARTIFACT_GUARD_UNAVAILABLE");
  }
  const assertActive = () => { if (released || controller.signal.aborted) throw new Error("RAW_ARTIFACT_LEASE_LOST"); };
  return {
    signal: controller.signal,
    assertActive,
    async fence(transaction) {
      assertActive();
      // All business cuts use this order: global safety -> admission -> rows.
      // Guardian acquisition uses try-locks only and never waits for safety.
      await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text`);
      if (mode === "producer") {
        await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(${admissionKey[0]}::integer, ${admissionKey[1]}::integer)`);
        await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(${key[0]}::integer, ${key[1]}::integer)`);
      } else {
        await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${admissionKey[0]}::integer, ${admissionKey[1]}::integer)`);
      }
      const result = await transaction.$queryRaw<{ owned: boolean }[]>(Prisma.sql`
        SELECT EXISTS (SELECT 1 FROM pg_locks l
          WHERE l.locktype = 'advisory' AND l.granted AND l.mode = ${mode === "producer" ? "ShareLock" : "ExclusiveLock"}
            AND l.classid::bigint = ${key[0] >>> 0}::bigint AND l.objid::bigint = ${key[1] >>> 0}::bigint AND l.objsubid = 2
            AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND l.pid = ${backend.pid}
            AND EXISTS (SELECT 1 FROM pg_locks m WHERE m.pid = l.pid AND m.database = l.database
              AND m.locktype = 'advisory' AND m.granted AND m.mode = 'ExclusiveLock' AND m.objsubid = 1
              AND m.classid::bigint = ${markers[0]!.high}::bigint AND m.objid::bigint = ${markers[0]!.low}::bigint)
            AND EXISTS (SELECT 1 FROM pg_locks m WHERE m.pid = l.pid AND m.database = l.database
              AND m.locktype = 'advisory' AND m.granted AND m.mode = 'ExclusiveLock' AND m.objsubid = 1
              AND m.classid::bigint = ${markers[1]!.high}::bigint AND m.objid::bigint = ${markers[1]!.low}::bigint)) AS owned`);
      if (result[0]?.owned !== true) { lose(); throw new Error("RAW_ARTIFACT_LEASE_LOST"); }
      assertActive();
    },
    async release() {
      if (released) return;
      released = true;
      let failed = controller.signal.aborted;
      try {
        if (!failed) failed = (await query(mode === "producer" ? "SELECT pg_advisory_unlock_shared($1::integer, $2::integer) AS unlocked"
          : "SELECT pg_advisory_unlock($1::integer, $2::integer) AS unlocked")).rows[0]?.unlocked !== true;
        if (!failed) for (const marker of markers) {
          if ((await query("SELECT pg_advisory_unlock($1::bigint) AS unlocked", [marker.value])).rows[0]?.unlocked !== true) { failed = true; break; }
        }
      } catch { failed = true; }
      finally { discard(failed ? new Error("RAW_ARTIFACT_LEASE_LOST") : undefined); }
    },
  };
}
