import { generateKeyPairSync, randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

const evidence = vi.hoisted(() => ({ snapshotCuts: 0, snapshotRoles: 0, systemRoles: 0 }));
vi.mock("../../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = (context, execute, options) =>
    actual.runInAuthorizedDatabaseTransaction(context, async (tx) => {
      const worker = context.principalKind === "project-job" || context.principalKind === "system-job";
      const snapshot = ["snapshot-input", "snapshot-publication"].includes(context.actorId);
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
    return { admin, scope, intent, suffix };
  });
}

describe("actual combined source-worker snapshot capability", () => {
  it.each(["enabled", "disabled", "invalid"])("uses real pg-boss with %s snapshot registration", async (mode) => {
    const setup = await fixture(); const { scope } = setup; const controller = new AbortController();
    evidence.snapshotCuts = 0; evidence.snapshotRoles = 0; evidence.systemRoles = 0;
    const keys = generateKeyPairSync("ed25519"); const bucket = `synthetic-snapshot-${setup.suffix}`;
    vi.stubEnv("PROJECT_STORAGE_BINDINGS", JSON.stringify([{ ...scope, bucketRef: "SYNTHETIC_SNAPSHOT_BUCKET",
      endpointRef: "SYNTHETIC_SNAPSHOT_ENDPOINT", regionRef: "SYNTHETIC_SNAPSHOT_REGION",
      accessKeyIdRef: "SYNTHETIC_SNAPSHOT_ACCESS", secretAccessKeyRef: "SYNTHETIC_SNAPSHOT_SECRET" }]));
    vi.stubEnv("SYNTHETIC_SNAPSHOT_BUCKET", bucket); vi.stubEnv("SYNTHETIC_SNAPSHOT_ENDPOINT", "https://s3.twcstorage.ru");
    vi.stubEnv("SYNTHETIC_SNAPSHOT_REGION", "ru-1"); vi.stubEnv("SYNTHETIC_SNAPSHOT_ACCESS", "synthetic-snapshot-access");
    vi.stubEnv("SYNTHETIC_SNAPSHOT_SECRET", "synthetic-snapshot-secret");
    vi.stubEnv("SNAPSHOT_BUILD_ENABLED", mode === "disabled" ? "false" : "true");
    vi.stubEnv("PROJECT_SNAPSHOT_SIGNING_BINDINGS", mode === "enabled" ? JSON.stringify([{ ...scope, keyId: "synthetic",
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
        if (mode === "enabled") {
          expect(queueJobId).toBeDefined(); expect(evidence.snapshotRoles).toBeGreaterThan(0); expect(sdk).toHaveBeenCalledTimes(14);
          const inspect = await getPgBoss(); expect((await inspect.getJobById("outbox.dispatch", queueJobId!))?.state).toBe("completed");
        }
      }
      await runInPrincipalDatabaseTransaction(setup.admin, async (tx) => {
        expect((await tx.outboxEvent.findUniqueOrThrow({ where: { id: setup.intent.outboxEventId } })).status).toBe(mode === "enabled" ? "PROCESSED" : "PENDING");
        expect(await tx.deliveryRun.count({ where: scope })).toBe(mode === "enabled" ? 1 : 0);
        expect(await tx.projectCurrentSnapshotManifest.count({ where: scope })).toBe(mode === "enabled" ? 1 : 0);
        expect(await tx.runtimeHeartbeat.count({ where: { runtime: "source-worker", workerId } })).toBe(0);
        const jobs = await tx.jobRun.findMany({ where: { outboxEventId: setup.intent.outboxEventId } });
        expect(jobs).toHaveLength(mode === "enabled" ? 1 : 0);
        if (mode === "enabled") expect(jobs[0]).toMatchObject({ status: "SUCCESS", workerId });
      });
      if (mode !== "enabled") expect(sdk).not.toHaveBeenCalled();
    } finally {
      controller.abort(); clearTimeout(timer); completeSpy?.mockRestore(); fetchSpy?.mockRestore();
      await stopPgBoss(); sdk.mockRestore(); vi.unstubAllEnvs();
    }
  }, 90_000);
});
