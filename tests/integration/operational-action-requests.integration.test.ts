import { generateKeyPairSync, randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
import { lockOperationalOutboxLease, PrismaReliabilityRepository } from "../../src/modules/platform-operations/server.ts";
import { ReliabilityService } from "../../src/modules/platform-operations/index.ts";
import { createOutboxDrainDependencies, drainOutboxWithDependencies, getPgBoss, publishClaimedEvent, stopPgBoss } from "../../src/modules/platform-operations/worker.ts";
import { OUTBOX_DELIVERY_QUEUE, type OutboxDispatchJob } from "../../src/modules/platform-operations/domain/pg-boss.ts";
import { runReliabilityRetention } from "../../src/modules/platform-operations/infrastructure/retention-runtime.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import { captureSnapshotInput, createSnapshotStagedBuildServer } from "../../src/modules/snapshot-delivery/server.ts";
import { S3ObjectStorage } from "../../src/platform/storage/timeweb-s3-object-storage.ts";
import { defineSecretRef } from "../../src/platform/security/secret-ref.ts";
import { PrismaOperationsActionRepository } from "../../src/modules/operations-control/infrastructure/prisma-operations-action-repository.ts";

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

async function selectedStage(admin: PlatformAdminPrincipal, scope: { organizationId: string; projectId: string }) {
  await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const city = await tx.city.findFirstOrThrow({ select: { uid: true } });
    await tx.projectCatalogSubscription.upsert({ where: { organizationId_projectId: scope }, update: {},
      create: { ...scope, mode: "CURATED", cities: { create: { cityUid: city.uid } } } });
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
      update: { jobsFrozen: false, unfrozenAt: new Date() } });
  });
  const principal = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input" });
  const capture = await captureSnapshotInput(principal, { ...scope, idempotencyKey: `selected-${randomUUID()}`, schemaMinor: 0 });
  const keys = generateKeyPairSync("ed25519");
  vi.stubEnv("SYNTHETIC_SELECTED_PUBLISH_KEY", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
  const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
  const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
    expect(command).toBeInstanceOf(PutObjectCommand); return { ETag: "synthetic" } as never;
  });
  try {
    return await createSnapshotStagedBuildServer({ ...scope, storage: new S3ObjectStorage({ bucket: "synthetic", client }),
      keyId: "synthetic-selected", privateKeyRef: defineSecretRef("SYNTHETIC_SELECTED_PUBLISH_KEY"),
      trustSet: { currentKeyId: "synthetic-selected", nextKeyId: null, revokedKeyIds: [],
        publicKeys: { "synthetic-selected": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } } })(principal,
      { idempotencyKeyHash: capture.idempotencyKeyHash, requestHash: capture.requestHash });
  } finally { send.mockRestore(); client.destroy(); vi.unstubAllEnvs(); }
}

