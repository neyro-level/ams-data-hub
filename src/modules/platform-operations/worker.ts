import { z } from "zod";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import { getWorkerReliabilityService } from "../../infrastructure/worker-service-container.ts";
import {
  OUTBOX_DELIVERY_QUEUE,
  OUTBOX_HANDLER_MAX_ATTEMPTS,
  OUTBOX_RETRY_DELAY_MAX_SECONDS,
  OUTBOX_RETRY_DELAY_SECONDS,
  outboxDispatchJobSchema,
  type OutboxDispatchJob,
} from "./domain/pg-boss.ts";
import { getPgBoss, stopPgBoss } from "./infrastructure/pg-boss-client.ts";
import { runReliabilityRetention } from "./infrastructure/retention-runtime.ts";
import type { ClaimedReliabilityEvent } from "./application/ports/reliability-repository.ts";
import {
  OUTBOX_WORKER_RUNTIME,
  recordRuntimeHeartbeat,
} from "./infrastructure/runtime-heartbeat.ts";

type ReliabilityWorker = Pick<
  ReturnType<typeof getWorkerReliabilityService>,
  "claim" | "takeOver" | "complete" | "fail"
>;
type OutboxQueueClient = Pick<PgBoss, "send" | "fetch" | "complete">;

export interface OutboxDrainDependencies {
  boss: OutboxQueueClient;
  reliability: ReliabilityWorker;
  heartbeat: (workerId: string) => Promise<unknown>;
  handle?: (event: ClaimedReliabilityEvent, signal?: AbortSignal) => Promise<void>;
}

function outboxError(code: string, retryable: boolean) {
  return Object.assign(new Error(code), { code, retryable });
}

function nextAvailableDelaySeconds(attempt: number) {
  return Math.min(
    OUTBOX_RETRY_DELAY_MAX_SECONDS,
    OUTBOX_RETRY_DELAY_SECONDS * 2 ** Math.max(0, attempt - 1),
  );
}

export async function publishClaimedEvent(
  boss: OutboxQueueClient,
  event: ClaimedReliabilityEvent,
) {
  return boss.send(
    OUTBOX_DELIVERY_QUEUE,
    {
      schemaVersion: 1,
      event,
    } satisfies OutboxDispatchJob,
    { singletonKey: event.outboxEventId },
  );
}

async function fetchQueuedJob(boss: OutboxQueueClient) {
  const jobs = await boss.fetch<OutboxDispatchJob>(OUTBOX_DELIVERY_QUEUE, {
    batchSize: 1,
    includeMetadata: true,
  });
  return jobs[0] ?? null;
}

async function handleEvent(event: ClaimedReliabilityEvent) {
  if (event.topic === "platform.maintenance.requested") {
    return;
  }

  throw outboxError("UNKNOWN_OUTBOX_TOPIC", false);
}

async function processQueuedJob(
  boss: OutboxQueueClient,
  job: JobWithMetadata<OutboxDispatchJob>,
  workerId: string,
  reliability: ReliabilityWorker,
  eventHandler: (event: ClaimedReliabilityEvent, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
  shutdownDrainTimeoutMs = 30_000,
) {
  const parsed = outboxDispatchJobSchema.safeParse(job.data);
  if (!parsed.success) {
    await boss.complete(OUTBOX_DELIVERY_QUEUE, job.id, {
      status: "ignored",
      code: "INVALID_OUTBOX_JOB",
    });
    return { claimed: 0, completed: 0, failed: 1 };
  }

  const event = await reliability.takeOver(parsed.data.event, workerId);
  if (!event) {
    await boss.complete(OUTBOX_DELIVERY_QUEUE, job.id, {
      status: "ignored",
      code: "OUTBOX_ALREADY_SETTLED",
    });
    return { claimed: 0, completed: 0, failed: 0 };
  }

  try {
    await withShutdownDeadline(
      eventHandler(event, signal),
      signal,
      shutdownDrainTimeoutMs,
    );
    await reliability.complete(event);
    await boss.complete(OUTBOX_DELIVERY_QUEUE, job.id, { status: "success" });
    return { claimed: 1, completed: 1, failed: 0 };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "OUTBOX_HANDLER_FAILED";
    const retryable = Boolean(
      error && typeof error === "object" && "retryable" in error && error.retryable,
    );
    const failure = await reliability.fail(
      event,
      code,
      retryable,
      OUTBOX_HANDLER_MAX_ATTEMPTS,
    );
    await boss.complete(OUTBOX_DELIVERY_QUEUE, job.id, {
      status: failure.status,
      code,
      retryable,
      nextAvailableInSeconds:
        failure.status === "pending" ? nextAvailableDelaySeconds(event.attempt) : null,
    });
    return { claimed: 1, completed: 0, failed: 1 };
  }
}

export interface DrainOutboxOptions {
  workerId: string;
  maxEvents?: number;
  signal?: AbortSignal;
  shutdownDrainTimeoutMs?: number;
}

export interface DrainOutboxResult {
  claimed: number;
  completed: number;
  failed: number;
}

export interface RunOutboxWorkerOptions extends DrainOutboxOptions {
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

function waitForNextCycle(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = setTimeout(finish, delayMs);

    function finish() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", finish);
      resolve();
    }

    signal?.addEventListener("abort", finish, { once: true });
  });
}

