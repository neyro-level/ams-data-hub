import { afterEach, describe, expect, it, vi } from "vitest";
import { runSourceConsumerReadiness } from "../src/infrastructure/source-consumer-readiness.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fixture() {
  const controller = new AbortController();
  const consumer = deferred<string>();
  const options = { signal: controller.signal, run: vi.fn(() => consumer.promise), probe: vi.fn(async (): Promise<void> => undefined),
    publish: vi.fn(async (): Promise<void> => undefined), clear: vi.fn(async (): Promise<void> => undefined), intervalMs: 30, probeTimeoutMs: 10 };
  return { controller, consumer, options };
}
afterEach(() => vi.useRealTimers());

describe("Source consumer qualified readiness pump", () => {
  it("clears prior owner, independently refreshes during a long consumer, and leaves no timer at return", async () => {
    vi.useFakeTimers(); const { options, consumer } = fixture();
    const running = runSourceConsumerReadiness(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(options.clear).toHaveBeenCalledOnce(); expect(options.publish).toHaveBeenCalledOnce();
    expect(options.clear.mock.invocationCallOrder[0]).toBeLessThan(options.run.mock.invocationCallOrder[0]!);
    await vi.advanceTimersByTimeAsync(90); expect(options.publish).toHaveBeenCalledTimes(4);
    consumer.resolve("done"); expect(await running).toBe("done");
    expect(options.clear).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });

  it("revokes failed qualification and recovers after a transient probe error", async () => {
    vi.useFakeTimers(); const { options, consumer } = fixture();
    options.probe.mockRejectedValueOnce(new Error("private provider failure"));
    const running = runSourceConsumerReadiness(options); await vi.advanceTimersByTimeAsync(0);
    expect(options.clear).toHaveBeenCalledTimes(2); expect(options.publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30); expect(options.publish).toHaveBeenCalledOnce();
    consumer.resolve("done"); await running; expect(vi.getTimerCount()).toBe(0);
  });

  it("clears on timeout immediately, never overlaps probes or publishes their late success", async () => {
    vi.useFakeTimers(); const { options, consumer } = fixture(); const probe = deferred<void>();
    options.probe.mockImplementationOnce(() => probe.promise);
    const running = runSourceConsumerReadiness(options); await vi.advanceTimersByTimeAsync(10);
    expect(options.clear).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300); expect(options.probe).toHaveBeenCalledOnce(); expect(options.publish).not.toHaveBeenCalled();
    probe.resolve(); await vi.advanceTimersByTimeAsync(0); expect(options.publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30); expect(options.probe).toHaveBeenCalledTimes(2); expect(options.publish).toHaveBeenCalledOnce();
    consumer.resolve("done"); await running; expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for a shutdown-racing publish before exact final clear, preventing resurrection", async () => {
    vi.useFakeTimers(); const { options, consumer, controller } = fixture(); const write = deferred<void>();
    options.publish.mockImplementationOnce(() => write.promise);
    const running = runSourceConsumerReadiness(options); await vi.advanceTimersByTimeAsync(0);
    controller.abort(); consumer.resolve("stopped"); await vi.advanceTimersByTimeAsync(100);
    expect(options.clear).toHaveBeenCalledOnce();
    write.resolve(); expect(await running).toBe("stopped"); expect(options.clear).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for an original probe after SIGTERM, never publishes it, and then clears", async () => {
    vi.useFakeTimers(); const { options, consumer, controller } = fixture(); const probe = deferred<void>();
    options.probe.mockImplementationOnce(() => probe.promise);
    const running = runSourceConsumerReadiness(options); await vi.advanceTimersByTimeAsync(0);
    controller.abort(); consumer.resolve("stopped"); await vi.advanceTimersByTimeAsync(100);
    expect(options.clear).toHaveBeenCalledOnce(); expect(options.publish).not.toHaveBeenCalled();
    probe.reject(new Error("private late failure")); expect(await running).toBe("stopped");
    expect(options.clear).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });

  it("consumer failure stops publication and clears before propagating the failure", async () => {
    vi.useFakeTimers(); const { options, consumer } = fixture(); const error = new Error("CONSUMER_FAILED");
    const running = runSourceConsumerReadiness(options); const rejected = expect(running).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(0); consumer.reject(error); await rejected;
    expect(options.clear).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });

  it("notifies consumer rejection synchronously before waiting for its pending probe", async () => {
    vi.useFakeTimers(); const { options, consumer } = fixture(); const probe = deferred<void>();
    const error = new Error("CONSUMER_FAILED"); const onConsumerStopped = vi.fn();
    options.probe.mockImplementationOnce(() => probe.promise);
    const running = runSourceConsumerReadiness({ ...options, onConsumerStopped });
    const rejected = expect(running).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(0); consumer.reject(error); await vi.advanceTimersByTimeAsync(0);
    expect(onConsumerStopped).toHaveBeenCalledOnce(); expect(options.clear).toHaveBeenCalledOnce();
    expect(options.publish).not.toHaveBeenCalled();
    probe.resolve(); await rejected; expect(onConsumerStopped).toHaveBeenCalledOnce();
    expect(options.clear).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });

  it("notifies successful consumer completion exactly once", async () => {
    vi.useFakeTimers(); const { options, consumer } = fixture(); const onConsumerStopped = vi.fn();
    const running = runSourceConsumerReadiness({ ...options, onConsumerStopped });
    await vi.advanceTimersByTimeAsync(0); consumer.resolve("done"); expect(await running).toBe("done");
    expect(onConsumerStopped).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts consumer immediately on timeout-clear failure while still awaiting the original probe", async () => {
    vi.useFakeTimers(); const { options, consumer } = fixture(); const probe = deferred<void>();
    let observed: AbortSignal | undefined;
    options.run = vi.fn((signal?: AbortSignal) => { observed = signal; return consumer.promise; });
    options.probe.mockImplementationOnce(() => probe.promise);
    options.clear.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("private database cause"));
    const running = runSourceConsumerReadiness(options);
    const rejected = expect(running).rejects.toThrow("SOURCE_CONSUMER_HEARTBEAT_CLEAR_FAILED");
    await vi.advanceTimersByTimeAsync(10); expect(observed?.aborted).toBe(true);
    expect(options.probe).toHaveBeenCalledOnce(); expect(options.publish).not.toHaveBeenCalled();
    consumer.resolve("aborted"); probe.resolve(); await rejected; expect(vi.getTimerCount()).toBe(0);
  });

  it("initial clear errors have a fixed code and never start the consumer", async () => {
    const { options } = fixture(); options.clear.mockRejectedValueOnce(new Error("private DB URL"));
    await expect(runSourceConsumerReadiness(options)).rejects.toThrow("SOURCE_CONSUMER_HEARTBEAT_CLEAR_FAILED");
    expect(options.run).not.toHaveBeenCalled(); expect(options.probe).not.toHaveBeenCalled();
  });

  it.each(["publish", "clear"] as const)("%s errors abort the actual consumer and expose only a fixed code", async (method) => {
    vi.useFakeTimers(); const { options } = fixture();
    let received: AbortSignal | undefined;
    options.run = vi.fn((signal?: AbortSignal) => new Promise<string>((resolve) => {
      received = signal; signal?.addEventListener("abort", () => resolve("aborted"), { once: true });
    }));
    options[method].mockRejectedValueOnce(new Error("private database URL"));
    // For clear, let initial startup clear succeed before failing the final clear.
    if (method === "clear") options.clear.mockReset().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("private cause"));
    if (method === "clear") options.probe.mockRejectedValueOnce(new Error("transient probe"));
    const running = runSourceConsumerReadiness(options);
    const rejected = expect(running).rejects.toThrow(method === "publish" ? "SOURCE_CONSUMER_HEARTBEAT_PUBLISH_FAILED" : "SOURCE_CONSUMER_HEARTBEAT_CLEAR_FAILED");
    await vi.advanceTimersByTimeAsync(0); await rejected;
    expect(received?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([9, NaN, Infinity, 1.5, 60_001])("rejects interval bound %s before any callback", async (intervalMs) => {
    const { options } = fixture();
    await expect(runSourceConsumerReadiness({ ...options, intervalMs })).rejects.toThrow("SOURCE_CONSUMER_READINESS_OPTIONS_INVALID");
    expect(options.clear).not.toHaveBeenCalled(); expect(options.run).not.toHaveBeenCalled();
  });
  it.each([9, NaN, Infinity, 1.5, 30_001])("rejects probe bound %s before any callback", async (probeTimeoutMs) => {
    const { options } = fixture();
    await expect(runSourceConsumerReadiness({ ...options, probeTimeoutMs })).rejects.toThrow("SOURCE_CONSUMER_READINESS_OPTIONS_INVALID");
    expect(options.clear).not.toHaveBeenCalled(); expect(options.run).not.toHaveBeenCalled();
  });
});
