import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
const gateway = vi.hoisted(() => vi.fn());
vi.mock("../../src/platform/http/safe-outbound.ts", async (original) => ({
  ...await original<typeof import("../../src/platform/http/safe-outbound.ts")>(), safeOutboundStream: gateway,
}));
import { runSourceWorker } from "../../src/infrastructure/source-worker-runtime.ts";
import { sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import { createPrismaSourceManualRequests, dispatchSourceManualRequest, settleTerminalSourceManualRequests, SOURCE_IMPORT_QUEUE, SOURCE_MANUAL_REQUEST_TOPIC, sourceManualJobId } from "../../src/modules/ingestion-core/worker.ts";
import { getPgBoss, stopPgBoss, drainOutbox, publishClaimedEvent, listDeadLetterOutboxEvents } from "../../src/modules/platform-operations/worker.ts";
import { ReliabilityService } from "../../src/modules/platform-operations/index.ts";
import { PrismaReliabilityRepository } from "../../src/modules/platform-operations/server.ts";
import type { PlatformAdminPrincipal, PrincipalContext, ProjectJobPrincipal } from "../../src/platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import * as database from "../../src/platform/database/transaction.ts";
import type { DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import { getPrismaPool } from "../../src/platform/database/prisma/client.ts";
import { acquireSourceExecutionGuard } from "../../src/modules/ingestion-core/infrastructure/source-execution-guard.ts";
import { deferSourceImportJob, type SourceImportJob } from "../../src/modules/ingestion-core/worker.ts";

describe("native manual Source execution", () => {
  it("runs the admin command through durable queues and does not reimport after both settlement crash windows", async () => {
    const suffix = randomUUID().slice(0, 8);
    const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-manual-admin", correlationId: randomUUID() };
    const scope = await database.runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const org = await tx.organization.create({ data: { name: "Synthetic manual", slug: `manual-${suffix}` } });
      const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic manual", slug: `manual-${suffix}` } });
      const other = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic foreign", slug: `foreign-${suffix}` } });
      await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
        update: { jobsFrozen: false, unfrozenAt: new Date() } });
      return { organizationId: org.id, projectId: project.id, otherProjectId: other.id };
    });
    const targetScope = { organizationId: scope.organizationId, projectId: scope.projectId };
    const feedRef = `SYNTHETIC_MANUAL_FEED_${suffix.toUpperCase()}`;
    const source = await sourceRegistryCommands.createSource(admin, { ...targetScope, sourceKey: "synthetic", name: "Synthetic manual",
      endpointCredentialRef: feedRef, adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "default-v1", profileVersion: "1.0.0",
      datasetType: "MIXED_REALTY", transportType: "HTTPS_XML", sharingPolicy: "PROJECT_ONLY", schedulePolicy: { mode: "MANUAL_ONLY" },
      safetyPolicyId: "", expectedNamespace: "", expectedProducer: "" });
    const target = { ...targetScope, sourceId: source.sourceId };
    await sourceRegistryCommands.setSourceEnabled(admin, { ...target, version: source.version, enabled: true });
    vi.stubEnv(feedRef, "https://synthetic.example.invalid/manual.xml");
    vi.stubEnv("PROJECT_STORAGE_BINDINGS", JSON.stringify([{ ...targetScope, bucketRef: "SYNTHETIC_MANUAL_BUCKET", endpointRef: "SYNTHETIC_MANUAL_ENDPOINT",
      regionRef: "SYNTHETIC_MANUAL_REGION", accessKeyIdRef: "SYNTHETIC_MANUAL_ACCESS", secretAccessKeyRef: "SYNTHETIC_MANUAL_SECRET" }]));
    vi.stubEnv("SYNTHETIC_MANUAL_BUCKET", `synthetic-manual-${suffix}`); vi.stubEnv("SYNTHETIC_MANUAL_ENDPOINT", "https://s3.twcstorage.ru");
    vi.stubEnv("SYNTHETIC_MANUAL_REGION", "ru-1"); vi.stubEnv("SYNTHETIC_MANUAL_ACCESS", "synthetic-manual-access");
    vi.stubEnv("SYNTHETIC_MANUAL_SECRET", "synthetic-manual-secret");
    const bytes = new TextEncoder().encode('<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06"><offer internal-id="manual"><category>квартира</category><type>продажа</type><price><value>1000</value></price></offer></realty-feed>');
    gateway.mockImplementation(async () => ({ status: 200, contentType: "application/xml", contentLength: bytes.length,
      finalUrl: new URL(process.env[feedRef]!), body: (async function* () { yield bytes; })(), close: vi.fn() }));
    const sdk = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: unknown) => {
      if (!(command instanceof PutObjectCommand)) throw new Error("SYNTHETIC_S3_OPERATION_DENIED");
      for await (const chunk of command.input.Body as AsyncIterable<Uint8Array>) expect(chunk.byteLength).toBeGreaterThan(0);
      return { ETag: "synthetic" } as never;
    });
    const originalPrincipal = database.runInPrincipalDatabaseTransaction;
    let simulateDatabaseFailure = false;
    const role = vi.spyOn(database, "runInPrincipalDatabaseTransaction").mockImplementation(async <T>(principal: PrincipalContext,
      execute: (tx: DatabaseTransaction) => Promise<T>) => {
      if (simulateDatabaseFailure) { simulateDatabaseFailure = false; throw new Error("SYNTHETIC_DB_DOWN"); }
      return originalPrincipal(principal, async (tx) => {
      if (principal.kind === "project-job") {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user")).toEqual([{ rolbypassrls: false }]);
      }
      return execute(tx);
      });
    });
    const originalSystem = database.runInSystemJobDatabaseTransaction;
    const systemRole = vi.spyOn(database, "runInSystemJobDatabaseTransaction").mockImplementation(async (context, execute) =>
      originalSystem(context, async (tx) => { await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker"); return execute(tx); }));
    const controller = new AbortController();
    let nativeCompletionFault = false; let dispatchCompletionFault = false; let nativeSettled = false; let dispatchSettled = false;
    const originalComplete = ReliabilityService.prototype.complete;
    const settlement = vi.spyOn(ReliabilityService.prototype, "complete").mockImplementation(async function (this: ReliabilityService, event) {
      if (event.topic === SOURCE_MANUAL_REQUEST_TOPIC && !dispatchCompletionFault) {
        dispatchCompletionFault = true;
        throw Object.assign(new Error("SYNTHETIC_DISPATCH_CRASH"), { code: "SYNTHETIC_DISPATCH_CRASH", retryable: true });
      }
      await originalComplete.call(this, event);
      if (event.topic === SOURCE_MANUAL_REQUEST_TOPIC) { dispatchSettled = true; if (nativeSettled) controller.abort(); }
    });
    try {
      const rollback = vi.spyOn(PrismaReliabilityRepository.prototype, "enqueueEvent").mockRejectedValueOnce(new Error("SYNTHETIC_ENQUEUE_FAILURE"));
      try { await expect(sourceRegistryCommands.requestManualSourceRun(admin, { ...target, idempotencyKey: `rollback-${suffix}` })).rejects.toThrow("SYNTHETIC_ENQUEUE_FAILURE"); }
      finally { rollback.mockRestore(); }
      await database.runInPrincipalDatabaseTransaction(admin, async (tx) => {
        expect(await tx.sourceManualRunRequest.count({ where: { ...target } })).toBe(0);
        expect(await tx.outboxEvent.count({ where: { organizationId: scope.organizationId, topic: SOURCE_MANUAL_REQUEST_TOPIC } })).toBe(0);
      });
      const input = { ...target, idempotencyKey: `native-manual-${suffix}` };
      const requested = await sourceRegistryCommands.requestManualSourceRun(admin, input);
      expect(await sourceRegistryCommands.requestManualSourceRun(admin, input)).toEqual({ requestId: requested.requestId, duplicate: true });
      await expect(sourceRegistryCommands.requestManualSourceRun(admin, { ...input, projectId: scope.otherProjectId })).rejects.toThrow("SOURCE_REGISTRY_NOT_FOUND");
      const foreign = createProjectJobPrincipal({ jobName: "source-import", organizationId: scope.organizationId, projectId: scope.otherProjectId }) as ProjectJobPrincipal;
      expect(await createPrismaSourceManualRequests().load(foreign, target.sourceId, requested.requestId)).toBeNull();
      const boss = await getPgBoss();
      const jobId = sourceManualJobId(requested.requestId); const complete = boss.complete.bind(boss);
      const completion = vi.spyOn(boss, "complete").mockImplementation(async (name, id, data, options) => {
        if (name === SOURCE_IMPORT_QUEUE && id === jobId && !nativeCompletionFault) {
          nativeCompletionFault = true; throw new Error("SYNTHETIC_NATIVE_COMPLETION_CRASH");
        }
        const result = await complete(name, id, data, options);
        if (name === SOURCE_IMPORT_QUEUE && id === jobId) {
          expect(data).toMatchObject({ status: "SKIPPED", reason: "MANUAL_REQUEST_SETTLED" }); nativeSettled = true; if (dispatchSettled) controller.abort();
        }
        return result;
      });
      const timeout = setTimeout(() => controller.abort(), 100_000);
      try { await runSourceWorker({ workerId: `synthetic-manual-${suffix}`, signal: controller.signal, pollIntervalMs: 10 }); }
      finally { clearTimeout(timeout); completion.mockRestore(); }
      expect(nativeCompletionFault).toBe(true); expect(dispatchCompletionFault).toBe(true);
      const inspect = await getPgBoss();
      expect((await inspect.getJobById(SOURCE_IMPORT_QUEUE, jobId))?.state).toBe("completed");
      await stopPgBoss();
      await database.runInPrincipalDatabaseTransaction(admin, async (tx) => {
        expect(await tx.sourceManualRunRequest.findUniqueOrThrow({ where: { id: requested.requestId } })).toMatchObject({ status: "COMPLETED" });
        expect(await tx.sourceRevision.count({ where: { ...target, status: "GOOD" } })).toBe(1);
        expect(await tx.outboxEvent.findFirstOrThrow({ where: { organizationId: scope.organizationId, topic: SOURCE_MANUAL_REQUEST_TOPIC } }))
          .toMatchObject({ status: "PROCESSED" });
        expect(await tx.outboxEvent.findFirstOrThrow({ where: { organizationId: scope.organizationId, topic: "snapshot.build.request" } }))
          .toMatchObject({ status: "PENDING" });
      });
      expect(gateway).toHaveBeenCalledOnce();

      // An old dispatch envelope must not terminally settle an executor-less intent.
      const reliability = new ReliabilityService(new PrismaReliabilityRepository());
      // Real default worker admission contention at the last normal retry must
      // preserve the request, native row and original execution retry budget.
      const contended = await sourceRegistryCommands.requestManualSourceRun(admin, { ...target, idempotencyKey: `guard-contention-${suffix}` });
      const contentionEvent = await reliability.claim(`guard-publisher-${suffix}`, 300_000, [SOURCE_MANUAL_REQUEST_TOPIC]);
      const contentionBoss = await getPgBoss();
      await dispatchSourceManualRequest(contentionBoss, contentionEvent!); await reliability.complete(contentionEvent!);
      const contentionId = sourceManualJobId(contended.requestId);
      await contentionBoss.getDb().executeSql("UPDATE pgboss.job SET retry_count = 3, retry_limit = 3 WHERE name = $1 AND id = $2::uuid", [SOURCE_IMPORT_QUEUE, contentionId]);
      const guard = await acquireSourceExecutionGuard(getPrismaPool(), target);
      const admission = new AbortController(); const nativeDb = contentionBoss.getDb(); const executeSql = nativeDb.executeSql.bind(nativeDb);
      const deferredSql = vi.spyOn(nativeDb, "executeSql").mockImplementation(async (text, values) => {
        const result = await executeSql(text, values);
        if (text.includes("SOURCE_EXECUTION_BUSY") && text.includes("UPDATE pgboss.job")) admission.abort();
        return result;
      });
      const admissionTimeout = setTimeout(() => admission.abort(), 5_000);
      try { await runSourceWorker({ workerId: `guard-busy-${suffix}`, signal: admission.signal, pollIntervalMs: 10 }); }
      finally { clearTimeout(admissionTimeout); deferredSql.mockRestore(); await guard.release(); }
      const requeuedBoss = await getPgBoss();
      const deferredJob = await requeuedBoss.getJobById<SourceImportJob>(SOURCE_IMPORT_QUEUE, contentionId);
      expect(deferredJob).toMatchObject({ state: "created", retryCount: 3, retryLimit: 3, startedOn: null });
      expect(deferredJob!.startAfter.getTime()).toBeGreaterThan(Date.now());
      expect(await database.runInPrincipalDatabaseTransaction(admin, (tx) => tx.sourceManualRunRequest.findUniqueOrThrow({ where: { id: contended.requestId } })))
        .toMatchObject({ status: "REQUESTED" });
      expect(gateway).toHaveBeenCalledOnce();
      // Stale metadata cannot mutate the new queued attempt.
      await expect(deferSourceImportJob(requeuedBoss, { ...deferredJob!, startedOn: new Date() })).rejects.toThrow("SOURCE_JOB_LEASE_LOST");
      const recovered = new AbortController(); const recoverComplete = requeuedBoss.complete.bind(requeuedBoss);
      const recoverAck = vi.spyOn(requeuedBoss, "complete").mockImplementation(async (name, id, data, options) => {
        const result = await recoverComplete(name, id, data, options);
        if (name === SOURCE_IMPORT_QUEUE && id === contentionId) { expect(data).toMatchObject({ status: "COMPLETED" }); recovered.abort(); }
        return result;
      });
      const recoverTimeout = setTimeout(() => recovered.abort(), 40_000);
      try { await runSourceWorker({ workerId: `guard-recovery-${suffix}`, signal: recovered.signal, pollIntervalMs: 10 }); }
      finally { clearTimeout(recoverTimeout); recoverAck.mockRestore(); }
      expect(await database.runInPrincipalDatabaseTransaction(admin, (tx) => tx.sourceManualRunRequest.findUniqueOrThrow({ where: { id: contended.requestId } })))
        .toMatchObject({ status: "COMPLETED" });
      expect(gateway).toHaveBeenCalledTimes(2);
      const snapshot = await reliability.claim(`snapshot-publisher-${suffix}`, 300_000, ["snapshot.build.request"]);
      expect(snapshot).not.toBeNull();
      const publish = await getPgBoss(); await publishClaimedEvent(publish, snapshot!); await stopPgBoss();
      await drainOutbox({ workerId: `reserved-snapshot-${suffix}`, maxEvents: 1 });
      await database.runInSystemJobDatabaseTransaction({ jobName: "manual-proof", correlationId: randomUUID() }, async (tx) => {
        expect(await tx.outboxEvent.findUniqueOrThrow({ where: { id: snapshot!.outboxEventId } }))
          .toMatchObject({ status: "PENDING", deferredAttempts: 1, lockedBy: null, lastErrorCode: "OUTBOX_EXECUTOR_RESERVED" });
        expect(await tx.jobRun.findUniqueOrThrow({ where: { id: snapshot!.jobRunId } })).toMatchObject({ status: "DEFERRED" });
      });

      const busy = await sourceRegistryCommands.requestManualSourceRun(admin, { ...target, idempotencyKey: `busy-manual-${suffix}` });
      const busyEvent = await reliability.claim(`busy-publisher-${suffix}`, 300_000, [SOURCE_MANUAL_REQUEST_TOPIC]);
      expect(busyEvent).not.toBeNull();
      const busyBoss = await getPgBoss();
      const blockerId = await busyBoss.send(SOURCE_IMPORT_QUEUE, { schemaVersion: 1, ...target, trigger: "MANUAL" }, { singletonKey: target.sourceId });
      expect(blockerId).toEqual(expect.any(String));
      expect(await dispatchSourceManualRequest(busyBoss, busyEvent!)).toEqual({ deferred: true, code: "SOURCE_JOB_QUEUE_BUSY" });
      expect(await database.runInPrincipalDatabaseTransaction(admin, (tx) => tx.sourceManualRunRequest.findUniqueOrThrow({ where: { id: busy.requestId } })))
        .toMatchObject({ status: "REQUESTED" });
      await reliability.defer(busyEvent!, "SOURCE_JOB_QUEUE_BUSY"); await stopPgBoss();

      const terminal = await sourceRegistryCommands.requestManualSourceRun(admin, { ...target, idempotencyKey: `terminal-manual-${suffix}` });
      const terminalEvent = await reliability.claim(`terminal-publisher-${suffix}`, 300_000, [SOURCE_MANUAL_REQUEST_TOPIC]);
      expect(terminalEvent?.payload.manualRequestId).toBe(terminal.requestId);
      simulateDatabaseFailure = true;
      await expect(dispatchSourceManualRequest({ send: vi.fn(), getJobById: vi.fn() } as never, terminalEvent!))
        .rejects.toMatchObject({ code: "SOURCE_MANUAL_DISPATCH_FAILED", retryable: true });
      expect(await reliability.fail(terminalEvent!, "SOURCE_MANUAL_DISPATCH_FAILED", true, 1)).toMatchObject({ status: "dead_letter" });
      // A process can crash here. Persisted DEAD_LETTER is recoverable on startup/maintenance.
      expect(await database.runInPrincipalDatabaseTransaction(admin, (tx) => tx.sourceManualRunRequest.findUniqueOrThrow({ where: { id: terminal.requestId } })))
        .toMatchObject({ status: "REQUESTED" });
      const version = await database.runInPrincipalDatabaseTransaction(admin, (tx) => tx.source.findUniqueOrThrow({ where: { id: target.sourceId }, select: { version: true } }));
      await sourceRegistryCommands.setSourceEnabled(admin, { ...target, version: version.version, enabled: false });
      const restart = new AbortController(); const restartedBoss = await getPgBoss(); const restartComplete = restartedBoss.complete.bind(restartedBoss);
      const restartedCompletion = vi.spyOn(restartedBoss, "complete").mockImplementation(async (name, id, data, options) => {
        const result = await restartComplete(name, id, data, options);
        if (name === SOURCE_IMPORT_QUEUE && id === blockerId) { expect(data).toMatchObject({ status: "SKIPPED", reason: "SOURCE_DISABLED" }); restart.abort(); }
        return result;
      });
      const restartTimeout = setTimeout(() => restart.abort(), 5_000);
      try { await runSourceWorker({ workerId: `restarted-manual-${suffix}`, signal: restart.signal, pollIntervalMs: 10 }); }
      finally { clearTimeout(restartTimeout); restartedCompletion.mockRestore(); }
      expect(await database.runInPrincipalDatabaseTransaction(admin, (tx) => tx.sourceManualRunRequest.findUniqueOrThrow({ where: { id: terminal.requestId } })))
        .toMatchObject({ status: "FAILED" });
      await settleTerminalSourceManualRequests(await listDeadLetterOutboxEvents(SOURCE_MANUAL_REQUEST_TOPIC, ""));
      await settleTerminalSourceManualRequests(await listDeadLetterOutboxEvents(SOURCE_MANUAL_REQUEST_TOPIC, ""));
      expect(await database.runInPrincipalDatabaseTransaction(admin, (tx) => tx.sourceManualRunRequest.findUniqueOrThrow({ where: { id: terminal.requestId } })))
        .toMatchObject({ status: "FAILED" });
      expect(await database.runInPrincipalDatabaseTransaction(admin, (tx) => tx.sourceManualRunRequest.findUniqueOrThrow({ where: { id: requested.requestId } })))
        .toMatchObject({ status: "COMPLETED" });
      expect(gateway).toHaveBeenCalledTimes(2);
    } finally { await stopPgBoss(); settlement.mockRestore(); systemRole.mockRestore(); role.mockRestore(); sdk.mockRestore(); vi.unstubAllEnvs(); gateway.mockReset(); }
  }, 170_000);
});
