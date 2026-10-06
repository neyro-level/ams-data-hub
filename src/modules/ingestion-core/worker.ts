export { createSourceJobs, SOURCE_JOB_NAME, type SourceJobDependencies } from "./application/source-jobs.ts";
export { createPrismaSourceManualRequests, dispatchSourceManualRequest, sourceManualJobId, settleTerminalSourceManualRequests } from "./infrastructure/source-manual-worker.ts";
export { SOURCE_MANUAL_REQUEST_TOPIC } from "./domain/source-jobs.ts";
export { deferSourceImportJob } from "./infrastructure/source-job-deferral.ts";
import type { ProjectJobPrincipal } from "../../platform/authorization/principal.ts";
import type { PgBoss, JobWithMetadata } from "pg-boss";
import {
  runInPrincipalDatabaseTransaction,
  runInSystemJobDatabaseTransaction,
} from "../../platform/database/transaction.ts";
import type { SourceJobRepository } from "./application/ports/source-job-repository.ts";
import type {
  SourceImportJobHandler,
  SourceJobRunResult,
} from "./application/ports/source-job-queue.ts";
import { PrismaSourceJobRepository } from "./infrastructure/prisma-source-job-repository.ts";
import {
  SOURCE_IMPORT_QUEUE,
  sourceImportJobSchema,
  type SourceImportJob,
} from "./domain/source-jobs.ts";

export type SourceJobWorkerBoss = Pick<PgBoss, "fetch" | "complete" | "fail">;

export interface SourceJobDrainResult {
  fetched: number;
  completed: number;
  blocked: number;
  skipped: number;
  failed: number;
  deferred: number;
}

export async function drainSourceJobQueue(
  boss: SourceJobWorkerBoss,
  handler: SourceImportJobHandler,
  maxJobs = 10,
  defer?: (job: JobWithMetadata<SourceImportJob>, reason: "SOURCE_EXECUTION_BUSY" | "WORKER_SHUTDOWN") => Promise<void>,
  signal?: AbortSignal,
): Promise<SourceJobDrainResult> {
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 100) {
    throw new Error("SOURCE_JOB_BATCH_INVALID");
  }
  const jobs = signal?.aborted ? [] : await boss.fetch<SourceImportJob>(SOURCE_IMPORT_QUEUE, {
    batchSize: maxJobs,
    includeMetadata: true,
  });
  const result: SourceJobDrainResult = {
    fetched: jobs.length,
    completed: 0,
    blocked: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
  };

  for (const job of jobs) {
    const parsed = sourceImportJobSchema.safeParse(job.data);
    if (!parsed.success) {
      await boss.complete(SOURCE_IMPORT_QUEUE, job.id, {
        status: "SKIPPED",
        reason: "INVALID_SOURCE_JOB",
      });
      result.skipped += 1;
      continue;
    }
    let contention = false;
    try {
      const outcome: SourceJobRunResult = signal?.aborted ? { status: "DEFERRED", reason: "WORKER_SHUTDOWN" } : await handler.run(parsed.data);
      if (outcome.status === "DEFERRED") {
        contention = true;
        if (!defer) throw new Error("SOURCE_JOB_DEFERRAL_UNBOUND");
        await defer(job, outcome.reason);
        result.deferred += 1;
        continue;
      }
      await boss.complete(SOURCE_IMPORT_QUEUE, job.id, outcome);
      if (outcome.status === "COMPLETED") result.completed += 1;
      if (outcome.status === "BLOCKED") result.blocked += 1;
      if (outcome.status === "SKIPPED") result.skipped += 1;
    } catch (error) {
      if (contention) throw new Error("SOURCE_JOB_DEFERRAL_FAILED");
      const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,100}$/u.test(error.message)
        ? error.message
        : "SOURCE_JOB_FAILED";
      await handler.onFailure?.(parsed.data, Number.isInteger(job.retryCount) && Number.isInteger(job.retryLimit) && job.retryCount >= job.retryLimit);
      await boss.fail(SOURCE_IMPORT_QUEUE, job.id, { status: "FAILED", code });
      result.failed += 1;
    }
  }
  return result;
}

export function createPrismaSourceJobRepository(): SourceJobRepository {
  return {
    listSchedulingSources: () =>
      runInSystemJobDatabaseTransaction(
        {
          jobName: "source-schedule-reconcile",
          correlationId: `source-schedule-${Date.now()}`,
        },
        (transaction) =>
          new PrismaSourceJobRepository(transaction).listSchedulingSources(),
      ),
    loadExecutionContext: (principal: ProjectJobPrincipal, sourceId: string) =>
      runInPrincipalDatabaseTransaction(principal, (transaction) =>
        new PrismaSourceJobRepository(transaction).loadExecutionContext(principal, sourceId),
      ),
  };
}

export {
  PgBossSourceJobQueue,
  type SourceScheduleBoss,
} from "./infrastructure/pg-boss-source-job-queue.ts";
export { PrismaSourceJobRepository } from "./infrastructure/prisma-source-job-repository.ts";
export {
  SOURCE_IMPORT_JOB_SCHEMA_VERSION,
  SOURCE_IMPORT_QUEUE,
  SOURCE_SCHEDULE_CRON,
  sourceImportJobSchema,
  sourceJobKey,
  type SourceImportJob,
} from "./domain/source-jobs.ts";
export type {
  SourceImportJobHandler,
  SourceJobQueue,
  SourceJobRunResult,
} from "./application/ports/source-job-queue.ts";
export type {
  SourceJobExecutionContext,
  SourceJobRecord,
  SourceJobRepository,
  SourceManualRequestRepository,
} from "./application/ports/source-job-repository.ts";
