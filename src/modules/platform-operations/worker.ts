import { z } from "zod";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import { getWorkerReliabilityService } from "../../infrastructure/worker-service-container.ts";
import { createJobPrincipal } from "../../platform/authorization/principal-factories.ts";
import { syncProjectToDatabase } from "../data-ingestion/worker.ts";
import { setupSiteIntegrations, syncSiteCompetitors } from "../data-ingestion/worker.ts";
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

const projectSyncPayloadSchema = z.object({
  projectSlug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  trigger: z.enum(["daily", "manual", "preflight", "backfill"]).default("manual"),
});
const siteTaskPayloadSchema = z.object({ siteId: z.string().trim().min(1) });

type ReliabilityWorker = Pick<
  ReturnType<typeof getWorkerReliabilityService>,
  "claim" | "takeOver" | "complete" | "fail"
>;
type OutboxQueueClient = Pick<PgBoss, "send" | "fetch" | "complete">;

export interface OutboxDrainDependencies {
  boss: OutboxQueueClient;
  reliability: ReliabilityWorker;
  heartbeat: (workerId: string) => Promise<unknown>;
  handle?: (event: ClaimedReliabilityEvent) => Promise<void>;
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

async function handleProjectSync(event: ClaimedReliabilityEvent) {
  const payload = projectSyncPayloadSchema.safeParse(event.payload);
  if (!payload.success) {
    throw outboxError("INVALID_OUTBOX_PAYLOAD", false);
  }
  if (!event.organizationId) {
    throw outboxError("PROJECT_SYNC_MISSING_ORGANIZATION", false);
  }

  const principal = createJobPrincipal({
    jobName: event.topic,
    organizationId: event.organizationId,
    correlationId: event.correlationId,
  });
  if (principal.kind !== "job") {
    throw outboxError("PROJECT_SYNC_INVALID_SCOPE", false);
  }
  const result = await syncProjectToDatabase({
    projectSlug: payload.data.projectSlug,
    trigger: payload.data.trigger,
    env: process.env,
    correlationId: principal.correlationId,
    expectedOrganizationId: principal.organizationId,
  });
  if (result.status === "failed") {
    throw outboxError("PROJECT_SYNC_FAILED", true);
  }
}

async function handleEvent(event: ClaimedReliabilityEvent) {
  if (event.topic === "project.sync.requested") {
    await handleProjectSync(event);
    return;
  }
  if (event.topic === "site.integrations.setup.requested" || event.topic === "site.competitors.sync.requested") {
    const payload = siteTaskPayloadSchema.safeParse(event.payload);
    if (!payload.success || !event.organizationId) throw outboxError("INVALID_SITE_TASK_PAYLOAD", false);
    const task = { organizationId: event.organizationId, siteId: payload.data.siteId, correlationId: event.correlationId };
    if (event.topic === "site.integrations.setup.requested") await setupSiteIntegrations(task);
    else await syncSiteCompetitors(task);
    return;
  }

  throw outboxError("UNKNOWN_OUTBOX_TOPIC", false);
}

async function processQueuedJob(
  boss: OutboxQueueClient,
  job: JobWithMetadata<OutboxDispatchJob>,
  workerId: string,
  reliability: ReliabilityWorker,
  eventHandler: (event: ClaimedReliabilityEvent) => Promise<void>,
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
    await eventHandler(event);
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
}

export interface DrainOutboxResult {
  claimed: number;
  completed: number;
  failed: number;
}

export async function drainOutboxWithDependencies(
  options: DrainOutboxOptions,
  dependencies: OutboxDrainDependencies,
): Promise<DrainOutboxResult> {
  const { boss, reliability } = dependencies;
  const eventHandler = dependencies.handle ?? handleEvent;
  const maxEvents = z.number().int().min(1).max(100).parse(options.maxEvents ?? 25);
  const result: DrainOutboxResult = { claimed: 0, completed: 0, failed: 0 };

  await dependencies.heartbeat(options.workerId);

  let handled = 0;
  while (handled < maxEvents) {
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
    );
    result.claimed += settled.claimed;
    result.completed += settled.completed;
    result.failed += settled.failed;
    handled += 1;
    await dependencies.heartbeat(options.workerId);
  }

  while (handled < maxEvents) {
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

export { runReliabilityRetention };
