import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { acquireSourceExecutionGuard, sourceExecutionGuardKey } from "../src/modules/ingestion-core/infrastructure/source-execution-guard.ts";

const target = { organizationId: "org", projectId: "project", sourceId: "source" };
function fixture(acquired = true) {
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn(async ({ text }: { text: string }) => ({ rows: text.includes("pg_try") ? [{ acquired }]
      : text.includes("pg_backend_pid") ? [{ pid: 42 }]
      : text.includes("unlock") ? [{ unlocked: true }] : [] })),
    release: vi.fn(),
  });
  return { client, pool: { connect: vi.fn(async () => client) } };
}

describe("Source lifetime admission and transaction fence", () => {
  it("separates full scoped keys and acquires shared before dropping exclusive admission", async () => {
    const { client, pool } = fixture();
    const lease = await acquireSourceExecutionGuard(pool as never, target);
    expect(sourceExecutionGuardKey(target)).not.toEqual(sourceExecutionGuardKey({ ...target, projectId: "other" }));
    expect(client.query.mock.calls.map(([query]) => query.text)).toEqual([
      expect.stringContaining("pg_try_advisory_lock("), expect.stringContaining("pg_advisory_lock_shared("),
      expect.stringContaining("pg_try_advisory_lock("), expect.stringContaining("pg_try_advisory_lock("),
      expect.stringContaining("pg_backend_pid"), expect.stringContaining("pg_advisory_unlock("),
    ]);
    const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn(async () => [{ owned: true }]) };
    await lease.fence(tx as never);
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    await lease.release(); await lease.release();
    expect(client.query.mock.calls.at(-3)?.[0].text).toContain("pg_advisory_unlock_shared");
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledWith(undefined);
    expect(client.listenerCount("error") + client.listenerCount("end")).toBe(0);
  });

  it("returns BUSY without load or persistent lock when exclusive admission is denied", async () => {
    const { client, pool } = fixture(false);
    await expect(acquireSourceExecutionGuard(pool as never, target)).rejects.toThrow("SOURCE_EXECUTION_BUSY");
    expect(client.query).toHaveBeenCalledOnce(); expect(client.release).toHaveBeenCalledOnce();
  });

  it.each(["error", "end"])("invalidates on %s and destroys the dead guardian instead of pooling a lock", async (event) => {
    const { client, pool } = fixture();
    const lease = await acquireSourceExecutionGuard(pool as never, target);
    client.emit(event, new Error("private database cause"));
    expect(lease.signal.aborted).toBe(true);
    expect(() => lease.assertActive()).toThrow("SOURCE_EXECUTION_LEASE_LOST");
    await lease.release();
    expect(client.release).toHaveBeenCalledWith(expect.objectContaining({ message: "SOURCE_EXECUTION_LEASE_LOST" }));
  });

  it("rejects an absent original backend after transaction shared admission", async () => {
    const { pool } = fixture();
    const lease = await acquireSourceExecutionGuard(pool as never, target);
    const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn(async () => [{ owned: false }]) };
    await expect(lease.fence(tx as never)).rejects.toThrow("SOURCE_EXECUTION_LEASE_LOST");
    expect(tx.$executeRaw).toHaveBeenCalledOnce(); expect(lease.signal.aborted).toBe(true);
    await lease.release();
  });

  it("destroys the connection on unlock failure", async () => {
    const { client, pool } = fixture();
    const lease = await acquireSourceExecutionGuard(pool as never, target);
    client.query.mockRejectedValueOnce(new Error("private connection failure"));
    await lease.release();
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it("bounds active guards without opening a fifth pooled connection", async () => {
    const leases = await Promise.all(Array.from({ length: 4 }, (_, index) => acquireSourceExecutionGuard(fixture().pool as never,
      { ...target, sourceId: `source-${index}` })));
    const { pool } = fixture();
    try {
      await expect(acquireSourceExecutionGuard(pool as never, target)).rejects.toThrow("SOURCE_EXECUTION_BUSY");
      expect(pool.connect).not.toHaveBeenCalled();
    } finally { await Promise.all(leases.map((lease) => lease.release())); }
  });

  it("times out acquisition but keeps the reservation until a late client is safely returned", async () => {
    vi.useFakeTimers();
    const { client } = fixture();
    let resolve!: (value: typeof client) => void;
    const pending = acquireSourceExecutionGuard({ connect: () => new Promise((done) => { resolve = done; }) } as never, target);
    const rejected = expect(pending).rejects.toThrow("SOURCE_EXECUTION_BUSY");
    await vi.advanceTimersByTimeAsync(5_000); await rejected;
    resolve(client); await Promise.resolve(); await Promise.resolve();
    expect(client.release).toHaveBeenCalledOnce(); expect(client.query).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
