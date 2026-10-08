import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { PgBoss, JobWithMetadata } from "pg-boss";
import { runSourceConsumerReadiness } from "./source-consumer-readiness.ts";
import { createSnapshotBuildCapability, createOperationalSnapshotBuildCapability, createOperationalSnapshotPublishCapability, createOperationalSnapshotRollbackCapability } from "./snapshot-build-capability.ts";
import { SNAPSHOT_BUILD_REQUEST_TOPIC } from "../modules/snapshot-delivery/contracts.ts";
import { OPERATIONAL_EXECUTOR_TOPICS, handleOperationalOutboxEvent, settleTerminalOperationalRequests } from "../modules/operations-control/worker.ts";
import { OPERATIONAL_ACTION_TOPICS } from "../modules/operations-control/index.ts";
import { createProjectObjectStorageResolver, type ProjectObjectStorage, type ProjectStorageScope } from "../platform/storage/project-object-storage.ts";
import { createSourceExecutionServer } from "../modules/ingestion-core/server.ts";
import { createSourceJobs, createPrismaSourceJobRepository, drainSourceJobQueue, PgBossSourceJobQueue,
  createPrismaSourceManualRequests, dispatchSourceManualRequest, settleTerminalSourceManualRequests, SOURCE_MANUAL_REQUEST_TOPIC,
  deferSourceImportJob, SOURCE_IMPORT_QUEUE, type SourceJobRepository, type SourceManualRequestRepository, type SourceImportJob } from "../modules/ingestion-core/worker.ts";
import { getPgBoss, stopPgBoss, createOutboxDrainDependencies, drainOutboxWithDependencies,
  handleDefaultOutboxEvent, listDeadLetterOutboxEvents, recordSourceWorkerHeartbeat, clearSourceWorkerHeartbeat,
  assertSourceWorkerId, type OutboxDrainDependencies } from "../modules/platform-operations/worker.ts";

export interface SourceWorkerOptions { workerId: string; signal: AbortSignal; pollIntervalMs?: number; shutdownDrainTimeoutMs?: number; onConsumerStopped?(): void }
export interface SourceWorkerDependencies {
  boss: Pick<PgBoss, "createQueue" | "fetch" | "complete" | "fail" | "schedule" | "unschedule" | "getSchedules">;
  repository: SourceJobRepository;
  manualRequests?: SourceManualRequestRepository;
  reconcileTerminalRequests?(): Promise<void>;
  deferSourceJob?(job: JobWithMetadata<SourceImportJob>, reason: "SOURCE_EXECUTION_BUSY" | "WORKER_SHUTDOWN"): Promise<void>;
  resolveStorage(scope: ProjectStorageScope): ProjectObjectStorage;
  outbox: OutboxDrainDependencies;
  readiness?: { probe(): Promise<void>; publish(): Promise<void>; clear(): Promise<void> };
}

/** One permanent runtime owns both consumers; no migration or provider provisioning. */
export async function runSourceWorkerWithDependencies(options: SourceWorkerOptions, dependencies: SourceWorkerDependencies) {
  const pollIntervalMs = z.number().int().min(10).max(60_000).parse(options.pollIntervalMs ?? 1_000);
  if (options.signal.aborted) return { fetched: 0, completed: 0, failed: 0 };
  // Rebound once to the owned readiness/consumer signal before polling begins.
  let consumerSignal = options.signal;
  const sourceJobs = createSourceJobs({ repository: dependencies.repository,
    ...(dependencies.manualRequests ? { manualRequests: dependencies.manualRequests } : {}),
    queue: new PgBossSourceJobQueue(dependencies.boss),
    runImport: async (_principal, target, job) => {
      return createSourceExecutionServer(dependencies.resolveStorage({ organizationId: target.organizationId,
        projectId: target.projectId }), { signal: consumerSignal, ...(job.manualRequestId ? { manualRequestId: job.manualRequestId } : {}) }).run(target);
    } });
  const totals = { fetched: 0, completed: 0, failed: 0 };
  await sourceJobs.reconcileSchedules();
  await dependencies.reconcileTerminalRequests?.();
  const consume = async (signal: AbortSignal) => {
    consumerSignal = signal;
    let nextReconcileAt = Date.now() + 60_000;
    while (!signal.aborted) {
      if (Date.now() >= nextReconcileAt) {
        await sourceJobs.reconcileSchedules();
        await dependencies.reconcileTerminalRequests?.();
        nextReconcileAt = Date.now() + 60_000;
      }
      const outbox = await drainOutboxWithDependencies({ workerId: options.workerId, signal,
        ...(options.shutdownDrainTimeoutMs === undefined ? {} : { shutdownDrainTimeoutMs: options.shutdownDrainTimeoutMs }) }, dependencies.outbox);
      if (signal.aborted) break;
      const source = await drainSourceJobQueue(dependencies.boss, sourceJobs, 1, dependencies.deferSourceJob, signal);
      totals.fetched += source.fetched; totals.completed += source.completed; totals.failed += source.failed;
      if (!signal.aborted && source.fetched === 0 && outbox.claimed === 0) {
        try { await delay(pollIntervalMs, undefined, { signal }); }
        catch (error) { if (!signal.aborted) throw error; }
      }
    }
    return totals;
  };
  return dependencies.readiness ? runSourceConsumerReadiness({ signal: options.signal, run: consume,
    ...(options.onConsumerStopped ? { onConsumerStopped: options.onConsumerStopped } : {}), ...dependencies.readiness }) : consume(options.signal);
}

