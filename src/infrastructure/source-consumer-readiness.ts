import "server-only";

export interface SourceConsumerReadinessOptions<T> {
  signal: AbortSignal;
  run(signal: AbortSignal): Promise<T>;
  probe(): Promise<void>;
  publish(): Promise<void>;
  clear(): Promise<void>;
  /** Trusted process owner starts its cleanup watchdog before awaiting the pump. */
  onConsumerStopped?(): void;
  intervalMs?: number;
  probeTimeoutMs?: number;
}

function bounded(value: number, maximum: number): number {
  if (!Number.isInteger(value) || value < 10 || value > maximum) {
    throw new Error("SOURCE_CONSUMER_READINESS_OPTIONS_INVALID");
  }
  return value;
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Call only after startup reconciliation. The callbacks own exact-owner DB
 * scope. A timed-out probe is never replaced until its original promise settles;
 * the process lifecycle deadline bounds a permanently stalled cleanup. */
export async function runSourceConsumerReadiness<T>(options: SourceConsumerReadinessOptions<T>): Promise<T> {
  const intervalMs = bounded(options.intervalMs ?? 30_000, 60_000);
  const probeTimeoutMs = bounded(options.probeTimeoutMs ?? 5_000, 30_000);
  const consumerAbort = new AbortController();
  const pumpStop = new AbortController();
  const stop = () => pumpStop.abort();
  const signal = AbortSignal.any([options.signal, consumerAbort.signal]);
  let failure: Error | undefined;
  const fail = (code: string) => {
    failure ??= new Error(code);
    consumerAbort.abort();
    stop();
  };
  const clear = async () => {
    try { await options.clear(); }
    catch { throw new Error("SOURCE_CONSUMER_HEARTBEAT_CLEAR_FAILED"); }
  };
  // No previous incarnation's owner row may qualify this consumer's startup.
  await clear();
  options.signal.addEventListener("abort", stop, { once: true });
  if (options.signal.aborted) stop();
  const consumerStopped = () => {
    try { options.onConsumerStopped?.(); }
    catch { fail("SOURCE_CONSUMER_STOP_HOOK_FAILED"); }
    stop();
  };
  const consumer = Promise.resolve().then(() => options.run(signal)).then(
    (value) => { consumerStopped(); return { ok: true as const, value }; },
    (error: unknown) => { consumerStopped(); return { ok: false as const, error }; },
  );
  const pump = (async () => {
    try {
      while (!pumpStop.signal.aborted) {
        // Normalize rejection immediately: even late/aborted probes never
        // produce an unhandled rejection or trigger a late publication.
        const original = Promise.resolve().then(options.probe).then(
          () => "success" as const, () => "failed" as const,
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort: (() => void) | undefined;
        let outcome: "success" | "failed" | "timeout" | "stopped";
        try {
          outcome = await Promise.race([original, new Promise<"timeout" | "stopped">((resolve) => {
            abort = () => resolve("stopped");
            timer = setTimeout(() => resolve("timeout"), probeTimeoutMs);
            pumpStop.signal.addEventListener("abort", abort, { once: true });
            if (pumpStop.signal.aborted) abort();
          })]);
        } finally {
          clearTimeout(timer);
          if (abort) pumpStop.signal.removeEventListener("abort", abort);
        }
        if (outcome === "timeout" || outcome === "failed") {
          // Revoke qualification now, before waiting on the original timeout.
          try { await clear(); }
          catch (error) { fail("SOURCE_CONSUMER_HEARTBEAT_CLEAR_FAILED"); throw error; }
          finally { await original; }
        } else if (outcome === "stopped") {
          await original;
        } else if (!pumpStop.signal.aborted && !signal.aborted) {
          try { await options.publish(); }
          catch { throw new Error("SOURCE_CONSUMER_HEARTBEAT_PUBLISH_FAILED"); }
          // Shutdown may race a DB write. Final clear runs only after that
          // write settles, so there is no delete-then-late-write resurrection.
          if (signal.aborted) stop();
        }
        if (!pumpStop.signal.aborted) await pause(intervalMs, pumpStop.signal);
      }
    } catch (error) {
      fail(error instanceof Error && error.message === "SOURCE_CONSUMER_HEARTBEAT_CLEAR_FAILED"
        ? error.message : "SOURCE_CONSUMER_HEARTBEAT_PUBLISH_FAILED");
    } finally {
      try { await clear(); }
      catch { fail("SOURCE_CONSUMER_HEARTBEAT_CLEAR_FAILED"); }
    }
  })();
  try {
    await pump;
    const result = await consumer;
    if (failure) throw failure;
    if (!result.ok) throw result.error;
    return result.value;
  } finally {
    options.signal.removeEventListener("abort", stop);
  }
}
