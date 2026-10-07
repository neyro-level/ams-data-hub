import { generateKeyPairSync, randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

const evidence = vi.hoisted(() => ({ snapshotCuts: 0, snapshotRoles: 0, systemRoles: 0 }));
vi.mock("../../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = (context, execute, options) =>
    actual.runInAuthorizedDatabaseTransaction(context, async (tx) => {
      const worker = context.principalKind === "project-job" || context.principalKind === "system-job";
      const snapshot = ["snapshot-input", "snapshot-publication", "operations-executor"].includes(context.actorId);
      if (worker) {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]);
        if (snapshot) evidence.snapshotRoles++;
        if (context.principalKind === "system-job") evidence.systemRoles++;
      }
      if (snapshot) evidence.snapshotCuts++;
      try { return await execute(tx); } finally { if (snapshot) evidence.snapshotCuts--; }
    }, options);
  const system: typeof actual.runInSystemJobDatabaseTransaction = (input, execute) =>
    authorized(actual.createSystemJobDatabaseAuthorizationContext(input), execute);
  const principal: typeof actual.runInPrincipalDatabaseTransaction = (input, execute) =>
    authorized(actual.createDatabaseAuthorizationContext(input), execute);
  return { ...actual, runInAuthorizedDatabaseTransaction: authorized,
    runInSystemJobDatabaseTransaction: system, runInPrincipalDatabaseTransaction: principal };
});
import { Prisma } from "../../src/generated/prisma/client.ts";
import { runSourceWorker } from "../../src/infrastructure/source-worker-runtime.ts";
import { enqueueSourceGoodSnapshot } from "../../src/modules/ingestion-core/infrastructure/source-snapshot-intent.ts";
import { analyzeImportSafety, BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../../src/modules/ingestion-core/index.ts";
import { SOURCE_IMPORT_QUEUE } from "../../src/modules/ingestion-core/worker.ts";
import { getPgBoss, stopPgBoss } from "../../src/modules/platform-operations/worker.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { requestOperationalAction } from "../../src/modules/operations-control/server.ts";
import { OperationalActionLifecycleRepository } from "../../src/modules/operations-control/infrastructure/operational-action-lifecycle.ts";
import { createOperationalSnapshotBuildCapability } from "../../src/infrastructure/snapshot-build-capability.ts";
import { createProjectObjectStorageResolver } from "../../src/platform/storage/project-object-storage.ts";
import { ReliabilityService } from "../../src/modules/platform-operations/application/reliability-service.ts";
import { PrismaReliabilityRepository } from "../../src/modules/platform-operations/infrastructure/prisma-reliability-repository.ts";
import { OPERATIONAL_ACTION_TOPICS } from "../../src/modules/operations-control/index.ts";

async function fixture() {
  const suffix = randomUUID().slice(0, 8);
  const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-snapshot-worker", correlationId: randomUUID() };
  return runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const org = await tx.organization.create({ data: { name: "Synthetic snapshot worker", slug: `snapshot-worker-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic snapshot worker", slug: `snapshot-worker-${suffix}` } });
    const scope = { organizationId: org.id, projectId: project.id };
    await tx.projectCatalogSubscription.create({ data: { ...scope, mode: "CURATED",
      cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
      update: { jobsFrozen: false, unfrozenAt: new Date() } });
    const source = await tx.source.create({ data: { ...scope, sourceKey: "synthetic", name: "Synthetic snapshot worker",
      adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
      datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" }, enabled: false } });
    const target = { ...scope, sourceId: source.id }; const policy = { ...BOOTSTRAP_SOURCE_SAFETY_POLICY, allowEmpty: true };
    // Fixture-only empty GOOD. Actual producer facade enqueues inside this apply transaction.
    const analysis = analyzeImportSafety({ recordCount: 0, previousGoodRecordCount: null, invalidRecordCount: 0, issues: [] }, policy);
    const revision = await tx.sourceRevision.create({ data: { ...target, sourceVersion: source.version,
      adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey, profileVersion: source.profileVersion,
      safetyPolicy: policy, safetyAnalysis: JSON.parse(JSON.stringify(analysis)) as Prisma.InputJsonObject, recordCount: 0 } });
    await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence: 1,
      rawStorageKey: "synthetic-private/worker", rawArtifactHash: "a".repeat(64), rawByteCount: 1,
      normalizedContentHash: "b".repeat(64), completedAt: new Date() } });
    await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
    await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: revision.id } });
    const producer = createProjectJobPrincipal({ ...scope, jobName: "source-import", correlationId: randomUUID() });
    if (producer.kind !== "project-job") throw new Error("SYNTHETIC_PRINCIPAL_INVALID");
    const intent = await enqueueSourceGoodSnapshot(tx, producer, target, { revisionId: revision.id, sequence: 1 });
    // Prior suites may retain their own valid pending intents. Prioritize only
    // this fixture's event so the enabled runtime stops after its own success.
    await tx.outboxEvent.update({ where: { id: intent.outboxEventId }, data: { availableAt: new Date("2000-01-01T00:00:00.000Z") } });
    return { admin, scope, intent, suffix, requestId: null as string | null };
  });
}

async function operationalFixture() {
  const setup = await fixture();
  // Preserve the valid GOOD intent, but isolate this test's distinct operation.
  await runInPrincipalDatabaseTransaction(setup.admin, (tx) => tx.outboxEvent.update({
    where: { id: setup.intent.outboxEventId }, data: { availableAt: new Date("2050-01-01T00:00:00Z") },
  }));
  const accepted = await requestOperationalAction(setup.admin, { ...setup.scope, action: "SNAPSHOT_BUILD",
    sourceId: "", sourceRevisionId: "", reason: "", idempotencyKey: randomUUID() });
  const outboxEventId = await runInPrincipalDatabaseTransaction(setup.admin, async (tx) => {
    const row = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } });
    if (!row.outboxEventId) throw new Error("SYNTHETIC_BUILD_INTENT_MISSING");
    await tx.outboxEvent.update({ where: { id: row.outboxEventId }, data: { availableAt: new Date("1995-01-01T00:00:00Z") } });
    return row.outboxEventId;
  });
  return { ...setup, intent: { ...setup.intent, outboxEventId }, requestId: accepted.requestId };
}

describe("actual combined source-worker snapshot capability", () => {
  it.each([
    { mode: "enabled", operational: false }, { mode: "disabled", operational: false }, { mode: "invalid", operational: false },
    { mode: "enabled", operational: true }, { mode: "disabled", operational: true }, { mode: "invalid", operational: true },
    { mode: "recovery", operational: true },
  ])("uses real pg-boss with $mode registration (operational=$operational)", async ({ mode, operational }) => {
    const setup = operational ? await operationalFixture() : await fixture(); const { scope } = setup; const controller = new AbortController();
    const executes = mode === "enabled" || mode === "recovery";
    evidence.snapshotCuts = 0; evidence.snapshotRoles = 0; evidence.systemRoles = 0;
    const keys = generateKeyPairSync("ed25519"); const bucket = `synthetic-snapshot-${setup.suffix}`;
    vi.stubEnv("PROJECT_STORAGE_BINDINGS", JSON.stringify([{ ...scope, bucketRef: "SYNTHETIC_SNAPSHOT_BUCKET",
      endpointRef: "SYNTHETIC_SNAPSHOT_ENDPOINT", regionRef: "SYNTHETIC_SNAPSHOT_REGION",
      accessKeyIdRef: "SYNTHETIC_SNAPSHOT_ACCESS", secretAccessKeyRef: "SYNTHETIC_SNAPSHOT_SECRET" }]));
    vi.stubEnv("SYNTHETIC_SNAPSHOT_BUCKET", bucket); vi.stubEnv("SYNTHETIC_SNAPSHOT_ENDPOINT", "https://s3.twcstorage.ru");
    vi.stubEnv("SYNTHETIC_SNAPSHOT_REGION", "ru-1"); vi.stubEnv("SYNTHETIC_SNAPSHOT_ACCESS", "synthetic-snapshot-access");
    vi.stubEnv("SYNTHETIC_SNAPSHOT_SECRET", "synthetic-snapshot-secret");
    vi.stubEnv("SNAPSHOT_BUILD_ENABLED", mode === "disabled" ? "false" : "true");
    vi.stubEnv("PROJECT_SNAPSHOT_SIGNING_BINDINGS", executes ? JSON.stringify([{ ...scope, keyId: "synthetic",
      privateKeyRef: "SYNTHETIC_SNAPSHOT_PRIVATE", currentKeyId: "synthetic", nextKeyId: null, revokedKeyIds: [],
      publicKeyRefs: { synthetic: "SYNTHETIC_SNAPSHOT_PUBLIC" } }]) : "synthetic-invalid-registry");
    vi.stubEnv("SYNTHETIC_SNAPSHOT_PRIVATE", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    vi.stubEnv("SYNTHETIC_SNAPSHOT_PUBLIC", keys.publicKey.export({ format: "pem", type: "spki" }).toString());
    const sdk = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: unknown) => {
      expect(evidence.snapshotCuts).toBe(0); expect(command).toBeInstanceOf(PutObjectCommand);
      if (!(command instanceof PutObjectCommand)) throw new Error("SYNTHETIC_UNEXPECTED_IO");
      expect(command.input.Bucket).toBe(bucket); expect(command.input.Key).toMatch(new RegExp(`^snapshots/${scope.projectId}/[a-f0-9]{64}$`, "u"));
      expect(command.input.Body).toBeInstanceOf(Uint8Array); return { ETag: "synthetic-etag" } as never;
    });
    const workerId = `synthetic-snapshot-${setup.suffix}`; let queueJobId: string | undefined;
    let completeSpy: { mockRestore(): void } | undefined; let fetchSpy: { mockRestore(): void } | undefined;
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      if (mode === "recovery") {
        const reliability = new ReliabilityService(new PrismaReliabilityRepository(), () => new Date("1995-01-01T00:00:01Z"));
        const lease = await reliability.claim("synthetic-build-before-crash", 300_000, [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD]);
        if (!lease || lease.outboxEventId !== setup.intent.outboxEventId) throw new Error("SYNTHETIC_BUILD_LEASE_MISSING");
        const crash = vi.spyOn(OperationalActionLifecycleRepository.prototype, "succeedStagedSnapshot")
          .mockRejectedValueOnce(new Error("SYNTHETIC_BUILD_RESULT_CRASH"));
        try {
          const execute = createOperationalSnapshotBuildCapability(createProjectObjectStorageResolver());
          if (!execute) throw new Error("SYNTHETIC_BUILD_CAPABILITY_MISSING");
          await expect(execute(lease)).rejects.toThrow("SYNTHETIC_BUILD_RESULT_CRASH");
        } finally { crash.mockRestore(); }
        expect(sdk).toHaveBeenCalledTimes(14);
        await runInPrincipalDatabaseTransaction(setup.admin, async (tx) => {
          expect(await tx.snapshotArtifactStageReceipt.count({ where: scope })).toBe(1);
          expect(await tx.projectCurrentSnapshotManifest.count({ where: scope })).toBe(0);
          expect(await tx.deliveryRun.count({ where: scope })).toBe(0);
          await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } });
          await tx.project.update({ where: { id: scope.projectId }, data: { serviceState: "SUSPENDED" } });
        });
        // Registry remains valid at startup; no signing/storage references may be resolved during recovery.
        vi.stubEnv("SYNTHETIC_SNAPSHOT_PRIVATE", ""); vi.stubEnv("SYNTHETIC_SNAPSHOT_PUBLIC", "");
        vi.stubEnv("SYNTHETIC_SNAPSHOT_BUCKET", ""); vi.stubEnv("SYNTHETIC_SNAPSHOT_SECRET", "");
      }
      if (mode === "invalid") {
        await expect(runSourceWorker({ workerId, signal: controller.signal, pollIntervalMs: 10 }))
          .rejects.toThrow("PROJECT_SNAPSHOT_SIGNING_BINDINGS_INVALID");
        expect(evidence.systemRoles).toBe(0); // Failure precedes readiness/queue startup.
      } else {
        const boss = await getPgBoss(); const complete = boss.complete.bind(boss); const fetch = boss.fetch.bind(boss);
        completeSpy = vi.spyOn(boss, "complete").mockImplementation(async (name, id, data, options) => {
          const queued = name === "outbox.dispatch" && typeof id === "string" ? await boss.getJobById(name, id) : null;
          const result = await complete(name, id, data, options);
          if (queued && (queued.data as { event?: { outboxEventId?: string } }).event?.outboxEventId === setup.intent.outboxEventId) {
            expect(data).toEqual({ status: "success" }); queueJobId = queued.id;
            // Prove publication while this exact incarnation is still active,
            // not merely absence of a row that might never have existed.
            const deadline = Date.now() + 2000; let published = false;
            while (Date.now() < deadline && !published) {
              published = await runInPrincipalDatabaseTransaction(setup.admin, async (tx) =>
                await tx.runtimeHeartbeat.count({ where: { runtime: "source-worker", workerId } }) === 1);
              if (!published) await new Promise((resolve) => setTimeout(resolve, 10));
            }
            expect(published).toBe(true); controller.abort();
          }
          return result;
        });
        fetchSpy = vi.spyOn(boss, "fetch").mockImplementation(async (name, options) => {
          const result = await fetch(name, options); if (mode === "disabled" && name === SOURCE_IMPORT_QUEUE) controller.abort(); return result;
        });
        await expect(runSourceWorker({ workerId, signal: controller.signal, pollIntervalMs: 10 })).resolves.toEqual({ fetched: 0, completed: 0, failed: 0 });
        expect(evidence.systemRoles).toBeGreaterThan(0);
        if (executes) {
          expect(queueJobId).toBeDefined(); expect(evidence.snapshotRoles).toBeGreaterThan(0); expect(sdk).toHaveBeenCalledTimes(14);
          const inspect = await getPgBoss(); expect((await inspect.getJobById("outbox.dispatch", queueJobId!))?.state).toBe("completed");
        }
      }
      await runInPrincipalDatabaseTransaction(setup.admin, async (tx) => {
        expect((await tx.outboxEvent.findUniqueOrThrow({ where: { id: setup.intent.outboxEventId } })).status).toBe(executes ? "PROCESSED" : "PENDING");
        expect(await tx.deliveryRun.count({ where: scope })).toBe(executes && !operational ? 1 : 0);
        expect(await tx.projectCurrentSnapshotManifest.count({ where: scope })).toBe(executes && !operational ? 1 : 0);
        if (setup.requestId) {
          expect((await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: setup.requestId } })).status).toBe(executes ? "SUCCEEDED" : "REQUESTED");
          expect(await tx.snapshotArtifactStageReceipt.count({ where: scope })).toBe(executes ? 1 : 0);
          expect(await tx.snapshotBuildInput.count({ where: scope })).toBe(executes ? 1 : 0);
        }
        expect(await tx.runtimeHeartbeat.count({ where: { runtime: "source-worker", workerId } })).toBe(0);
        const jobs = await tx.jobRun.findMany({ where: { outboxEventId: setup.intent.outboxEventId } });
        expect(jobs).toHaveLength(mode === "recovery" ? 2 : executes ? 1 : 0);
        if (executes) expect(jobs.find((job) => job.status === "SUCCESS")).toMatchObject({ status: "SUCCESS", workerId });
        if (mode === "recovery") expect(jobs.find((job) => job.attempt === 1)).toMatchObject({ status: "FAILED", workerId: "synthetic-build-before-crash" });
      });
      if (!executes) expect(sdk).not.toHaveBeenCalled();
      // These deliberately unexecuted intents must remain PENDING, not be
      // manufactured as completed. After all disabled/invalid assertions,
      // move only this fixture's availability outside other suites' clocks.
      if (!executes) await runInPrincipalDatabaseTransaction(setup.admin, (tx) =>
        tx.outboxEvent.updateMany({ where: { id: setup.intent.outboxEventId, status: "PENDING" },
          data: { availableAt: new Date("2050-01-01T00:00:00.000Z") } }));
    } finally {
      controller.abort(); clearTimeout(timer); completeSpy?.mockRestore(); fetchSpy?.mockRestore();
      await stopPgBoss(); sdk.mockRestore(); vi.unstubAllEnvs();
    }
  }, 90_000);
});