export async function runSourceWorker(options: SourceWorkerOptions) {
  if (options.signal.aborted) return { fetched: 0, completed: 0, failed: 0 };
  assertSourceWorkerId(options.workerId);
  // Revoke a crashed incarnation even if the new startup configuration is invalid.
  try { await clearSourceWorkerHeartbeat(options.workerId); } catch { throw new Error("SOURCE_READINESS_CLEAR_FAILED"); }
  // Reject missing bindings before opening a queue or attempting any intake.
  const resolveStorage = createProjectObjectStorageResolver();
  const snapshotBuild = createSnapshotBuildCapability(resolveStorage);
  const operationalBuild = createOperationalSnapshotBuildCapability(resolveStorage);
  const operationalPublish = createOperationalSnapshotPublishCapability(resolveStorage);
  const operationalRollback = createOperationalSnapshotRollbackCapability(resolveStorage);
  const operationalTopics = [...OPERATIONAL_EXECUTOR_TOPICS, ...(operationalBuild ? [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD] : []),
    ...(operationalPublish ? [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_PUBLISH] : []),
    ...(operationalRollback ? [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_ROLLBACK] : [])];
  const boss = await getPgBoss();
  let terminalCursor = "";
  const operationalTerminalCursors = new Map<string, string>();
  try { return await runSourceWorkerWithDependencies(options, { boss, resolveStorage,
    readiness: {
      probe: async () => { if (!await boss.getQueue(SOURCE_IMPORT_QUEUE)) throw new Error("SOURCE_QUEUE_NOT_READY"); },
      publish: async () => { try { await recordSourceWorkerHeartbeat(options.workerId); } catch { throw new Error("SOURCE_READINESS_WRITE_FAILED"); } },
      clear: async () => { try { await clearSourceWorkerHeartbeat(options.workerId); } catch { throw new Error("SOURCE_READINESS_CLEAR_FAILED"); } },
    },
    deferSourceJob: (job, reason) => deferSourceImportJob(boss, job, reason),
    repository: createPrismaSourceJobRepository(), manualRequests: createPrismaSourceManualRequests(),
    reconcileTerminalRequests: async () => {
      const events = await listDeadLetterOutboxEvents(SOURCE_MANUAL_REQUEST_TOPIC, terminalCursor);
      await settleTerminalSourceManualRequests(events);
      terminalCursor = events.length === 100 ? events.at(-1)!.id : "";
      for (const topic of Object.values(OPERATIONAL_ACTION_TOPICS)) {
        const terminal = await listDeadLetterOutboxEvents(topic, operationalTerminalCursors.get(topic) ?? "");
        await settleTerminalOperationalRequests(terminal);
        operationalTerminalCursors.set(topic, terminal.length === 100 ? terminal.at(-1)!.id : "");
      }
    },
    outbox: { ...createOutboxDrainDependencies(boss), topics: ["platform.maintenance.requested", SOURCE_MANUAL_REQUEST_TOPIC,
      ...operationalTopics, ...(snapshotBuild ? [SNAPSHOT_BUILD_REQUEST_TOPIC] : [])],
      handle: (event, signal) => event.topic === SNAPSHOT_BUILD_REQUEST_TOPIC && snapshotBuild ? snapshotBuild(event, signal)
        : event.topic === SOURCE_MANUAL_REQUEST_TOPIC ? dispatchSourceManualRequest(boss, event)
          : operationalTopics.includes(event.topic) ? handleOperationalOutboxEvent(event, signal, operationalBuild ?? undefined, operationalPublish ?? undefined, operationalRollback ?? undefined) : handleDefaultOutboxEvent(event) } }); }
  finally { await stopPgBoss(); }
}
