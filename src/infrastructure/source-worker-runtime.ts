import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { PgBoss } from "pg-boss";
import { createProjectObjectStorageResolver, type ProjectObjectStorage, type ProjectStorageScope } from "../platform/storage/project-object-storage.ts";
import { createSourceExecutionServer } from "../modules/ingestion-core/server.ts";
import { createSourceJobs, createPrismaSourceJobRepository, drainSourceJobQueue, SOURCE_IMPORT_QUEUE,
  type SourceJobRepository } from "../modules/ingestion-core/worker.ts";
import { getPgBoss, stopPgBoss, createOutboxDrainDependencies, drainOutboxWithDependencies,
  type OutboxDrainDependencies } from "../modules/platform-operations/worker.ts";

export interface SourceWorkerOptions { workerId: string; signal: AbortSignal; pollIntervalMs?: number; shutdownDrainTimeoutMs?: number }
export interface SourceWorkerDependencies {
  boss: Pick<PgBoss, "createQueue" | "fetch" | "complete" | "fail">;
  repository: SourceJobRepository;
  resolveStorage(scope: ProjectStorageScope): ProjectObjectStorage;
  outbox: OutboxDrainDependencies;
}

/** One permanent runtime owns both consumers; no migration or provider provisioning. */
export async function runSourceWorkerWithDependencies(options: SourceWorkerOptions, dependencies: SourceWorkerDependencies) {
  const pollIntervalMs = z.number().int().min(10).max(60_000).parse(options.pollIntervalMs ?? 1_000);
  if (options.signal.aborted) return { fetched: 0, completed: 0, failed: 0 };
  await dependencies.boss.createQueue(SOURCE_IMPORT_QUEUE, { policy: "exclusive", retryLimit: 3, retryDelay: 30,
    retryBackoff: true, retryDelayMax: 900, expireInSeconds: 3_600, deleteAfterSeconds: 86_400 });
  const sourceJobs = createSourceJobs({ repository: dependencies.repository,
    // Schedule reconciliation is owned by MP04.3, never a no-op completion path.
    queue: { reconcileSchedules: async () => { throw new Error("SOURCE_SCHEDULE_RECONCILIATION_NOT_BOUND"); } },
    runImport: async (_principal, target) => {
      const result = await createSourceExecutionServer(dependencies.resolveStorage({ organizationId: target.organizationId,
        projectId: target.projectId })).run(target);
      if (result.state !== "GOOD") throw new Error(result.code);
      return result;
    } });
  const totals = { fetched: 0, completed: 0, failed: 0 };
  while (!options.signal.aborted) {
    const outbox = await drainOutboxWithDependencies({ workerId: options.workerId, signal: options.signal,
      ...(options.shutdownDrainTimeoutMs === undefined ? {} : { shutdownDrainTimeoutMs: options.shutdownDrainTimeoutMs }) }, dependencies.outbox);
    if (options.signal.aborted) break;
    const source = await drainSourceJobQueue(dependencies.boss, sourceJobs, 1);
    totals.fetched += source.fetched; totals.completed += source.completed; totals.failed += source.failed;
    if (!options.signal.aborted && source.fetched === 0 && outbox.claimed === 0) {
      try { await delay(pollIntervalMs, undefined, { signal: options.signal }); }
      catch (error) { if (!options.signal.aborted) throw error; }
    }
  }
  return totals;
}

export async function runSourceWorker(options: SourceWorkerOptions) {
  // Reject missing bindings before opening a queue or attempting any intake.
  const resolveStorage = createProjectObjectStorageResolver();
  const boss = await getPgBoss();
  try { return await runSourceWorkerWithDependencies(options, { boss, resolveStorage,
    repository: createPrismaSourceJobRepository(), outbox: createOutboxDrainDependencies(boss) }); }
  finally { await stopPgBoss(); }
}
