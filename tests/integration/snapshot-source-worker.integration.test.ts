import { generateKeyPairSync, randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

const evidence = vi.hoisted(() => ({ snapshotCuts: 0, snapshotRoles: 0, systemRoles: 0, webAdmissionCorrelations: new Set<string>() }));
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
      // Admission uses the real web identity; privileged fixture setup and
      // private diagnostic reads remain separate from runtime proof.
      if (context.principalKind === "platform-admin" && evidence.webAdmissionCorrelations.has(context.correlationId)) {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_web");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]);
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
import { getPgBoss, stopPgBoss, recordSourceWorkerHeartbeat } from "../../src/modules/platform-operations/worker.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { requestOperationalAction, createRawRetentionOperationReader } from "../../src/modules/operations-control/server.ts";
import { OperationalActionLifecycleRepository } from "../../src/modules/operations-control/infrastructure/operational-action-lifecycle.ts";
import { createOperationalSnapshotBuildCapability, createOperationalSnapshotPublishCapability, createOperationalSnapshotRollbackCapability } from "../../src/infrastructure/snapshot-build-capability.ts";
import { captureSnapshotInput, createSnapshotStagedBuildServer, createProjectSnapshotSigningResolver, createSelectedSnapshotPublicationServer, createRawRetentionSnapshotReader } from "../../src/modules/snapshot-delivery/server.ts";
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
    return { admin, scope, intent, suffix, revisionId: revision.id, requestId: null as string | null };
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
  it.each(["SNAPSHOT_PUBLISH", "SNAPSHOT_ROLLBACK"].flatMap((action) =>
    ["enabled", "disabled", "invalid", "recovery", "replay"].map((mode) => ({ action: action as "SNAPSHOT_PUBLISH" | "SNAPSHOT_ROLLBACK", mode }))))("$action registration with real pg-boss: $mode", async ({ action, mode }) => {
    const rollback = action === "SNAPSHOT_ROLLBACK";
    const setup = await fixture(); const { scope } = setup; const controller = new AbortController();
    const webCorrelationId = randomUUID(); evidence.webAdmissionCorrelations.add(webCorrelationId);
    const keys = generateKeyPairSync("ed25519"); const bucket = `synthetic-publish-${setup.suffix}`;
    const binding = { ...scope, keyId: "synthetic", privateKeyRef: "SYNTHETIC_SNAPSHOT_PRIVATE", currentKeyId: "synthetic", nextKeyId: null,
      revokedKeyIds: [] as string[], publicKeyRefs: { synthetic: "SYNTHETIC_SNAPSHOT_PUBLIC" } };
    vi.stubEnv("PROJECT_STORAGE_BINDINGS", JSON.stringify([{ ...scope, bucketRef: "SYNTHETIC_SNAPSHOT_BUCKET",
      endpointRef: "SYNTHETIC_SNAPSHOT_ENDPOINT", regionRef: "SYNTHETIC_SNAPSHOT_REGION",
      accessKeyIdRef: "SYNTHETIC_SNAPSHOT_ACCESS", secretAccessKeyRef: "SYNTHETIC_SNAPSHOT_SECRET" }]));
    vi.stubEnv("SYNTHETIC_SNAPSHOT_BUCKET", bucket); vi.stubEnv("SYNTHETIC_SNAPSHOT_ENDPOINT", "https://s3.twcstorage.ru");
    vi.stubEnv("SYNTHETIC_SNAPSHOT_REGION", "ru-1"); vi.stubEnv("SYNTHETIC_SNAPSHOT_ACCESS", "synthetic-publish-access");
    vi.stubEnv("SYNTHETIC_SNAPSHOT_SECRET", "synthetic-publish-secret");
    vi.stubEnv("PROJECT_SNAPSHOT_SIGNING_BINDINGS", JSON.stringify([binding]));
    vi.stubEnv("SYNTHETIC_SNAPSHOT_PRIVATE", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    vi.stubEnv("SYNTHETIC_SNAPSHOT_PUBLIC", keys.publicKey.export({ format: "pem", type: "spki" }).toString());
    vi.stubEnv("SNAPSHOT_BUILD_ENABLED", "false"); vi.stubEnv("SNAPSHOT_PUBLISH_ENABLED", !rollback && mode !== "disabled" ? "true" : "false");
    vi.stubEnv("SNAPSHOT_ROLLBACK_ENABLED", rollback && mode !== "disabled" ? "true" : "false");
    const objects = new Map<string, Uint8Array>(); let puts = 0; let gets = 0;
    const sdk = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: unknown) => {
      expect(evidence.snapshotCuts).toBe(0);
      if (command instanceof PutObjectCommand) {
        expect(command.input.Bucket).toBe(bucket); puts++;
        objects.set(command.input.Key!, Uint8Array.from(command.input.Body as Uint8Array)); return { ETag: "synthetic-publish" } as never;
      }
      if (command instanceof GetObjectCommand) {
        expect(command.input.Bucket).toBe(bucket); gets++; const bytes = objects.get(command.input.Key!);
        if (!bytes) throw new Error("SYNTHETIC_MISSING_OBJECT");
        return { ContentLength: bytes.length, ContentType: "application/octet-stream", LastModified: new Date(0),
          Body: { destroy() {}, async *[Symbol.asyncIterator]() { yield bytes; } } } as never;
      }
      throw new Error("SYNTHETIC_UNEXPECTED_IO"); // No HEAD, signer or PUT during PUBLISH.
    });
    const workerId = `synthetic-publish-${setup.suffix}`; let completeSpy: { mockRestore(): void } | undefined; let fetchSpy: { mockRestore(): void } | undefined;
    const timer = setTimeout(() => controller.abort(), 60_000); let queueJobId: string | undefined;
    try {
      const principal = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input" });
      const captured = await captureSnapshotInput(principal, { ...scope, schemaMinor: 0, idempotencyKey: randomUUID() });
      const stage = await createSnapshotStagedBuildServer({ ...scope, storage: createProjectObjectStorageResolver()(scope),
        ...createProjectSnapshotSigningResolver()(scope) })(principal, { idempotencyKeyHash: captured.idempotencyKeyHash, requestHash: captured.requestHash });
      expect(puts).toBe(14); expect(gets).toBe(0);
      if (rollback) {
        const publication = await createSelectedSnapshotPublicationServer({ ...scope, storage: createProjectObjectStorageResolver()(scope),
          getTrust: () => ({ currentKeyId: "synthetic", nextKeyId: null, revokedKeyIds: [], publicKeys: { synthetic: process.env.SYNTHETIC_SNAPSHOT_PUBLIC! } }) })(principal, { buildInputId: stage.buildInputId });
        await runInPrincipalDatabaseTransaction(createProjectJobPrincipal({ ...scope, jobName: "snapshot-publication" }), publication);
      }
      const accepted = await requestOperationalAction({ ...setup.admin, correlationId: webCorrelationId }, { ...scope, action, ...(rollback ? { sourcePublishSequence: stage.publishSequence } : { buildInputId: stage.buildInputId }),
        sourceId: "", sourceRevisionId: "", reason: "", idempotencyKey: randomUUID() });
      const readRetention = () => runInPrincipalDatabaseTransaction(createProjectJobPrincipal({ ...scope, jobName: "raw-artifact-retention" }), async (tx) => {
        const operations = await createRawRetentionOperationReader(tx).read(scope);
        const snapshot = await createRawRetentionSnapshotReader(tx).read(scope, operations);
        expect(snapshot.snapshotCoverage).toBe("COMPLETE");
        expect(snapshot.pinnedRevisionIds).toContain(setup.revisionId);
        return operations;
      });
      const pendingTargets = await readRetention();
      if (rollback) expect(pendingTargets.sourcePublishSequences).toContain(stage.publishSequence);
      else expect(pendingTargets.buildInputIds).toContain(stage.buildInputId);
      const eventId = await runInPrincipalDatabaseTransaction(setup.admin, async (tx) => {
        await tx.outboxEvent.update({ where: { id: setup.intent.outboxEventId }, data: { availableAt: new Date("2050-01-01T00:00:00Z") } });
        const request = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } });
        if (!request.outboxEventId) throw new Error("SYNTHETIC_PUBLISH_INTENT_MISSING");
        await tx.outboxEvent.update({ where: { id: request.outboxEventId }, data: { availableAt: new Date("1994-01-01T00:00:00Z") } });
        return request.outboxEventId;
      });
      // Runtime receives only public registry fields and no signing secret.
      const { keyId, privateKeyRef, ...publicBinding } = binding; void keyId; void privateKeyRef;
      if (!rollback) { vi.stubEnv("PROJECT_SNAPSHOT_SIGNING_BINDINGS", JSON.stringify([publicBinding])); vi.stubEnv("SYNTHETIC_SNAPSHOT_PRIVATE", ""); }
      if (mode === "recovery" || mode === "replay") {
        const reliability = new ReliabilityService(new PrismaReliabilityRepository(), () => new Date("1994-01-01T00:00:01Z"));
        const lease = await reliability.claim("synthetic-publish-before-crash", 300_000, [OPERATIONAL_ACTION_TOPICS[action]]);
        if (!lease || lease.outboxEventId !== eventId) throw new Error("SYNTHETIC_PUBLISH_LEASE_MISSING");
        const execute = rollback ? createOperationalSnapshotRollbackCapability(createProjectObjectStorageResolver()) : createOperationalSnapshotPublishCapability(createProjectObjectStorageResolver());
        if (!execute) throw new Error("SYNTHETIC_PUBLISH_CAPABILITY_MISSING");
        if (mode === "recovery") {
          const actualRollback = OperationalActionLifecycleRepository.prototype.succeedRolledBackSnapshot;
          const actualPublish = OperationalActionLifecycleRepository.prototype.succeedPublishedSnapshot;
          const crash = rollback
            ? vi.spyOn(OperationalActionLifecycleRepository.prototype, "succeedRolledBackSnapshot").mockImplementationOnce(async function (this: OperationalActionLifecycleRepository, pendingLease, result) {
              await actualRollback.call(this, pendingLease, result); throw new Error("SYNTHETIC_PUBLISH_AFTER_SUCCESS_CRASH");
            })
            : vi.spyOn(OperationalActionLifecycleRepository.prototype, "succeedPublishedSnapshot").mockImplementationOnce(async function (this: OperationalActionLifecycleRepository, pendingLease, result) {
              await actualPublish.call(this, pendingLease, result); throw new Error("SYNTHETIC_PUBLISH_AFTER_SUCCESS_CRASH");
            });
          try { await expect(execute(lease)).rejects.toThrow("SYNTHETIC_PUBLISH_AFTER_SUCCESS_CRASH"); } finally { crash.mockRestore(); }
          await runInPrincipalDatabaseTransaction(setup.admin, async (tx) => {
            expect(await tx.deliveryRun.count({ where: scope })).toBe(rollback ? 1 : 0); expect(await tx.projectCurrentSnapshotManifest.count({ where: scope })).toBe(rollback ? 1 : 0);
            expect((await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } })).status).toBe("RUNNING");
          });
        } else {
          await expect(execute(lease)).resolves.toMatchObject({ action, ...(rollback ? { sourcePublishSequence: stage.publishSequence } : { buildInputId: stage.buildInputId }) });
          await runInPrincipalDatabaseTransaction(setup.admin, async (tx) => {
            await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } });
            await tx.project.update({ where: { id: scope.projectId }, data: { serviceState: "SUSPENDED" } });
          });
          vi.stubEnv("SYNTHETIC_SNAPSHOT_PUBLIC", ""); vi.stubEnv("SYNTHETIC_SNAPSHOT_BUCKET", ""); vi.stubEnv("SYNTHETIC_SNAPSHOT_SECRET", "");
          vi.stubEnv("SYNTHETIC_SNAPSHOT_PRIVATE", "");
          vi.stubEnv("PROJECT_SNAPSHOT_SIGNING_BINDINGS", JSON.stringify([rollback
            ? { ...binding, keyId: "synthetic-next", currentKeyId: "synthetic-next", revokedKeyIds: ["synthetic"],
              publicKeyRefs: { ...binding.publicKeyRefs, "synthetic-next": "SYNTHETIC_SNAPSHOT_PUBLIC" } }
            : { ...publicBinding, revokedKeyIds: ["synthetic"] }]));
        }
        expect(gets).toBe(rollback ? 28 : 14);
      }
      if (mode === "disabled" || mode === "invalid") vi.stubEnv("PROJECT_SNAPSHOT_SIGNING_BINDINGS", "synthetic-invalid-registry");
      if (mode === "invalid") {
        await recordSourceWorkerHeartbeat(workerId);
        expect(await runInPrincipalDatabaseTransaction(setup.admin, (tx) => tx.runtimeHeartbeat.count({ where: { runtime: "source-worker", workerId } }))).toBe(1);
      }
      evidence.snapshotCuts = 0; evidence.snapshotRoles = 0; evidence.systemRoles = 0;
      if (mode === "invalid") {
        await expect(runSourceWorker({ workerId, signal: controller.signal, pollIntervalMs: 10 })).rejects.toThrow(rollback ? "PROJECT_SNAPSHOT_SIGNING_BINDINGS_INVALID" : "PROJECT_SNAPSHOT_TRUST_BINDINGS_INVALID");
        expect(evidence.systemRoles).toBe(1); // Exact-owner clear only, before queue startup.
      } else {
        const boss = await getPgBoss(); const complete = boss.complete.bind(boss); const fetch = boss.fetch.bind(boss);
        completeSpy = vi.spyOn(boss, "complete").mockImplementation(async (name, id, data, options) => {
          const queued = name === "outbox.dispatch" && typeof id === "string" ? await boss.getJobById(name, id) : null;
          const result = await complete(name, id, data, options);
          if (queued && (queued.data as { event?: { outboxEventId?: string } }).event?.outboxEventId === eventId) {
            expect(data).toEqual({ status: "success" }); queueJobId = queued.id;
            const deadline = Date.now() + 2000; let published = false;
            while (Date.now() < deadline && !published) {
              published = await runInPrincipalDatabaseTransaction(setup.admin, async (tx) =>
                await tx.runtimeHeartbeat.count({ where: { runtime: "source-worker", workerId } }) === 1);
              if (!published) await new Promise((resolve) => setTimeout(resolve, 10));
            }
            expect(published).toBe(true);
            controller.abort();
          }
          return result;
        });
        fetchSpy = vi.spyOn(boss, "fetch").mockImplementation(async (name, options) => {
          const result = await fetch(name, options); if (mode === "disabled" && name === SOURCE_IMPORT_QUEUE) controller.abort(); return result;
        });
        const summary = await runSourceWorker({ workerId, signal: controller.signal, pollIntervalMs: 10 });
        // The repeated-run database can contain unrelated source-import jobs.
        // Target completion is asserted below by its exact queue/event/request IDs.
        expect(summary.fetched).toBeGreaterThanOrEqual(summary.completed + summary.failed);
        if (mode !== "disabled") {
          expect(queueJobId).toBeDefined(); expect(evidence.snapshotRoles).toBeGreaterThan(0);
          expect((await (await getPgBoss()).getJobById("outbox.dispatch", queueJobId!))?.state).toBe("completed");
        }
      }
      const executed = !["disabled", "invalid"].includes(mode);
      expect(puts).toBe(rollback && executed ? 15 : 14);
      expect(gets).toBe((rollback ? 14 : 0) + (mode === "recovery" ? 28 : executed ? 14 : 0));
      await runInPrincipalDatabaseTransaction(setup.admin, async (tx) => {
        expect((await tx.outboxEvent.findUniqueOrThrow({ where: { id: eventId } })).status).toBe(executed ? "PROCESSED" : "PENDING");
        expect((await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } })).status).toBe(executed ? "SUCCEEDED" : "REQUESTED");
        expect(await tx.deliveryRun.count({ where: scope })).toBe((rollback ? 1 : 0) + (executed ? 1 : 0)); expect(await tx.projectCurrentSnapshotManifest.count({ where: scope })).toBe(rollback || executed ? 1 : 0);
        expect(await tx.snapshotBuildInput.count({ where: scope })).toBe(1); expect(await tx.snapshotArtifactStageReceipt.count({ where: scope })).toBe(1);
        expect(await tx.runtimeHeartbeat.count({ where: { runtime: "source-worker", workerId } })).toBe(0);
        const jobs = await tx.jobRun.findMany({ where: { outboxEventId: eventId } });
        expect(jobs).toHaveLength(mode === "recovery" || mode === "replay" ? 2 : executed ? 1 : 0);
        if (executed) expect(jobs.find((job) => job.status === "SUCCESS")).toMatchObject({ workerId });
        if (!executed) await tx.outboxEvent.update({ where: { id: eventId }, data: { availableAt: new Date("2050-01-01T00:00:00Z") } });
      });
      const finalTargets = await readRetention();
      if (executed) {
        expect(finalTargets.buildInputIds).toHaveLength(0);
        expect(finalTargets.sourcePublishSequences).toHaveLength(0);
        if (rollback) expect(await runInPrincipalDatabaseTransaction(setup.admin,
          (tx) => tx.snapshotRollbackReservation.count({ where: scope }))).toBe(1);
      }
    } finally { evidence.webAdmissionCorrelations.delete(webCorrelationId); controller.abort(); clearTimeout(timer); completeSpy?.mockRestore(); fetchSpy?.mockRestore(); await stopPgBoss(); sdk.mockRestore(); vi.unstubAllEnvs(); }
  }, 90_000);
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
    vi.stubEnv("SNAPSHOT_PUBLISH_ENABLED", "false");
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
        expect(evidence.systemRoles).toBe(1); // Exact-owner clear; failure precedes queue startup.
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
        const summary = await runSourceWorker({ workerId, signal: controller.signal, pollIntervalMs: 10 });
        expect(summary.fetched).toBeGreaterThanOrEqual(summary.completed + summary.failed);
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
