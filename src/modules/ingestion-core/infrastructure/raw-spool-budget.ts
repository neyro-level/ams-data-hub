import "server-only";

export const RAW_SPOOL_MAX_CONCURRENT = 4;
export const RAW_SPOOL_MAX_RESERVED_BYTES = 512 * 1024 * 1024;
const reservations = new Map<symbol, number>();

/** Single-worker process budget; runtime binds its concurrency to these caps. */
export function reserveRawSpool(maxBytes: number): () => void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("RAW_ARTIFACT_LIMIT_INVALID");
  const reservedBytes = [...reservations.values()].reduce((sum, value) => sum + value, 0);
  if (reservations.size >= RAW_SPOOL_MAX_CONCURRENT || reservedBytes + maxBytes > RAW_SPOOL_MAX_RESERVED_BYTES) {
    throw new Error("RAW_ARTIFACT_CAPACITY_EXCEEDED");
  }
  const lease = Symbol("raw-spool");
  reservations.set(lease, maxBytes);
  return () => { reservations.delete(lease); };
}
