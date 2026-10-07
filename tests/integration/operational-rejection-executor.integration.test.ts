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
