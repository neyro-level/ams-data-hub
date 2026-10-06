import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { runWorkerProcessLifecycle } from "../src/infrastructure/worker-process-lifecycle.ts";
import { runSourceConsumerReadiness } from "../src/infrastructure/source-consumer-readiness.ts";

describe("permanent worker process lifecycle", () => {
  it("starts the process watchdog on actual readiness-consumer rejection while its original probe remains pending", async () => {
    vi.useFakeTimers(); const onTimeout = vi.fn(); const clear = vi.fn();
    let settleProbe!: () => void; let rejectConsumer!: (error: Error) => void;
    const running = runWorkerProcessLifecycle({ signals: new EventEmitter(), shutdownTimeoutMs: 100, close: vi.fn(), onTimeout,
      run: (signal, requestShutdown) => runSourceConsumerReadiness({ signal, onConsumerStopped: requestShutdown,
        run: () => new Promise<void>((_, reject) => { rejectConsumer = reject; }),
        probe: () => new Promise<void>((resolve) => { settleProbe = resolve; }), publish: vi.fn(), clear,
        intervalMs: 30, probeTimeoutMs: 10 }) });
    const rejected = expect(running).rejects.toThrow("CONSUMER_FAILED");
    await vi.advanceTimersByTimeAsync(0); rejectConsumer(new Error("CONSUMER_FAILED"));
    await vi.advanceTimersByTimeAsync(100); expect(onTimeout).toHaveBeenCalledOnce();
    settleProbe(); await rejected; expect(clear).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers();
  });
  it("bounds stalled owned cleanup after consumer failure without needing an OS signal", async () => {
    vi.useFakeTimers(); const signals = new EventEmitter(); const onTimeout = vi.fn();
    let finish!: () => void;
    const running = runWorkerProcessLifecycle({ signals, shutdownTimeoutMs: 100, close: vi.fn(), onTimeout,
      run: async (signal, requestShutdown) => {
        requestShutdown(); expect(signal.aborted).toBe(true);
        await new Promise<void>((resolve) => { finish = resolve; });
        throw new Error("CONSUMER_FAILED");
      } });
    const rejected = expect(running).rejects.toThrow("CONSUMER_FAILED");
    await vi.advanceTimersByTimeAsync(100); expect(onTimeout).toHaveBeenCalledOnce();
    finish(); await rejected; expect(signals.eventNames()).toEqual([]); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers();
  });
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
