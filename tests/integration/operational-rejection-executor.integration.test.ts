import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = (context, execute, options) =>
    actual.runInAuthorizedDatabaseTransaction(context, async (tx) => {
      await tx.$executeRawUnsafe(context.principalKind === "platform-admin"
        ? "SET LOCAL ROLE ams_data_hub_web" : "SET LOCAL ROLE ams_data_hub_worker");
      expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
        .toEqual([{ rolbypassrls: false, rolsuper: false }]);
      return execute(tx);
    }, options);
  return { ...actual, runInAuthorizedDatabaseTransaction: authorized,
    runInPrincipalDatabaseTransaction: (principal, execute) => authorized(actual.createDatabaseAuthorizationContext(principal), execute),
    runInSystemJobDatabaseTransaction: (input, execute) => authorized(actual.createSystemJobDatabaseAuthorizationContext(input), execute),
  } satisfies typeof actual;
});
import { executeSuspiciousRejection, requestOperationalAction } from "../../src/modules/operations-control/server.ts";
import { OPERATIONAL_ACTION_TOPICS } from "../../src/modules/operations-control/index.ts";
import { OperationalActionLifecycleRepository } from "../../src/modules/operations-control/infrastructure/operational-action-lifecycle.ts";
import { prepareSuspiciousRevisionRejection } from "../../src/modules/ingestion-core/server.ts";
import { ReliabilityService } from "../../src/modules/platform-operations/index.ts";
import { PrismaReliabilityRepository } from "../../src/modules/platform-operations/server.ts";
import { analyzeImportSafety, BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../../src/modules/ingestion-core/domain/safety-engine.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import type { Prisma } from "../../src/generated/prisma/client.ts";
import { handleOperationalOutboxEvent, settleTerminalOperationalRequests } from "../../src/modules/operations-control/worker.ts";
import { createOutboxDrainDependencies, drainOutboxWithDependencies, getPgBoss, listDeadLetterOutboxEvents,
  publishClaimedEvent, runReliabilityRetention } from "../../src/modules/platform-operations/worker.ts";
import { OUTBOX_DELIVERY_QUEUE } from "../../src/modules/platform-operations/domain/pg-boss.ts";
import { runSourceWorker } from "../../src/infrastructure/source-worker-runtime.ts";
import { SOURCE_IMPORT_QUEUE } from "../../src/modules/ingestion-core/worker.ts";
import { S3Client } from "@aws-sdk/client-s3";

async function fixture() {
  const suffix = randomUUID().slice(0, 8);
  const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: `synthetic-rejection-${suffix}`, correlationId: randomUUID() };
  const subject = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
      update: { jobsFrozen: false, unfrozenAt: new Date() } });
    const org = await tx.organization.create({ data: { name: "Synthetic review", slug: `rejection-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic review", slug: `rejection-${suffix}` } });
    const scope = { organizationId: org.id, projectId: project.id };
    const source = await tx.source.create({ data: { ...scope, sourceKey: "synthetic-review", name: "Synthetic review",
      adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "default-v1", profileVersion: "1.0.0",
      datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" } } });
    const metadata = { ...scope, sourceId: source.id, sourceVersion: source.version, adapterKey: source.adapterKey,
      adapterVersion: source.adapterVersion, profileKey: source.profileKey, profileVersion: source.profileVersion,
      rawStorageKey: "synthetic-private/review", rawArtifactHash: "a".repeat(64), rawByteCount: 0,
      normalizedContentHash: "b".repeat(64), recordCount: 1 };
    const good = await tx.sourceRevision.create({ data: { ...metadata, safetyPolicy: { ...BOOTSTRAP_SOURCE_SAFETY_POLICY },
      safetyAnalysis: analyzeImportSafety({ recordCount: 1, invalidRecordCount: 0, previousGoodRecordCount: null, issues: [] }) as unknown as Prisma.InputJsonObject } });
    await tx.sourceRevisionRecord.create({ data: { ...scope, sourceId: source.id, revisionId: good.id,
      externalId: "synthetic-good", orderKey: Buffer.from("synthetic-good", "utf8").toString("hex"), inventoryUid: "01ARZ3NDEKTSV4RRFFQ69G5FAV", recordHash: "c".repeat(64), payload: {} } });
    await tx.sourceRevision.update({ where: { id: good.id }, data: { status: "STAGED" } });
    await tx.sourceRevision.update({ where: { id: good.id }, data: { status: "GOOD", sequence: 1, completedAt: new Date() } });
    await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: good.id, lastSuccessAt: good.startedAt } });
    const policy = { ...BOOTSTRAP_SOURCE_SAFETY_POLICY, minRecordCount: 2 };
    const analysis = analyzeImportSafety({ recordCount: 1, invalidRecordCount: 0, previousGoodRecordCount: 1, issues: [] }, policy);
    expect(analysis.disposition).toBe("SUSPICIOUS");
    const revision = await tx.sourceRevision.create({ data: { ...metadata, baseLastGoodRevisionId: good.id,
      safetyPolicy: policy, safetyAnalysis: analysis as unknown as Prisma.InputJsonObject } });
    await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED" } });
    await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "SUSPICIOUS" } });
    return { ...scope, sourceId: source.id, sourceRevisionId: revision.id, goodId: good.id, sourceVersion: source.version };
  });
  const reason = "Synthetic private owner justification";
  const accepted = await requestOperationalAction(admin, { ...subject, action: "SUSPICIOUS_REJECT", reason,
    idempotencyKey: `synthetic-reject-${suffix}` });
  const eventId = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const request = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } });
    if (!request.outboxEventId) throw new Error("SYNTHETIC_INTENT_MISSING");
    await tx.outboxEvent.update({ where: { id: request.outboxEventId }, data: { availableAt: new Date("1998-01-01T00:00:00.000Z") } });
    return request.outboxEventId;
  });
  let now = new Date("2000-01-01T00:00:01.000Z");
  const reliability = new ReliabilityService(new PrismaReliabilityRepository(), () => now);
  const lease = await reliability.claim(`reject-worker-${suffix}`, 300_000, [OPERATIONAL_ACTION_TOPICS.SUSPICIOUS_REJECT]);
  if (!lease || lease.outboxEventId !== eventId) throw new Error("SYNTHETIC_LEASE_MISSING");
  const context = { principalKind: "project-job" as const, actorId: "operations-executor", organizationId: subject.organizationId,
    projectIds: [subject.projectId], correlationId: randomUUID() };
  return { admin, subject, requestId: accepted.requestId, reason, lease, reliability, context,
    setNow: (date: Date) => { now = date; } };
}

describe("actual operational rejection lifecycle under NOBYPASS", () => {
  it("denies manufactured terminal status, wrong terminal owner and foreign executor purpose", async () => {
    const f = await fixture();
    const failed = { status: "FAILED" as const, safeErrorCode: "OPERATIONS_CONTROL_EXECUTION_FAILED",
      startedAt: new Date(), finishedAt: new Date(), leaseJobRunId: f.lease.jobRunId,
      leaseAttempt: f.lease.attempt, leaseWorkerId: f.lease.workerId, leaseAcquiredAt: new Date(f.lease.leaseAcquiredAt) };
    await expect(runInAuthorizedDatabaseTransaction(f.context, (tx) => tx.operationalActionRequest.update({
      where: { id: f.requestId }, data: failed,
    }))).rejects.toThrow("OUTBOX_OPERATION_TERMINAL_INVALID");
    await f.reliability.fail(f.lease, "SYNTHETIC_TERMINAL", false, 1);
    await expect(runInAuthorizedDatabaseTransaction(f.context, (tx) => tx.operationalActionRequest.update({
      where: { id: f.requestId }, data: { ...failed, leaseWorkerId: "synthetic-forged-worker" },
    }))).rejects.toThrow("OUTBOX_OPERATION_TERMINAL_INVALID");
    await expect(runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.operationalActionRequest.update({
      where: { id: f.requestId }, data: failed,
    }))).rejects.toThrow();
    await settleTerminalOperationalRequests([{ id: f.lease.outboxEventId, organizationId: f.subject.organizationId, payload: f.lease.payload }]);
  });

  it.each(["execute", "restart-reconcile"])("proves %s through actual combined worker startup and owned readiness", async (mode) => {
    const f = await fixture(); const controller = new AbortController();
    const workerId = `${f.lease.workerId}-runtime`;
    vi.stubEnv("SNAPSHOT_BUILD_ENABLED", "false");
    vi.stubEnv("PROJECT_STORAGE_BINDINGS", JSON.stringify([{ organizationId: f.subject.organizationId,
      projectId: f.subject.projectId, bucketRef: "SYNTHETIC_REJECTION_BUCKET", endpointRef: "SYNTHETIC_REJECTION_ENDPOINT",
      regionRef: "SYNTHETIC_REJECTION_REGION", accessKeyIdRef: "SYNTHETIC_REJECTION_ACCESS", secretAccessKeyRef: "SYNTHETIC_REJECTION_SECRET" }]));
    vi.stubEnv("SYNTHETIC_REJECTION_BUCKET", "synthetic-rejection-bucket");
    vi.stubEnv("SYNTHETIC_REJECTION_ENDPOINT", "https://s3.twcstorage.ru");
    vi.stubEnv("SYNTHETIC_REJECTION_REGION", "ru-1");
    vi.stubEnv("SYNTHETIC_REJECTION_ACCESS", "synthetic-rejection-access");
    vi.stubEnv("SYNTHETIC_REJECTION_SECRET", "synthetic-rejection-secret");
    const outbound = vi.spyOn(S3Client.prototype, "send").mockRejectedValue(new Error("SYNTHETIC_UNEXPECTED_OUTBOUND"));
    const boss = await getPgBoss(); await boss.createQueue(OUTBOX_DELIVERY_QUEUE);
    if (mode === "execute") await publishClaimedEvent(boss, f.lease);
    else {
      await f.reliability.fail(f.lease, "SYNTHETIC_TERMINAL", false, 1);
      await runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.outboxEvent.create({ data: {
        topic: OPERATIONAL_ACTION_TOPICS.SUSPICIOUS_REJECT, organizationId: f.subject.organizationId,
        payload: { synthetic: "malformed" }, status: "DEAD_LETTER", correlationId: "synthetic-malformed-runtime",
      } }));
    }
    const observeThenStop = async () => {
      let observed = false; const deadline = Date.now() + 2000;
      while (!observed && Date.now() < deadline) {
        observed = await runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.runtimeHeartbeat.count({
          where: { runtime: "source-worker", workerId },
        }).then((count) => count === 1));
        if (!observed) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observed).toBe(true); controller.abort();
    };
    const complete = boss.complete.bind(boss); const fetch = boss.fetch.bind(boss);
    const completed = vi.spyOn(boss, "complete").mockImplementation(async (name, id, data, options) => {
      const job = name === OUTBOX_DELIVERY_QUEUE && typeof id === "string" ? await boss.getJobById(name, id) : null;
      const result = await complete(name, id, data, options);
      if (mode === "execute" && (job?.data as { event?: { outboxEventId?: string } } | undefined)?.event?.outboxEventId === f.lease.outboxEventId) {
        expect(data).toEqual({ status: "success" }); await observeThenStop();
      }
      return result;
    });
    const fetched = vi.spyOn(boss, "fetch").mockImplementation(async (name, options) => {
      const result = await fetch(name, options);
      if (mode === "restart-reconcile" && name === SOURCE_IMPORT_QUEUE) await observeThenStop();
      return result;
    });
    const deadline = setTimeout(() => controller.abort(), 10_000);
    try {
      const workerResult = await runSourceWorker({ workerId, signal: controller.signal, pollIntervalMs: 10 });
      expect(workerResult).toMatchObject({ completed: 0, failed: 0 });
      expect(workerResult.fetched).toBeLessThanOrEqual(mode === "execute" ? 0 : 1);
      expect(outbound).not.toHaveBeenCalled();
      await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
        expect(await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: f.requestId } }))
          .toMatchObject({ status: mode === "execute" ? "SUCCEEDED" : "FAILED" });
        expect(await tx.runtimeHeartbeat.count({ where: { runtime: "source-worker", workerId } })).toBe(0);
      });
    } finally { clearTimeout(deadline); controller.abort(); completed.mockRestore(); fetched.mockRestore(); outbound.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("keeps retention predicate functional with a non-BYPASS definer without exposing requests to runtime retention", async () => {
    const f = await fixture();
    // Privileged fixture ownership changes stay inside this synthetic test
    // transaction. The actual predicate call runs as NOBYPASS worker and its
    // temporary definer is the existing NOBYPASS web role, never a new role.
    await expect(runInAuthorizedDatabaseTransaction(f.context, async (tx) => {
      await tx.$executeRawUnsafe("RESET ROLE");
      await tx.$executeRawUnsafe("GRANT CREATE ON SCHEMA public TO ams_data_hub_web");
      await tx.$executeRawUnsafe("ALTER FUNCTION operational_outbox_retention_allowed(text) OWNER TO ams_data_hub_web");
      await tx.$executeRawUnsafe("REVOKE CREATE ON SCHEMA public FROM ams_data_hub_web");
      await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
      await tx.$queryRawUnsafe("SELECT set_config('app.principal_kind', 'system-job', true), set_config('app.actor_id', 'outbox-retention', true)");
      expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'ams_data_hub_web'"))
        .toEqual([{ rolbypassrls: false, rolsuper: false }]);
      expect(await tx.$queryRawUnsafe("SELECT operational_outbox_retention_allowed($1) AS allowed", f.lease.outboxEventId))
        .toEqual([{ allowed: false }]);
      expect(await tx.operationalActionRequest.count({ where: { id: f.requestId } })).toBe(0);
      // NOINHERIT fixture maintainer cannot reassign ownership back via RESET
      // ROLE. Roll back the entire ownership fixture instead of widening roles.
      throw new Error("SYNTHETIC_OWNER_ROLLBACK");
    })).rejects.toThrow("SYNTHETIC_OWNER_ROLLBACK");
    await f.reliability.fail(f.lease, "SYNTHETIC_NEGATIVE_CLEANUP", false, 1);
  });

  it("skips malformed and orphan terminal events without blocking valid request reconciliation", async () => {
    const f = await fixture();
    await f.reliability.fail(f.lease, "SYNTHETIC_TERMINAL", false, 1);
    const valid = { id: f.lease.outboxEventId, organizationId: f.subject.organizationId, payload: f.lease.payload };
    const orphan = await runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.outboxEvent.create({ data: {
      organizationId: f.subject.organizationId, topic: OPERATIONAL_ACTION_TOPICS.SUSPICIOUS_REJECT, status: "DEAD_LETTER",
      payload: { ...f.lease.payload, requestId: "synthetic-orphan" }, correlationId: "synthetic-orphan", occurredAt: new Date("2000-01-01"),
    } }));
    await settleTerminalOperationalRequests([{ ...valid, payload: { synthetic: "malformed" } },
      { ...valid, organizationId: "synthetic-foreign" }, { id: orphan.id, organizationId: orphan.organizationId, payload: orphan.payload }, valid]);
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) =>
      expect(await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: f.requestId } })).toMatchObject({ status: "FAILED" }));
    await runReliabilityRetention(new Date("2030-01-01"));
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) =>
      expect(await tx.outboxEvent.findUnique({ where: { id: orphan.id } })).toBeNull());
  });
  it.each(["REQUESTED", "RUNNING"])("reconciles %s only after terminal failure and protects crash evidence from retention", async (initial) => {
    const f = await fixture();
    if (initial === "RUNNING") await runInAuthorizedDatabaseTransaction(f.context, async (tx) => {
      await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text");
      await new OperationalActionLifecycleRepository(tx).begin(f.lease);
    });
    const event = { id: f.lease.outboxEventId, organizationId: f.subject.organizationId, payload: f.lease.payload };
    expect(await f.reliability.fail(f.lease, "SYNTHETIC_TRANSIENT", true, 2)).toMatchObject({ status: "pending" });
    await settleTerminalOperationalRequests([event]);
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) =>
      expect(await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: f.requestId } })).toMatchObject({ status: initial, safeErrorCode: null }));
    f.setNow(new Date("2000-01-01T00:01:00.000Z"));
    const retried = await f.reliability.claim(f.lease.workerId, 300_000, [OPERATIONAL_ACTION_TOPICS.SUSPICIOUS_REJECT]);
    if (!retried || retried.outboxEventId !== f.lease.outboxEventId) throw new Error("SYNTHETIC_RETRY_MISSING");
    expect(retried.attempt).toBe(2);
    expect(await f.reliability.fail(retried, "SYNTHETIC_TRANSIENT", true, 2)).toMatchObject({ status: "dead_letter" });
    // Simulated crash after durable outbox failure: request still unresolved.
    await runReliabilityRetention(new Date("2030-01-01T00:00:00.000Z"));
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
      expect(await tx.outboxEvent.findUnique({ where: { id: event.id } })).not.toBeNull();
      expect(await tx.jobRun.findUnique({ where: { id: retried.jobRunId } })).not.toBeNull();
    });
    const page = await listDeadLetterOutboxEvents(OPERATIONAL_ACTION_TOPICS.SUSPICIOUS_REJECT, "");
    expect(page.map((item) => item.id)).toContain(event.id);
    await settleTerminalOperationalRequests(page);
    await settleTerminalOperationalRequests([event]); // Restart/page replay is immutable.
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
      const request = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: f.requestId } });
      expect(request).toMatchObject({ status: "FAILED", safeErrorCode: "OPERATIONS_CONTROL_EXECUTION_FAILED",
        result: null, leaseJobRunId: retried.jobRunId, leaseAttempt: 2, leaseWorkerId: retried.workerId,
        leaseAcquiredAt: new Date(retried.leaseAcquiredAt) });
      expect(request.finishedAt!.getTime()).toBeGreaterThanOrEqual(request.startedAt!.getTime());
      expect(await tx.sourceRevision.findUniqueOrThrow({ where: { id: f.subject.sourceRevisionId } })).toMatchObject({ status: "SUSPICIOUS" });
    });
    await expect(runInAuthorizedDatabaseTransaction(f.context, (tx) => tx.operationalActionRequest.update({
      where: { id: f.requestId }, data: { safeErrorCode: "SYNTHETIC_FORGERY" },
    }))).rejects.toThrow("OPERATIONS_CONTROL_TRANSITION_INVALID");
    await runReliabilityRetention(new Date("2030-01-01T00:00:00.000Z"));
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
      expect(await tx.outboxEvent.findUnique({ where: { id: event.id } })).toBeNull();
      expect(await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: f.requestId } }))
        .toMatchObject({ status: "FAILED", outboxEventId: null });
    });
  });

  it("preserves committed success even when the queue acknowledgement exhausts into DEAD_LETTER", async () => {
    const f = await fixture(); const result = await executeSuspiciousRejection(f.lease);
    await f.reliability.fail(f.lease, "SYNTHETIC_ACK_FAILURE", false, 1);
    await settleTerminalOperationalRequests([{ id: f.lease.outboxEventId, organizationId: f.subject.organizationId, payload: f.lease.payload }]);
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) =>
      expect(await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: f.requestId } }))
        .toMatchObject({ status: "SUCCEEDED", result, safeErrorCode: null }));
  });

  it("executes the real rejection adapter through the shared native pg-boss queue", async () => {
    const f = await fixture(); const boss = await getPgBoss();
    await boss.createQueue(OUTBOX_DELIVERY_QUEUE);
    // Other real combined-worker cases can leave their own queued maintenance
    // packets. Native priority selects only this fixture without changing the
    // consumer predicate, settling foreign intents, or weakening assertions.
    const queueJobId = await boss.send(OUTBOX_DELIVERY_QUEUE, { schemaVersion: 1, event: f.lease },
      { singletonKey: f.lease.outboxEventId, priority: 1000 });
    expect(queueJobId).not.toBeNull();
    const result = await drainOutboxWithDependencies({ workerId: f.lease.workerId, maxEvents: 1 }, {
      ...createOutboxDrainDependencies(boss), reliability: f.reliability,
      topics: [OPERATIONAL_ACTION_TOPICS.SUSPICIOUS_REJECT], handle: handleOperationalOutboxEvent,
    });
    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0 });
    expect((await boss.getJobById(OUTBOX_DELIVERY_QUEUE, queueJobId!))?.state).toBe("completed");
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
      expect(await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: f.requestId } })).toMatchObject({ status: "SUCCEEDED" });
      expect(await tx.outboxEvent.findUniqueOrThrow({ where: { id: f.lease.outboxEventId } })).toMatchObject({ status: "PROCESSED" });
    });
  });
  it("atomically rejects only the suspicious revision and stores a bounded immutable result", async () => {
    const f = await fixture();
    const result = { action: "SUSPICIOUS_REJECT", sourceRevisionId: f.subject.sourceRevisionId };
    await expect(executeSuspiciousRejection(f.lease)).resolves.toEqual(result);
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
      const request = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: f.requestId } });
      expect(request).toMatchObject({ status: "SUCCEEDED", result, leaseJobRunId: f.lease.jobRunId, leaseAttempt: 1,
        leaseWorkerId: f.lease.workerId, leaseAcquiredAt: new Date(f.lease.leaseAcquiredAt) });
      expect(request.startedAt).not.toBeNull(); expect(request.finishedAt).not.toBeNull();
      expect(await tx.source.findUniqueOrThrow({ where: { id: f.subject.sourceId } }))
        .toMatchObject({ lastGoodRevisionId: f.subject.goodId, version: f.subject.sourceVersion });
      const revision = await tx.sourceRevision.findUniqueOrThrow({ where: { id: f.subject.sourceRevisionId } });
      expect(revision).toMatchObject({ status: "REJECTED", safetyAnalysis: { disposition: "REJECTED",
        review: { reviewedBy: f.admin.userId, reason: f.reason } } });
      expect(await tx.sourceRevisionRecord.count({ where: { revisionId: f.subject.goodId } })).toBe(1);
      expect(await tx.auditEvent.count({ where: { entityId: f.subject.sourceRevisionId, action: "operations-control.suspicious.rejected" } })).toBe(1);
      expect(await tx.outboxEvent.findUniqueOrThrow({ where: { id: f.lease.outboxEventId } })).toMatchObject({ status: "PROCESSING", payload: {
        schemaVersion: 1, organizationId: f.subject.organizationId, projectId: f.subject.projectId, requestId: f.requestId, action: "SUSPICIOUS_REJECT" } });
    });
    await expect(runInAuthorizedDatabaseTransaction(f.context, (tx) => tx.operationalActionRequest.update({
      where: { id: f.requestId }, data: { status: "RUNNING" },
    }))).rejects.toThrow("OPERATIONS_CONTROL_TRANSITION_INVALID");
    await f.reliability.complete(f.lease);
  });

  it("rolls domain review, audit and request back together if final result persistence fails", async () => {
    const f = await fixture();
    const fail = vi.spyOn(OperationalActionLifecycleRepository.prototype, "succeedRejectedRevision")
      .mockRejectedValueOnce(new Error("SYNTHETIC_RESULT_FAILURE"));
    try { await expect(executeSuspiciousRejection(f.lease)).rejects.toThrow("SYNTHETIC_RESULT_FAILURE"); }
    finally { fail.mockRestore(); }
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
      expect(await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: f.requestId } })).toMatchObject({ status: "REQUESTED", result: null, leaseAttempt: null });
      expect(await tx.sourceRevision.findUniqueOrThrow({ where: { id: f.subject.sourceRevisionId } })).toMatchObject({ status: "SUSPICIOUS" });
      expect(await tx.auditEvent.count({ where: { entityId: f.subject.sourceRevisionId, action: "operations-control.suspicious.rejected" } })).toBe(0);
    });
    await expect(executeSuspiciousRejection(f.lease)).resolves.toMatchObject({ action: "SUSPICIOUS_REJECT" });
    await f.reliability.complete(f.lease);
  });

  it("recovers committed success after actual durable retry without repeating mutable admission or review", async () => {
    const f = await fixture(); const original = await executeSuspiciousRejection(f.lease);
    await f.reliability.fail(f.lease, "SYNTHETIC_ACK_GAP", true, 3);
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
      await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } });
      await tx.project.update({ where: { id: f.subject.projectId }, data: { serviceState: "SUSPENDED" } });
    });
    f.setNow(new Date("2000-01-01T01:00:01.000Z"));
    const retried = await f.reliability.claim(`${f.lease.workerId}-retry`, 300_000, [f.lease.topic]);
    if (!retried || retried.outboxEventId !== f.lease.outboxEventId) throw new Error("SYNTHETIC_RETRY_MISSING");
    expect(retried.attempt).toBe(2);
    await expect(executeSuspiciousRejection(retried)).resolves.toEqual(original);
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
      expect(await tx.auditEvent.count({ where: { entityId: f.subject.sourceRevisionId, action: "operations-control.suspicious.rejected" } })).toBe(1);
      expect(await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: f.requestId } })).toMatchObject({ status: "SUCCEEDED", result: original, leaseAttempt: 1 });
      expect(await tx.source.findUniqueOrThrow({ where: { id: f.subject.sourceId } })).toMatchObject({ lastGoodRevisionId: f.subject.goodId });
    });
    await f.reliability.complete(retried);
  });

  it("denies stale same-worker/same-attempt execution after timestamp-only takeover", async () => {
    const f = await fixture(); f.setNow(new Date("2000-01-01T00:00:02.000Z"));
    const taken = await f.reliability.takeOver(f.lease, f.lease.workerId);
    if (!taken) throw new Error("SYNTHETIC_TAKEOVER_MISSING");
    await expect(executeSuspiciousRejection(f.lease)).rejects.toThrow("OUTBOX_OPERATION_LEASE_LOST");
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) =>
      expect(await tx.sourceRevision.findUniqueOrThrow({ where: { id: f.subject.sourceRevisionId } })).toMatchObject({ status: "SUSPICIOUS" }));
    await expect(executeSuspiciousRejection(taken)).resolves.toMatchObject({ action: "SUSPICIOUS_REJECT" });
    await f.reliability.complete(taken);
  });

  it("rejects direct source mutation, manufactured success and immutable subject writes", async () => {
    const f = await fixture();
    await expect(runInAuthorizedDatabaseTransaction(f.context, (tx) => tx.sourceRevision.update({
      where: { id: f.subject.sourceRevisionId }, data: { status: "REJECTED", completedAt: new Date() },
    }))).rejects.toThrow("SOURCE_OPERATION_REVIEW_INVALID");
    await expect(runInAuthorizedDatabaseTransaction(f.context, async (tx) => {
      await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text");
      await new OperationalActionLifecycleRepository(tx).begin(f.lease);
      await tx.operationalActionRequest.update({ where: { id: f.requestId }, data: { status: "SUCCEEDED", finishedAt: new Date(),
        result: { action: "SUSPICIOUS_REJECT", sourceRevisionId: f.subject.sourceRevisionId } } });
    })).rejects.toThrow("OPERATIONS_CONTROL_RESULT_INVALID");
    await expect(runInAuthorizedDatabaseTransaction(f.context, (tx) => tx.operationalActionRequest.update({
      where: { id: f.requestId }, data: { requestHash: "e".repeat(64) },
    }))).rejects.toThrow();
    await runInAuthorizedDatabaseTransaction(f.context, async (tx) => {
      expect(await tx.$queryRawUnsafe("SELECT has_column_privilege(current_user, 'public.\"OperationalActionRequest\"', 'status', 'UPDATE') AS lifecycle, has_column_privilege(current_user, 'public.\"OperationalActionRequest\"', 'requestHash', 'UPDATE') AS identity"))
        .toEqual([{ lifecycle: true, identity: false }]);
    });
    await expect(runInAuthorizedDatabaseTransaction(f.context, async (tx) => {
      const reject = await prepareSuspiciousRevisionRejection(tx, { ...f.subject, requestId: f.requestId,
        requestedBy: f.admin.userId, reason: f.reason, correlationId: f.lease.correlationId });
      await new OperationalActionLifecycleRepository(tx).begin(f.lease);
      await tx.jobRun.update({ where: { id: f.lease.jobRunId }, data: { status: "FAILED" } });
      await reject();
    })).rejects.toThrow("SOURCE_OPERATION_REVIEW_INVALID");
    // Retire only this intentionally unexecuted fixture's lease after all
    // assertions. This is test cleanup, not operational request completion.
    await f.reliability.fail(f.lease, "SYNTHETIC_NEGATIVE_CLEANUP", false, 1);
  });

  it.each(["before-start", "before-commit"])("rolls cancellation %s back without propagating its private reason", async (mode) => {
    const f = await fixture(); const controller = new AbortController();
    const privateReason = "Synthetic private cancellation reason";
    const original = OperationalActionLifecycleRepository.prototype.succeedRejectedRevision;
    const spy = mode === "before-commit" ? vi.spyOn(OperationalActionLifecycleRepository.prototype, "succeedRejectedRevision")
      .mockImplementationOnce(async function (this: OperationalActionLifecycleRepository, lease, result) {
        const completed = await original.call(this, lease, result); controller.abort(privateReason); return completed;
      }) : null;
    if (mode === "before-start") controller.abort(privateReason);
    try { await expect(executeSuspiciousRejection(f.lease, controller.signal)).rejects.toThrow("OPERATIONS_CONTROL_EXECUTION_CANCELLED"); }
    finally { spy?.mockRestore(); }
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
      expect(await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: f.requestId } })).toMatchObject({ status: "REQUESTED", result: null });
      expect(await tx.sourceRevision.findUniqueOrThrow({ where: { id: f.subject.sourceRevisionId } })).toMatchObject({ status: "SUSPICIOUS" });
      expect(await tx.auditEvent.count({ where: { entityId: f.subject.sourceRevisionId, action: "operations-control.suspicious.rejected" } })).toBe(0);
    });
    await expect(executeSuspiciousRejection(f.lease)).resolves.toMatchObject({ action: "SUSPICIOUS_REJECT" });
    await f.reliability.complete(f.lease);
  });

  it.each(["freeze", "suspended", "tampered-analysis", "oversized-analysis", "oversized-policy", "malformed-policy"])("denies %s without business or lifecycle mutation", async (mode) => {
    const f = await fixture();
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
      if (mode === "freeze") await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } });
      if (mode === "suspended") await tx.project.update({ where: { id: f.subject.projectId }, data: { serviceState: "SUSPENDED" } });
      if (mode === "tampered-analysis") await tx.sourceRevision.update({ where: { id: f.subject.sourceRevisionId }, data: { safetyAnalysis: {} } });
      if (mode === "oversized-analysis") await tx.sourceRevision.update({ where: { id: f.subject.sourceRevisionId }, data: { safetyAnalysis: { syntheticMarker: "x".repeat(5000) } } });
      if (mode === "oversized-policy") await tx.sourceRevision.update({ where: { id: f.subject.sourceRevisionId }, data: { safetyPolicy: { syntheticMarker: "x".repeat(5000) } } });
      if (mode === "malformed-policy") await tx.sourceRevision.update({ where: { id: f.subject.sourceRevisionId }, data: { safetyPolicy: { allowEmpty: "synthetic-private-marker" } } });
    });
    await expect(executeSuspiciousRejection(f.lease)).rejects.toThrow(mode === "freeze" ? "DATA_SAFETY_JOBS_FROZEN"
      : mode === "suspended" ? "SOURCE_OPERATION_REVIEW_BLOCKED" : "SOURCE_REVISION_SAFETY_INVALID");
    await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
      expect(await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: f.requestId } })).toMatchObject({ status: "REQUESTED", result: null });
      expect(await tx.sourceRevision.findUniqueOrThrow({ where: { id: f.subject.sourceRevisionId } })).toMatchObject({ status: "SUSPICIOUS" });
      expect(await tx.source.findUniqueOrThrow({ where: { id: f.subject.sourceId } })).toMatchObject({ lastGoodRevisionId: f.subject.goodId });
    });
    await f.reliability.fail(f.lease, "SYNTHETIC_NEGATIVE_CLEANUP", false, 1);
  });
});
