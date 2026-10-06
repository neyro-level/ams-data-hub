import { describe, expect, it, vi } from "vitest";
const queue = vi.hoisted(() => ({ get: vi.fn(), stop: vi.fn() }));
vi.mock("../src/modules/platform-operations/worker.ts", async (original) => ({
  ...await original<typeof import("../src/modules/platform-operations/worker.ts")>(), getPgBoss: queue.get, stopPgBoss: queue.stop,
}));
import { runSourceWorker, runSourceWorkerWithDependencies } from "../src/infrastructure/source-worker-runtime.ts";
import { SOURCE_IMPORT_QUEUE } from "../src/modules/ingestion-core/worker.ts";

describe("source worker command composition", () => {
  it("rejects missing storage configuration before connecting to pg-boss", async () => {
    vi.stubEnv("PROJECT_STORAGE_BINDINGS", "");
    try { await expect(runSourceWorker({ workerId: "synthetic", signal: new AbortController().signal })).rejects.toThrow("PROJECT_STORAGE_BINDINGS_INVALID");
      expect(queue.get).not.toHaveBeenCalled(); expect(queue.stop).not.toHaveBeenCalled(); }
    finally { vi.unstubAllEnvs(); }
  });
  it("shares queue ownership between outbox and source consumers without stopping it per cycle", async () => {
    const controller = new AbortController(); const fetched: string[] = [];
    const boss = { createQueue: vi.fn(), fetch: vi.fn(async (name: string) => {
      fetched.push(name); if (name === SOURCE_IMPORT_QUEUE) controller.abort(); return [];
    }), complete: vi.fn(), fail: vi.fn(), schedule: vi.fn(), unschedule: vi.fn(), getSchedules: vi.fn(async () => []) };
    const resolveStorage = vi.fn(); const repository = { listSchedulingSources: vi.fn(async () => []), loadExecutionContext: vi.fn() };
    const heartbeat = vi.fn(); const reliability = { claim: vi.fn(async () => null), takeOver: vi.fn(), complete: vi.fn(), fail: vi.fn() };
    expect(await runSourceWorkerWithDependencies({ workerId: "synthetic", signal: controller.signal },
      { boss, repository, resolveStorage, outbox: { boss: { ...boss, send: vi.fn() }, reliability, heartbeat } }))
      .toEqual({ fetched: 0, completed: 0, failed: 0 });
    expect(fetched).toEqual(["outbox.dispatch", SOURCE_IMPORT_QUEUE]);
    expect(boss.createQueue).toHaveBeenCalledWith(SOURCE_IMPORT_QUEUE, expect.objectContaining({ policy: "exclusive" }));
    expect(heartbeat).toHaveBeenCalled(); expect(resolveStorage).not.toHaveBeenCalled(); expect(queue.stop).not.toHaveBeenCalled();
    expect(repository.listSchedulingSources).toHaveBeenCalledOnce();
  });
  it("refreshes persisted schedules during the maintenance loop", async () => {
    const controller = new AbortController(); let clock = 100_000; let cycles = 0;
    const time = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const boss = { createQueue: vi.fn(), schedule: vi.fn(), unschedule: vi.fn(), getSchedules: vi.fn(async () => []),
      complete: vi.fn(), fail: vi.fn(), fetch: vi.fn(async (name: string) => {
        if (name === SOURCE_IMPORT_QUEUE) { clock += 60_001; if (++cycles === 2) controller.abort(); }
        return [];
      }) };
    const repository = { listSchedulingSources: vi.fn(async () => []), loadExecutionContext: vi.fn() };
    const reliability = { claim: vi.fn(async () => null), takeOver: vi.fn(), complete: vi.fn(), fail: vi.fn() };
    try {
      await runSourceWorkerWithDependencies({ workerId: "synthetic", signal: controller.signal, pollIntervalMs: 10 },
        { boss, repository, resolveStorage: vi.fn(), outbox: { boss: { ...boss, send: vi.fn() }, reliability, heartbeat: vi.fn() } });
      expect(repository.listSchedulingSources).toHaveBeenCalledTimes(2);
    } finally { time.mockRestore(); }
  });
});