describe("actual admin durable operational requests under NOBYPASS", () => {
  it("pins explicit scoped completed stage, replays without private capability and rolls back invalid targets", async () => {
    const own = await fixture(); const first = await selectedStage(own.admin, own.scope);
    const second = await selectedStage(own.admin, own.scope);
    const foreign = await fixture(); const other = await selectedStage(foreign.admin, foreign.scope);
    const sibling = await runInPrincipalDatabaseTransaction(own.admin, async (tx) => {
      const project = await tx.project.create({ data: { organizationId: own.scope.organizationId,
        name: "Synthetic sibling", slug: `sibling-${own.suffix}` } });
      return { organizationId: own.scope.organizationId, projectId: project.id };
    });
    const siblingStage = await selectedStage(own.admin, sibling);
    const principal = createProjectJobPrincipal({ ...own.scope, jobName: "snapshot-input" });
    const unbound = await captureSnapshotInput(principal, { ...own.scope, idempotencyKey: `unbound-${own.suffix}`, schemaMinor: 0 });
    const request = { ...input(own.scope, `selected-publish-${own.suffix}`), action: "SNAPSHOT_PUBLISH" as const, buildInputId: first.buildInputId };
    const result = await requestOperationalAction(own.admin, request);
    await expect(requestOperationalAction(own.admin, request)).resolves.toEqual({ ...result, duplicate: true });
    await expect(requestOperationalAction(own.admin, { ...request, buildInputId: second.buildInputId }))
      .rejects.toThrow("OPERATIONS_CONTROL_IDEMPOTENCY_CONFLICT");
    await expect(requestOperationalAction(own.admin, { ...request, buildInputId: "" })).rejects.toThrow();
    await expect(runInPrincipalDatabaseTransaction(own.admin, (tx) => new PrismaOperationsActionRepository(tx).recordRequest({
      ...own.scope, action: "SNAPSHOT_PUBLISH", buildInputId: null, sourceId: null, sourceRevisionId: null,
      sourcePublishSequence: null, reason: null, idempotencyKey: `sql-null-${own.suffix}`, requestHash: "a".repeat(64),
      actorId: own.admin.userId, correlationId: own.admin.correlationId,
    }))).rejects.toThrow("OPERATIONS_CONTROL_REFERENCE_INVALID");
    for (const buildInputId of ["missing-stage", other.buildInputId, siblingStage.buildInputId, unbound.id]) {
      await expect(requestOperationalAction(own.admin, { ...request, buildInputId, idempotencyKey: `invalid-${buildInputId}` }))
        .rejects.toThrow("OPERATIONS_CONTROL_REFERENCE_INVALID");
    }
    await runInPrincipalDatabaseTransaction(own.admin, async (tx) => {
      expect(await tx.$queryRawUnsafe(`SELECT has_table_privilege(current_user, '"SnapshotArtifactStageReceipt"', 'SELECT') AS stage_read,
        has_column_privilege('ams_data_hub_worker', '"OperationalActionRequest"', 'buildInputId', 'UPDATE') AS target_write`))
        .toEqual([{ stage_read: false, target_write: false }]);
      const rows = await tx.operationalActionRequest.findMany({ where: own.scope }); expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: result.requestId, buildInputId: first.buildInputId, status: "REQUESTED" });
      const audit = await tx.auditEvent.findUniqueOrThrow({ where: { id: result.requestId } });
      expect(audit.afterMarker).toMatchObject({ buildInputId: first.buildInputId });
      expect(await tx.outboxEvent.count({ where: { organizationId: own.scope.organizationId } })).toBe(1);
      expect(await tx.auditEvent.count({ where: { organizationId: own.scope.organizationId } })).toBe(2);
      const event = await tx.outboxEvent.findUniqueOrThrow({ where: { id: rows[0]!.outboxEventId! } });
      expect(event.payload).toEqual({ schemaVersion: 1, ...own.scope, requestId: result.requestId, action: "SNAPSHOT_PUBLISH" });
    });
  }, 60_000);
  it("fences the full persisted operation lease across same-attempt takeover and expired-attempt reclaim", async () => {
    const { admin, scope, suffix } = await fixture();
    const request = await requestOperationalAction(admin, input(scope, `synthetic-fence-${suffix}`));
    const eventId = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const row = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: request.requestId } });
      if (!row.outboxEventId) throw new Error("SYNTHETIC_INTENT_MISSING");
      await tx.outboxEvent.update({ where: { id: row.outboxEventId }, data: { availableAt: new Date("1999-01-01T00:00:00.000Z") } });
      return row.outboxEventId;
    });
    let now = new Date("2000-01-01T00:00:01.000Z");
    const reliability = new ReliabilityService(new PrismaReliabilityRepository(), () => now);
    const lease = await reliability.claim(`operation-fence-${suffix}`, 300_000, [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD]);
    if (!lease || lease.outboxEventId !== eventId) throw new Error("SYNTHETIC_LEASE_MISSING");
    const expected = { ...scope, topic: OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD,
      payload: { schemaVersion: 1, ...scope, requestId: request.requestId, action: "SNAPSHOT_BUILD" } };
    const context = { principalKind: "project-job" as const, actorId: "operations-executor", ...scope,
      projectIds: [scope.projectId], correlationId: randomUUID() };
    const fence = (value: typeof lease, authorization = context, binding = expected) =>
      runInAuthorizedDatabaseTransaction(authorization, async (tx) => {
        await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text");
        return lockOperationalOutboxLease(tx, value, binding);
      });
    await expect(fence(lease)).resolves.toBeUndefined();
    for (const forged of [
      { ...lease, attempt: lease.attempt + 1 }, { ...lease, workerId: "synthetic-forged-worker" },
      { ...lease, jobRunId: "synthetic-forged-job" },
      { ...lease, correlationId: randomUUID() },
      { ...lease, payload: { ...lease.payload, requestId: "synthetic-forged-request" } },
      { ...lease, leaseAcquiredAt: new Date(now.getTime() + 1).toISOString() },
    ]) await expect(fence(forged)).rejects.toThrow("OUTBOX_OPERATION_LEASE_LOST");
    for (const denied of [
      { ...context, actorId: "snapshot-input" }, { ...context, projectIds: [] },
      { ...context, organizationId: "synthetic-other-org" },
      { ...context, projectIds: [scope.projectId, "synthetic-other-project"] },
      { ...context, projectIds: ["synthetic-other-project"] },
    ]) await expect(fence(lease, denied)).rejects.toThrow("OUTBOX_OPERATION_SCOPE_DENIED");
    await expect(fence(lease, context, { ...expected, payload: { ...expected.payload, projectId: "synthetic-other-project" } }))
      .rejects.toThrow("OUTBOX_OPERATION_LEASE_INVALID");
    await expect(fence(lease, context, { ...expected, payload: { ...expected.payload, requestId: "synthetic-other-request" } }))
      .rejects.toThrow("OUTBOX_OPERATION_LEASE_LOST");
    now = new Date("2000-01-01T00:00:02.000Z");
    const taken = await reliability.takeOver(lease, lease.workerId);
    if (!taken) throw new Error("SYNTHETIC_TAKEOVER_MISSING");
    expect(taken.attempt).toBe(lease.attempt); expect(taken.jobRunId).toBe(lease.jobRunId);
    await expect(fence(lease)).rejects.toThrow("OUTBOX_OPERATION_LEASE_LOST");
    await expect(fence(taken)).resolves.toBeUndefined();
    // Observe an actual PostgreSQL waiter, not a timing-only Promise assertion.
    let releaseFence!: () => void;
    let markHeld!: (pid: number) => void;
    const release = new Promise<void>((resolve) => { releaseFence = resolve; });
    const held = new Promise<number>((resolve) => { markHeld = resolve; });
    const holding = runInAuthorizedDatabaseTransaction(context, async (tx) => {
      await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text");
      await lockOperationalOutboxLease(tx, taken, expected);
      const [backend] = await tx.$queryRawUnsafe<{ pid: number }[]>("SELECT pg_backend_pid() AS pid");
      markHeld(backend!.pid);
      await release;
    });
    const blockerPid = await Promise.race([held, holding.then(() => { throw new Error("SYNTHETIC_FENCE_NOT_HELD"); })]);
    now = new Date("2000-01-01T00:00:03.000Z");
    let takeoverSettled = false;
    const transferring = reliability.takeOver(taken, taken.workerId).finally(() => { takeoverSettled = true; });
    let transferred: Awaited<ReturnType<typeof reliability.takeOver>> = null;
    try {
      let blocked = false;
      const deadline = Date.now() + 1500;
      while (!blocked && Date.now() < deadline) {
        blocked = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
          const [row] = await tx.$queryRawUnsafe<{ blocked: boolean }[]>(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND $1::integer = ANY(pg_blocking_pids(pid))) AS blocked", blockerPid);
          return row!.blocked;
        });
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true); expect(takeoverSettled).toBe(false);
    } finally { releaseFence(); await holding; transferred = await transferring; }
    if (!transferred) throw new Error("SYNTHETIC_TRANSFER_MISSING");
    await expect(fence(taken)).rejects.toThrow("OUTBOX_OPERATION_LEASE_LOST");
    await expect(fence(transferred)).resolves.toBeUndefined();
    now = new Date("2000-01-01T00:10:02.000Z");
    const reclaimed = await reliability.claim(`operation-reclaim-${suffix}`, 300_000, [expected.topic]);
    if (!reclaimed || reclaimed.outboxEventId !== eventId) throw new Error("SYNTHETIC_RECLAIM_MISSING");
    expect(reclaimed.attempt).toBe(2); expect(reclaimed.jobRunId).not.toBe(lease.jobRunId);
    await expect(fence(transferred)).rejects.toThrow("OUTBOX_OPERATION_LEASE_LOST");
    await expect(fence(reclaimed)).resolves.toBeUndefined();
    await reliability.complete(reclaimed);
    await expect(fence(reclaimed)).rejects.toThrow("OUTBOX_OPERATION_LEASE_LOST");
    await runInPrincipalDatabaseTransaction(admin, async (tx) =>
      expect(await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: request.requestId } })).toMatchObject({ status: "REQUESTED" }));
  });
  it("defers a real queued operational intent without settling its durable request", async () => {
    const { admin, scope, suffix } = await fixture();
    const request = await requestOperationalAction(admin, input(scope, `synthetic-reserved-${suffix}`));
    const eventId = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const row = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: request.requestId } });
      if (!row.outboxEventId) throw new Error("SYNTHETIC_INTENT_MISSING");
      await tx.outboxEvent.update({ where: { id: row.outboxEventId }, data: { availableAt: new Date("2000-01-01T00:00:00.000Z") } });
      return row.outboxEventId;
    });
    const reliability = new ReliabilityService(new PrismaReliabilityRepository(), () => new Date("2000-01-01T00:00:01.000Z"));
    const lease = await reliability.claim(`reserved-publisher-${suffix}`, 300_000, [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD]);
    expect(lease?.outboxEventId).toBe(eventId);
    if (!lease) throw new Error("SYNTHETIC_LEASE_MISSING");
    try {
      const boss = await getPgBoss();
      // Other suites legitimately leave queued jobs. Prioritize only this owned
      // real insertion; keep the actual queue fetch, worker and settlement path.
      const send = boss.send.bind(boss);
      const prioritized = vi.spyOn(boss, "send").mockImplementationOnce((name, data, options) =>
        send(name, data, { ...options, priority: 10_000 }));
      let queuedId: string | null;
      try { queuedId = await publishClaimedEvent(boss, lease); }
      finally { prioritized.mockRestore(); }
      expect(queuedId).not.toBeNull();
      if (!queuedId) throw new Error("SYNTHETIC_QUEUE_INSERT_MISSING");
      expect(await boss.getJobById<OutboxDispatchJob>(OUTBOX_DELIVERY_QUEUE, queuedId))
        .toMatchObject({ priority: 10_000, data: { event: { outboxEventId: eventId } } });
      await expect(drainOutboxWithDependencies({ workerId: `reserved-worker-${suffix}`, maxEvents: 1 }, createOutboxDrainDependencies(boss)))
        .resolves.toEqual({ claimed: 1, completed: 0, failed: 0 });
      await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        expect(await tx.outboxEvent.findUniqueOrThrow({ where: { id: eventId } }))
          .toMatchObject({ status: "PENDING", deferredAttempts: 1, lockedBy: null, lastErrorCode: "OUTBOX_EXECUTOR_RESERVED" });
        expect(await tx.jobRun.findUniqueOrThrow({ where: { id: lease.jobRunId } }))
          .toMatchObject({ status: "DEFERRED", safeErrorCode: "OUTBOX_EXECUTOR_RESERVED" });
        expect(await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: request.requestId } }))
          .toMatchObject({ status: "REQUESTED" });
      });
    } finally { await stopPgBoss(); }
  });
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
    await expect(requestOperationalAction(admin, { ...request, action: "SNAPSHOT_PUBLISH", buildInputId: "selected-stage" }))
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

  it("allows exact single-project reads and only lifecycle column writes, never a table-wide mutation grant", async () => {
    const { admin, scope, suffix } = await fixture();
    const request = await requestOperationalAction(admin, input(scope, `synthetic-${suffix}`));
    const context = { principalKind: "project-job" as const, actorId: "operations-executor", organizationId: scope.organizationId,
      projectIds: [scope.projectId], correlationId: "synthetic-operations-reader" };
    await runInAuthorizedDatabaseTransaction(context, async (tx) => {
      expect(await tx.operationalActionRequest.count({ where: { id: request.requestId } })).toBe(1);
      expect(await tx.$queryRawUnsafe("SELECT has_table_privilege(current_user, 'public.\"OperationalActionRequest\"', 'UPDATE') AS allowed"))
        .toEqual([{ allowed: false }]);
      expect(await tx.$queryRawUnsafe("SELECT has_column_privilege(current_user, 'public.\"OperationalActionRequest\"', 'status', 'UPDATE') AS lifecycle, has_column_privilege(current_user, 'public.\"OperationalActionRequest\"', 'outboxEventId', 'UPDATE') AS binding"))
        .toEqual([{ lifecycle: true, binding: false }]);
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
    const stage = await selectedStage(admin, scope);
    const source = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      expect(await tx.$queryRawUnsafe(`SELECT r.rolbypassrls,r.rolsuper,p.prosecdef,
        p.proconfig @> ARRAY['row_security=on'] AS "rowSecurity",
        has_table_privilege(current_user,'public."RawArtifactPutAttempt"','SELECT') AS "webJournalRead"
        FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
        WHERE p.oid='public.check_raw_artifact_put_receipt()'::regprocedure`))
        .toEqual([{ rolbypassrls: false, rolsuper: false, prosecdef: true, rowSecurity: true, webJournalRead: false }]);
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
        ...(action === "SNAPSHOT_PUBLISH" ? { buildInputId: stage.buildInputId } : {}),
        ...(action === "ACK_ROTATE" ? { ackRotationPhase: "STAGE" as const, ackCredentialVersion: 1 } : {}),
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

  it("protects unresolved durable requests from intent-only settlement while retaining replay and unrelated cleanup", async () => {
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
    const result = await runReliabilityRetention(); expect(result.deletedOutboxEvents).toBeGreaterThanOrEqual(1);
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      expect(await tx.outboxEvent.findUnique({ where: { id: ids[0]! } })).not.toBeNull();
      expect(await tx.outboxEvent.findUnique({ where: { id: ids[1]! } })).toBeNull();
      expect(await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: request.requestId } }))
        .toMatchObject({ id: request.requestId, ...scope, outboxEventId: ids[0], status: "REQUESTED" });
    });
    await expect(requestOperationalAction(admin, requestInput)).resolves.toEqual({ ...request, duplicate: true });
  });
});
