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
  const principal: typeof actual.runInPrincipalDatabaseTransaction = (input, execute) =>
    authorized(actual.createDatabaseAuthorizationContext(input), execute);
  const system: typeof actual.runInSystemJobDatabaseTransaction = (input, execute) =>
    authorized(actual.createSystemJobDatabaseAuthorizationContext(input), execute);
  return { ...actual, runInAuthorizedDatabaseTransaction: authorized, runInPrincipalDatabaseTransaction: principal,
    runInSystemJobDatabaseTransaction: system };
});
import { requestOperationalAction } from "../../src/modules/operations-control/server.ts";
import { OPERATIONAL_ACTION_TOPICS, type OperationalAction } from "../../src/modules/operations-control/index.ts";
import { PrismaReliabilityRepository } from "../../src/modules/platform-operations/server.ts";
import { runReliabilityRetention } from "../../src/modules/platform-operations/infrastructure/retention-runtime.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";

async function fixture() {
  const suffix = randomUUID().slice(0, 8);
  const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: `synthetic-operations-${suffix}`, correlationId: randomUUID() };
  const scope = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const org = await tx.organization.create({ data: { name: "Synthetic operations", slug: `operations-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic operations", slug: `operations-${suffix}` } });
    return { organizationId: org.id, projectId: project.id };
  });
  return { admin, scope, suffix };
}
function input(scope: { organizationId: string; projectId: string }, key: string) {
  return { ...scope, action: "SNAPSHOT_BUILD" as const, sourceId: "", sourceRevisionId: "", reason: "", idempotencyKey: key };
}

describe("actual admin durable operational requests under NOBYPASS", () => {
  it.each(["foreign-org", "foreign-project", "wrong-topic", "extra-private-field", "missing-intent", "premature-running"])(
    "rolls back a directly forged %s request/intent binding at the database boundary", async (mode) => {
      const own = await fixture(); const foreign = await fixture();
      await expect(runInPrincipalDatabaseTransaction(own.admin, async (tx) => {
        const audit = await tx.auditEvent.create({ data: { organizationId: own.scope.organizationId,
          actorType: "USER", actorId: own.admin.userId, action: OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD,
          entityType: "Project", entityId: own.scope.projectId, source: "synthetic-binding-guard", correlationId: randomUUID() } });
        const payload = { schemaVersion: 1, ...own.scope, requestId: audit.id, action: "SNAPSHOT_BUILD",
          ...(mode === "foreign-project" ? { projectId: foreign.scope.projectId } : {}),
          ...(mode === "extra-private-field" ? { reason: "Synthetic private marker" } : {}) };
        const event = await tx.outboxEvent.create({ data: {
          organizationId: mode === "foreign-org" ? foreign.scope.organizationId : own.scope.organizationId,
          topic: mode === "wrong-topic" ? OPERATIONAL_ACTION_TOPICS.SNAPSHOT_PUBLISH : OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD,
          payload, correlationId: randomUUID(),
        } });
        await tx.operationalActionRequest.create({ data: { id: audit.id, ...own.scope, action: "SNAPSHOT_BUILD",
          status: mode === "premature-running" ? "RUNNING" : "REQUESTED", requestedBy: own.admin.userId,
          requestHash: "a".repeat(64), outboxEventId: mode === "missing-intent" ? null : event.id,
        } });
      })).rejects.toThrow("OPERATIONS_CONTROL_INTENT_INVALID");
      await runInPrincipalDatabaseTransaction(own.admin, async (tx) => {
        expect(await tx.operationalActionRequest.count({ where: own.scope })).toBe(0);
        expect(await tx.auditEvent.count({ where: { organizationId: own.scope.organizationId } })).toBe(0);
        expect(await tx.outboxEvent.count({ where: { organizationId: { in: [own.scope.organizationId, foreign.scope.organizationId] } } })).toBe(0);
      });
    });

  it("concurrently replays one stable request with one exact IDs-only intent and rejects conflicts", async () => {
    const { admin, scope, suffix } = await fixture(); const request = input(scope, `synthetic-${suffix}`);
    const results = await Promise.all([requestOperationalAction(admin, request), requestOperationalAction(admin, request)]);
    expect(results[0]!.requestId).toBe(results[1]!.requestId);
    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    await expect(requestOperationalAction(admin, { ...request, action: "SNAPSHOT_PUBLISH" }))
      .rejects.toThrow("OPERATIONS_CONTROL_IDEMPOTENCY_CONFLICT");
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const rows = await tx.operationalActionRequest.findMany({ where: scope }); expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: results[0]!.requestId, ...scope, status: "REQUESTED", requestedBy: admin.userId });
      if (!rows[0]!.outboxEventId) throw new Error("SYNTHETIC_INTENT_MISSING");
      const event = await tx.outboxEvent.findUniqueOrThrow({ where: { id: rows[0]!.outboxEventId } });
      expect(event.payload).toEqual({ schemaVersion: 1, ...scope, requestId: rows[0]!.id, action: "SNAPSHOT_BUILD" });
      expect(event.topic).toBe(OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD);
      expect(await tx.outboxEvent.count({ where: { organizationId: scope.organizationId } })).toBe(1);
      expect(await tx.auditEvent.count({ where: { id: rows[0]!.id, organizationId: scope.organizationId } })).toBe(1);
    });
  });

  it("rolls audit, durable row and both idempotency markers back if enqueue fails", async () => {
    const { admin, scope, suffix } = await fixture();
    const enqueue = vi.spyOn(PrismaReliabilityRepository.prototype, "enqueueEvent")
      .mockRejectedValueOnce(new Error("SYNTHETIC_ENQUEUE_FAILURE"));
    try { await expect(requestOperationalAction(admin, input(scope, `synthetic-${suffix}`))).rejects.toThrow("SYNTHETIC_ENQUEUE_FAILURE"); }
    finally { enqueue.mockRestore(); }
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      expect(await tx.operationalActionRequest.count({ where: scope })).toBe(0);
      expect(await tx.outboxEvent.count({ where: { organizationId: scope.organizationId } })).toBe(0);
      expect(await tx.auditEvent.count({ where: { organizationId: scope.organizationId } })).toBe(0);
      expect(await tx.idempotencyKey.count({ where: { organizationId: scope.organizationId } })).toBe(0);
    });
    await expect(requestOperationalAction(admin, input(scope, `synthetic-${suffix}`))).resolves.toMatchObject({ duplicate: false });
  });

  it("allows only an exact single-project executor to read and gives no premature runtime write grant", async () => {
    const { admin, scope, suffix } = await fixture();
    const request = await requestOperationalAction(admin, input(scope, `synthetic-${suffix}`));
    const context = { principalKind: "project-job" as const, actorId: "operations-executor", organizationId: scope.organizationId,
      projectIds: [scope.projectId], correlationId: "synthetic-operations-reader" };
    await runInAuthorizedDatabaseTransaction(context, async (tx) => {
      expect(await tx.operationalActionRequest.count({ where: { id: request.requestId } })).toBe(1);
      expect(await tx.$queryRawUnsafe("SELECT has_table_privilege(current_user, 'public.\"OperationalActionRequest\"', 'UPDATE') AS allowed"))
        .toEqual([{ allowed: false }]);
      expect(await tx.$queryRawUnsafe("SELECT has_table_privilege('ams_data_hub_backup', 'public.\"OperationalActionRequest\"', 'SELECT') AS readable, has_table_privilege('ams_data_hub_backup', 'public.\"OperationalActionRequest\"', 'UPDATE') AS mutable"))
        .toEqual([{ readable: true, mutable: false }]);
    });
    for (const denied of [
      { ...context, projectIds: [] }, { ...context, projectIds: "*" as const },
      { ...context, projectIds: [scope.projectId, "synthetic-other-project"] },
      { ...context, organizationId: "synthetic-other-org" },
      { ...context, projectIds: ["synthetic-other-project"] },
      { ...context, actorId: "snapshot-input" }, { ...context, principalKind: "job" as const },
    ]) {
      await runInAuthorizedDatabaseTransaction(denied, async (tx) =>
        expect(await tx.operationalActionRequest.count({ where: { id: request.requestId } })).toBe(0));
    }
  });

  it("persists all six exact action discriminators without moving private review evidence into intents", async () => {
    const { admin, scope, suffix } = await fixture();
    const source = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const row = await tx.source.create({ data: { ...scope, sourceKey: "synthetic-review", name: "Synthetic review",
        adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "default-v1", profileVersion: "1.0.0",
        datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" } } });
      const revision = await tx.sourceRevision.create({ data: { ...scope, sourceId: row.id, sourceVersion: row.version,
        adapterKey: row.adapterKey, adapterVersion: row.adapterVersion, profileKey: row.profileKey, profileVersion: row.profileVersion,
        safetyPolicy: {}, rawStorageKey: "synthetic-private/review", rawArtifactHash: "a".repeat(64), rawByteCount: 0,
        normalizedContentHash: "b".repeat(64) } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED" } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "SUSPICIOUS" } });
      return { sourceId: row.id, sourceRevisionId: revision.id };
    });
    const requestIds = new Map<OperationalAction, string>();
    for (const action of Object.keys(OPERATIONAL_ACTION_TOPICS) as Exclude<OperationalAction, "RUN_SOURCE">[]) {
      const review = action.startsWith("SUSPICIOUS_");
      const result = await requestOperationalAction(admin, { ...input(scope, `synthetic-${suffix}-${action}`), action,
        ...(action === "SNAPSHOT_ROLLBACK" ? { sourcePublishSequence: 1 } : {}),
        ...(review ? { ...source, reason: "Synthetic private review evidence" } : {}) });
      requestIds.set(action, result.requestId);
      await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        const row = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: result.requestId } });
        expect(row.action).toBe(action); expect(row.status).toBe("REQUESTED");
        if (!row.outboxEventId) throw new Error("SYNTHETIC_INTENT_MISSING");
        const intent = await tx.outboxEvent.findUniqueOrThrow({ where: { id: row.outboxEventId } });
        expect(intent.topic).toBe(OPERATIONAL_ACTION_TOPICS[action]);
        expect(intent.payload).toEqual({ schemaVersion: 1, ...scope, requestId: result.requestId, action });
      });
    }
    // Actual allowed revision transition; this is replay admission, not proof
    // of the future operational reject executor.
    await runInPrincipalDatabaseTransaction(admin, (tx) => tx.sourceRevision.update({
      where: { id: source.sourceRevisionId }, data: { status: "REJECTED" },
    }));
    for (const action of ["SUSPICIOUS_APPROVE", "SUSPICIOUS_REJECT"] as const) {
      const repeated = { ...input(scope, `synthetic-${suffix}-${action}`), action, ...source,
        reason: "Synthetic private review evidence" };
      await expect(requestOperationalAction(admin, repeated)).resolves.toEqual({ requestId: requestIds.get(action), duplicate: true });
      await expect(requestOperationalAction(admin, { ...repeated, idempotencyKey: `new-${suffix}-${action}` }))
        .rejects.toThrow("OPERATIONS_CONTROL_REFERENCE_INVALID");
    }
  });

  it("retains durable request/replay while actual NOBYPASS retention deletes its settled and unrelated intents", async () => {
    const { admin, scope, suffix } = await fixture(); const requestInput = input(scope, `synthetic-retention-${suffix}`);
    const request = await requestOperationalAction(admin, requestInput);
    const ids = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const row = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: request.requestId } });
      if (!row.outboxEventId) throw new Error("SYNTHETIC_INTENT_MISSING");
      // Terminal metadata setup only: no operational executor is claimed here.
      await tx.outboxEvent.update({ where: { id: row.outboxEventId },
        data: { status: "PROCESSED", processedAt: new Date("2000-01-01T00:00:00.000Z") } });
      const unrelated = await tx.outboxEvent.create({ data: { organizationId: scope.organizationId,
        topic: "synthetic.unrelated.retention", payload: {}, status: "PROCESSED",
        processedAt: new Date("2000-01-01T00:00:00.000Z"), correlationId: randomUUID() } });
      return [row.outboxEventId, unrelated.id];
    });
    const result = await runReliabilityRetention(); expect(result.deletedOutboxEvents).toBeGreaterThanOrEqual(2);
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      expect(await tx.outboxEvent.count({ where: { id: { in: ids } } })).toBe(0);
      expect(await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: request.requestId } }))
        .toMatchObject({ id: request.requestId, ...scope, outboxEventId: null });
    });
    await expect(requestOperationalAction(admin, requestInput)).resolves.toEqual({ ...request, duplicate: true });
  });
});
