import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { runWorkerProcessLifecycle } from "../src/infrastructure/worker-process-lifecycle.ts";

describe("permanent worker process lifecycle", () => {
  it("propagates SIGTERM, then closes owned handles only after durable work settles", async () => {
    const signals = new EventEmitter(); const close = vi.fn(); const onTimeout = vi.fn();
    let finish!: () => void; let observed!: AbortSignal;
    const running = runWorkerProcessLifecycle({ signals, shutdownTimeoutMs: 1000, close, onTimeout,
      run: async (signal) => { observed = signal; await new Promise<void>((resolve) => { finish = resolve; }); return "settled"; } });
    signals.emit("SIGTERM");
    expect(observed.aborted).toBe(true); expect(close).not.toHaveBeenCalled();
    finish(); expect(await running).toBe("settled");
    expect(close).toHaveBeenCalledOnce(); expect(onTimeout).not.toHaveBeenCalled();
    expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("cleans up failed guard acquisition and removes both signal listeners", async () => {
    const signals = new EventEmitter(); const close = vi.fn();
    await expect(runWorkerProcessLifecycle({ signals, shutdownTimeoutMs: 1000, close, onTimeout: vi.fn(),
      run: async () => { throw new Error("WORKER_GUARD_BUSY"); } })).rejects.toThrow("WORKER_GUARD_BUSY");
    expect(close).toHaveBeenCalledOnce(); expect(signals.eventNames()).toEqual([]);
  });

  it("retains the deadline through pool/guard cleanup rather than reporting a fake successful stop", async () => {
    vi.useFakeTimers();
    const signals = new EventEmitter(); const onTimeout = vi.fn();
    let finish!: () => void;
    let finishClose!: () => void;
    const close = vi.fn(() => new Promise<void>((resolve) => { finishClose = resolve; }));
    const running = runWorkerProcessLifecycle({ signals, shutdownTimeoutMs: 100, close, onTimeout,
      run: async () => new Promise<void>((resolve) => { finish = resolve; }) });
    signals.emit("SIGTERM"); finish(); await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100); expect(onTimeout).toHaveBeenCalledOnce();
    finishClose(); await running; expect(signals.eventNames()).toEqual([]);
    vi.useRealTimers();
  });

  it.each([0, NaN, 9, 300001, 1.5])("rejects invalid shutdown deadline %s before registering handlers", async (shutdownTimeoutMs) => {
    const signals = new EventEmitter(); const run = vi.fn();
    await expect(runWorkerProcessLifecycle({ signals, shutdownTimeoutMs, run, close: vi.fn(), onTimeout: vi.fn() }))
      .rejects.toThrow("WORKER_SHUTDOWN_DEADLINE_INVALID");
    expect(run).not.toHaveBeenCalled(); expect(signals.eventNames()).toEqual([]);
  });
});
