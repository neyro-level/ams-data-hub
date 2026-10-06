import "server-only";

interface WorkerSignalSource {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  removeListener(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

/** The deadline covers active work, durable settlement and all owned cleanup.
 * onTimeout is a process-fatal boundary, never a fake successful drain. */
export async function runWorkerProcessLifecycle<T>(options: {
  signals: WorkerSignalSource;
  shutdownTimeoutMs: number;
  run(signal: AbortSignal, requestShutdown: () => void): Promise<T>;
  close(): Promise<void>;
  onTimeout(): void;
}): Promise<T> {
  if (!Number.isInteger(options.shutdownTimeoutMs) || options.shutdownTimeoutMs < 10 || options.shutdownTimeoutMs > 300_000) {
    throw new Error("WORKER_SHUTDOWN_DEADLINE_INVALID");
  }
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    timeout ??= setTimeout(options.onTimeout, options.shutdownTimeoutMs);
    controller.abort();
  };
  options.signals.once("SIGINT", stop); options.signals.once("SIGTERM", stop);
  try { return await options.run(controller.signal, stop); }
  finally {
    timeout ??= setTimeout(options.onTimeout, options.shutdownTimeoutMs);
    try { await options.close(); }
    finally {
      clearTimeout(timeout);
      options.signals.removeListener("SIGINT", stop); options.signals.removeListener("SIGTERM", stop);
    }
  }
}
