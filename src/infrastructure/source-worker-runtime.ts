import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { PgBoss, JobWithMetadata } from "pg-boss";
import { createProjectObjectStorageResolver, type ProjectObjectStorage, type ProjectStorageScope } from "../platform/storage/project-object-storage.ts";
import { createSourceExecutionServer } from "../modules/ingestion-core/server.ts";
import { createSourceJobs, createPrismaSourceJobRepository, drainSourceJobQueue, PgBossSourceJobQueue,
  createPrismaSourceManualRequests, dispatchSourceManualRequest, settleTerminalSourceManualRequests, SOURCE_MANUAL_REQUEST_TOPIC,
  deferSourceImportJob, type SourceJobRepository, type SourceManualRequestRepository, type SourceImportJob } from "../modules/ingestion-core/worker.ts";
import { getPgBoss, stopPgBoss, createOutboxDrainDependencies, drainOutboxWithDependencies,
  handleDefaultOutboxEvent, listDeadLetterOutboxEvents, type OutboxDrainDependencies } from "../modules/platform-operations/worker.ts";

export interface SourceWorkerOptions { workerId: string; signal: AbortSignal; pollIntervalMs?: number; shutdownDrainTimeoutMs?: number }
export interface SourceWorkerDependencies {
  boss: Pick<PgBoss, "createQueue" | "fetch" | "complete" | "fail" | "schedule" | "unschedule" | "getSchedules">;
  repository: SourceJobRepository;
  manualRequests?: SourceManualRequestRepository;
  reconcileTerminalRequests?(): Promise<void>;
  deferSourceJob?(job: JobWithMetadata<SourceImportJob>, reason: "SOURCE_EXECUTION_BUSY" | "WORKER_SHUTDOWN"): Promise<void>;
  resolveStorage(scope: ProjectStorageScope): ProjectObjectStorage;
  outbox: OutboxDrainDependencies;
}

/** One permanent runtime owns both consumers; no migration or provider provisioning. */
export async function runSourceWorkerWithDependencies(options: SourceWorkerOptions, dependencies: SourceWorkerDependencies) {
  const pollIntervalMs = z.number().int().min(10).max(60_000).parse(options.pollIntervalMs ?? 1_000);
  if (options.signal.aborted) return { fetched: 0, completed: 0, failed: 0 };
  const sourceJobs = createSourceJobs({ repository: dependencies.repository,
    ...(dependencies.manualRequests ? { manualRequests: dependencies.manualRequests } : {}),
    queue: new PgBossSourceJobQueue(dependencies.boss),
    runImport: async (_principal, target, job) => {
      return createSourceExecutionServer(dependencies.resolveStorage({ organizationId: target.organizationId,
        projectId: target.projectId }), { signal: options.signal, ...(job.manualRequestId ? { manualRequestId: job.manualRequestId } : {}) }).run(target);
    } });
  const totals = { fetched: 0, completed: 0, failed: 0 };
  await sourceJobs.reconcileSchedules();
  await dependencies.reconcileTerminalRequests?.();
  let nextReconcileAt = Date.now() + 60_000;
  while (!options.signal.aborted) {
    if (Date.now() >= nextReconcileAt) {
      await sourceJobs.reconcileSchedules();
      await dependencies.reconcileTerminalRequests?.();
      nextReconcileAt = Date.now() + 60_000;
    }
    const outbox = await drainOutboxWithDependencies({ workerId: options.workerId, signal: options.signal,
      ...(options.shutdownDrainTimeoutMs === undefined ? {} : { shutdownDrainTimeoutMs: options.shutdownDrainTimeoutMs }) }, dependencies.outbox);
    if (options.signal.aborted) break;
    const source = await drainSourceJobQueue(dependencies.boss, sourceJobs, 1, dependencies.deferSourceJob, options.signal);
    totals.fetched += source.fetched; totals.completed += source.completed; totals.failed += source.failed;
    if (!options.signal.aborted && source.fetched === 0 && outbox.claimed === 0) {
      try { await delay(pollIntervalMs, undefined, { signal: options.signal }); }
      catch (error) { if (!options.signal.aborted) throw error; }
    }
  }
  return totals;
}

export async function runSourceWorker(options: SourceWorkerOptions) {
  if (options.signal.aborted) return { fetched: 0, completed: 0, failed: 0 };
  // Reject missing bindings before opening a queue or attempting any intake.
  const resolveStorage = createProjectObjectStorageResolver();
  const boss = await getPgBoss();
  let terminalCursor = "";
  try { return await runSourceWorkerWithDependencies(options, { boss, resolveStorage,
    deferSourceJob: (job, reason) => deferSourceImportJob(boss, job, reason),
    repository: createPrismaSourceJobRepository(), manualRequests: createPrismaSourceManualRequests(),
    reconcileTerminalRequests: async () => {
      const events = await listDeadLetterOutboxEvents(SOURCE_MANUAL_REQUEST_TOPIC, terminalCursor);
      await settleTerminalSourceManualRequests(events);
      terminalCursor = events.length === 100 ? events.at(-1)!.id : "";
    },
    outbox: { ...createOutboxDrainDependencies(boss), topics: ["platform.maintenance.requested", SOURCE_MANUAL_REQUEST_TOPIC],
      handle: (event) => event.topic === SOURCE_MANUAL_REQUEST_TOPIC ? dispatchSourceManualRequest(boss, event) : handleDefaultOutboxEvent(event) } }); }
  finally { await stopPgBoss(); }
}