function withShutdownDeadline<T>(
  task: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  if (!signal) return task;

  return new Promise<T>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      signal.removeEventListener("abort", startDeadline);
    };
    const startDeadline = () => {
      timeout ??= setTimeout(() => {
        cleanup();
        reject(outboxError("WORKER_SHUTDOWN_TIMEOUT", true));
      }, timeoutMs);
    };

    signal.addEventListener("abort", startDeadline, { once: true });
    if (signal.aborted) startDeadline();
    task.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export async function drainOutboxWithDependencies(
  options: DrainOutboxOptions,
  dependencies: OutboxDrainDependencies,
): Promise<DrainOutboxResult> {
  const { boss, reliability } = dependencies;
  const eventHandler = dependencies.handle ?? handleEvent;
  const maxEvents = z.number().int().min(1).max(100).parse(options.maxEvents ?? 25);
  const shutdownDrainTimeoutMs = z.number().int().min(10).max(300_000).parse(
    options.shutdownDrainTimeoutMs ?? 30_000,
  );
  const result: DrainOutboxResult = { claimed: 0, completed: 0, failed: 0 };

  await dependencies.heartbeat(options.workerId);

  let handled = 0;
  while (handled < maxEvents && !options.signal?.aborted) {
    const queued = await fetchQueuedJob(boss);
    if (!queued) {
      break;
    }
    const settled = await processQueuedJob(
      boss,
      queued,
      options.workerId,
      reliability,
      eventHandler,
      options.signal,
      shutdownDrainTimeoutMs,
    );
    result.claimed += settled.claimed;
    result.completed += settled.completed;
    result.failed += settled.failed;
    handled += 1;
    await dependencies.heartbeat(options.workerId);
  }

  while (handled < maxEvents && !options.signal?.aborted) {
    const claimed = await reliability.claim(options.workerId);
    if (!claimed) {
      break;
    }
    handled += 1;
    result.claimed += 1;

    try {
      await publishClaimedEvent(boss, claimed);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : "OUTBOX_DISPATCH_FAILED";
      await reliability.fail(claimed, code, true, OUTBOX_HANDLER_MAX_ATTEMPTS);
      result.failed += 1;
    }
    await dependencies.heartbeat(options.workerId);
  }

  return result;
}

export async function drainOutbox(options: DrainOutboxOptions): Promise<DrainOutboxResult> {
  const boss = await getPgBoss();
  try {
    return await drainOutboxWithDependencies(options, {
      boss,
      reliability: getWorkerReliabilityService(),
      heartbeat: (workerId) =>
        recordRuntimeHeartbeat({ runtime: OUTBOX_WORKER_RUNTIME, workerId }),
    });
  } finally {
    await stopPgBoss();
  }
}

export async function runOutboxWorkerWithDependencies(
  options: RunOutboxWorkerOptions,
  dependencies: OutboxDrainDependencies,
): Promise<DrainOutboxResult> {
  const pollIntervalMs = z.number().int().min(10).max(60_000).parse(
    options.pollIntervalMs ?? 1_000,
  );
  const totals: DrainOutboxResult = { claimed: 0, completed: 0, failed: 0 };

  while (!options.signal?.aborted) {
    const cycle = await drainOutboxWithDependencies(options, dependencies);
    totals.claimed += cycle.claimed;
    totals.completed += cycle.completed;
    totals.failed += cycle.failed;

    if (options.signal?.aborted) break;
    if (cycle.claimed === 0) {
      await waitForNextCycle(pollIntervalMs, options.signal);
    }
  }

  return totals;
}

export async function runOutboxWorker(
  options: RunOutboxWorkerOptions,
): Promise<DrainOutboxResult> {
  const boss = await getPgBoss();
  try {
    return await runOutboxWorkerWithDependencies(options, {
      boss,
      reliability: getWorkerReliabilityService(),
      heartbeat: (workerId) =>
        recordRuntimeHeartbeat({ runtime: OUTBOX_WORKER_RUNTIME, workerId }),
    });
  } finally {
    await stopPgBoss();
  }
}

export { runReliabilityRetention };
