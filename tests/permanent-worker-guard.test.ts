import { describe, expect, it, vi } from "vitest";
import { acquirePermanentOutboxWorkerGuard } from "../src/modules/platform-operations/infrastructure/permanent-worker-guard.ts";

describe("permanent outbox worker guard", () => {
  it("holds one advisory lock for the process lifetime and releases it once", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] });
    const release = vi.fn();
    const unlock = await acquirePermanentOutboxWorkerGuard({
      connect: vi.fn(async () => ({ query, release })),
    });

    expect(query.mock.calls[0]?.[0]).toContain("pg_try_advisory_lock");
    expect(release).not.toHaveBeenCalled();
    await unlock();
    await unlock();
    expect(query.mock.calls[1]?.[0]).toContain("pg_advisory_unlock");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rejects a second permanent worker and returns its connection", async () => {
    const release = vi.fn();
    await expect(
      acquirePermanentOutboxWorkerGuard({
        connect: vi.fn(async () => ({
          query: vi.fn(async () => ({ rows: [{ acquired: false }] })),
          release,
        })),
      }),
    ).rejects.toThrow("already active");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
