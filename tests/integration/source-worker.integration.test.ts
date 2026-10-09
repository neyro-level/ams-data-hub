import { generateKeyPairSync, randomUUID } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { snapshotManifestV1Schema } from "@ams-data-hub/snapshot-verifier";
import { describe, expect, it, vi } from "vitest";
const gateway = vi.hoisted(() => vi.fn());
vi.mock("../../src/platform/http/safe-outbound.ts", async (original) => ({
  ...await original<typeof import("../../src/platform/http/safe-outbound.ts")>(), safeOutboundStream: gateway,
}));
import { runSourceWorker } from "../../src/infrastructure/source-worker-runtime.ts";
import { sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import { BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../../src/modules/ingestion-core/index.ts";
import { catalogSubscriptionCommands } from "../../src/modules/shared-catalog/server.ts";
import { projectPublicContactCommands, projectUrlRegistryCommands } from "../../src/modules/project-state/server.ts";
import { SOURCE_IMPORT_QUEUE } from "../../src/modules/ingestion-core/worker.ts";
import { getPgBoss, stopPgBoss } from "../../src/modules/platform-operations/worker.ts";
import { createSnapshotAckService } from "../../src/modules/snapshot-delivery/application/snapshot-ack.ts";
import { PrismaSnapshotDeliveryRepository } from "../../src/modules/snapshot-delivery/server.ts";
import type { PlatformAdminPrincipal, PrincipalContext } from "../../src/platform/authorization/principal.ts";
import * as database from "../../src/platform/database/transaction.ts";
import type { DatabaseTransaction } from "../../src/platform/database/transaction.ts";

describe("native source-worker queue to persisted import", () => {
  it("reconciles native schedules, executes GOOD on a real cron tick and retries FAILED without replacing Last Good", async () => {
    const suffix = randomUUID().slice(0, 8);
    const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-worker-admin", correlationId: randomUUID() };
    const scope = await database.runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const org = await tx.organization.create({ data: { name: "Synthetic worker", slug: `worker-${suffix}` } });
      const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic worker", slug: `worker-${suffix}` } });
      await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
        update: { jobsFrozen: false, unfrozenAt: new Date() } });
      return { organizationId: org.id, projectId: project.id };
    });
    const feedRef = `SYNTHETIC_WORKER_FEED_${suffix.toUpperCase()}`;
    const policy = await database.runInPrincipalDatabaseTransaction(admin, (tx) => tx.sourceSafetyPolicy.create({
      data: { ...scope, policy: { ...BOOTSTRAP_SOURCE_SAFETY_POLICY, deactivationEnabled: true } },
    }));
    const source = await sourceRegistryCommands.createSource(admin, { ...scope, sourceKey: "synthetic", name: "Synthetic worker",
      endpointCredentialRef: feedRef, adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
      datasetType: "MIXED_REALTY", transportType: "HTTPS_XML", sharingPolicy: "PROJECT_ONLY", schedulePolicy: { mode: "MANUAL_ONLY" },
      safetyPolicyId: policy.id, expectedNamespace: "", expectedProducer: "" });
    const target = { ...scope, sourceId: source.sourceId };
    await sourceRegistryCommands.setSourceEnabled(admin, { ...target, version: source.version, enabled: true });
    await catalogSubscriptionCommands.replaceProjectSubscription(admin, { ...scope, version: 0, mode: "ALL_SHARED",
      cityUids: ["01M41T6Q04BADHXSERJHZFXKCH"], selections: [] });
    await database.runInPrincipalDatabaseTransaction(admin, (tx) =>
      createSnapshotAckService({ repository: new PrismaSnapshotDeliveryRepository(tx), now: () => new Date() })
        .initializeCredential({ ...scope, token: `synthetic-worker-ack-${randomUUID()}` }));
    vi.stubEnv(feedRef, "https://synthetic.example.invalid/worker.xml");
    vi.stubEnv("PROJECT_STORAGE_BINDINGS", JSON.stringify([{ ...scope, bucketRef: "SYNTHETIC_WORKER_BUCKET", endpointRef: "SYNTHETIC_WORKER_ENDPOINT",
      regionRef: "SYNTHETIC_WORKER_REGION", accessKeyIdRef: "SYNTHETIC_WORKER_ACCESS", secretAccessKeyRef: "SYNTHETIC_WORKER_SECRET" }]));
    vi.stubEnv("SYNTHETIC_WORKER_BUCKET", `synthetic-worker-${suffix}`); vi.stubEnv("SYNTHETIC_WORKER_ENDPOINT", "https://s3.twcstorage.ru");
    vi.stubEnv("SYNTHETIC_WORKER_REGION", "ru-1"); vi.stubEnv("SYNTHETIC_WORKER_ACCESS", "synthetic-worker-access");
    vi.stubEnv("SYNTHETIC_WORKER_SECRET", "synthetic-worker-secret");
    const signing = generateKeyPairSync("ed25519");
    vi.stubEnv("SYNTHETIC_WORKER_SIGNING_PRIVATE", signing.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    vi.stubEnv("SYNTHETIC_WORKER_SIGNING_PUBLIC", signing.publicKey.export({ format: "pem", type: "spki" }).toString());
    vi.stubEnv("PROJECT_SNAPSHOT_SIGNING_BINDINGS", JSON.stringify([{ ...scope, keyId: "synthetic-worker-key",
      privateKeyRef: "SYNTHETIC_WORKER_SIGNING_PRIVATE", currentKeyId: "synthetic-worker-key", nextKeyId: null,
      revokedKeyIds: [], publicKeyRefs: { "synthetic-worker-key": "SYNTHETIC_WORKER_SIGNING_PUBLIC" } }]));
    vi.stubEnv("SNAPSHOT_BUILD_ENABLED", "false");
    vi.stubEnv("SNAPSHOT_PUBLISH_ENABLED", "false"); vi.stubEnv("SNAPSHOT_ROLLBACK_ENABLED", "false");
    vi.stubEnv("SNAPSHOT_WEBHOOK_ENABLED", "false");
    const objects = new Map<string, Uint8Array>(); const contentTypes = new Map<string, string>();
    let uploads = 0; let scopedReads = 0;
    const sdk = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        const chunks: Uint8Array[] = [];
        if (command.input.Body instanceof Uint8Array) chunks.push(command.input.Body);
        else for await (const chunk of command.input.Body as AsyncIterable<Uint8Array>) chunks.push(Uint8Array.from(chunk));
        const bytes = Uint8Array.from(Buffer.concat(chunks)); uploads += bytes.length; objects.set(command.input.Key!, bytes);
        contentTypes.set(command.input.Key!, command.input.ContentType!);
        return { ETag: "synthetic" } as never;
      }
      if (!(command instanceof HeadObjectCommand) && !(command instanceof GetObjectCommand))
        throw new Error("SYNTHETIC_S3_OPERATION_DENIED");
      const bytes = objects.get(command.input.Key!);
      if (!bytes) throw { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } };
      return { ContentLength: bytes.length, ContentType: contentTypes.get(command.input.Key!), LastModified: new Date(0), ETag: "synthetic",
        ...(command instanceof GetObjectCommand
          ? { Body: { async *[Symbol.asyncIterator]() { yield bytes; }, destroy: vi.fn() } }
          : {}) } as never;
    });
    const originalPrincipal = database.runInPrincipalDatabaseTransaction;
    const role = vi.spyOn(database, "runInPrincipalDatabaseTransaction").mockImplementation(async <T>(principal: PrincipalContext,
      execute: (tx: DatabaseTransaction) => Promise<T>) => originalPrincipal(principal, async (tx) => {
      if (principal.kind === "project-job") {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user")).toEqual([{ rolbypassrls: false }]);
        scopedReads++;
      }
      return execute(tx);
    }));
    const originalSystem = database.runInSystemJobDatabaseTransaction;
    const schedulerRole = vi.spyOn(database, "runInSystemJobDatabaseTransaction").mockImplementation(async (context, execute) =>
      originalSystem(context, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user")).toEqual([{ rolbypassrls: false }]);
        return execute(tx);
      }));
    try {
      const baselineXml = '<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06"><offer internal-id="one"><category>квартира</category><type>продажа</type><price><value>1000</value><currency>RUB</currency></price><location><locality-name>Тестоград</locality-name><address>ул. Публичная, 1</address><latitude>47.0001</latitude><longitude>39.0001</longitude></location></offer></realty-feed>';
      const baselineBytes = new TextEncoder().encode(baselineXml);
      gateway.mockResolvedValue({ status: 200, contentType: "application/xml", contentLength: baselineBytes.length,
        finalUrl: new URL(process.env[feedRef]!), body: (async function* () { yield baselineBytes; })(), close: vi.fn() });
      const baselineBoss = await getPgBoss();
      await baselineBoss.createQueue(SOURCE_IMPORT_QUEUE, { policy: "exclusive", retryLimit: 3, retryDelay: 30 });
      const baselineJobId = await baselineBoss.send(SOURCE_IMPORT_QUEUE, { schemaVersion: 1, ...target, trigger: "MANUAL" });
      const baselineController = new AbortController(); const baselineComplete = baselineBoss.complete.bind(baselineBoss);
      const baselineCompletion = vi.spyOn(baselineBoss, "complete").mockImplementation(async (name, id, data, options) => {
        const result = await baselineComplete(name, id, data, options);
        if (name === SOURCE_IMPORT_QUEUE && id === baselineJobId) baselineController.abort();
        return result;
      });
      try {
        expect((await runSourceWorker({ workerId: `synthetic-baseline-${suffix}`, signal: baselineController.signal,
          pollIntervalMs: 10 })).completed).toBeGreaterThanOrEqual(1);
      } finally { baselineCompletion.mockRestore(); await stopPgBoss(); }
      const identity = await database.runInPrincipalDatabaseTransaction(admin, (tx) =>
        tx.inventoryIdentity.findFirstOrThrow({ where: target }));
      await projectPublicContactCommands.replaceProjectPublicContact(admin, { ...scope, version: 0,
        phone: "+70000000077", email: "", addressPublic: "", messengers: [], hours: "" });
      await projectUrlRegistryCommands.replaceProjectUrlPolicy(admin, { ...scope, version: 0, policyKey: "synthetic-worker",
        pathTemplates: [{ entityType: "INVENTORY", template: "/inventory/{slug}" }], reservedNamespaces: [] });
      const url = await projectUrlRegistryCommands.createProjectUrlEntry(admin, { ...scope, entityType: "INVENTORY",
        entityUid: identity.uid, slug: identity.externalOfferId, canonicalPath: `/inventory/${identity.externalOfferId}` });
      await projectUrlRegistryCommands.publishProjectUrlEntry(admin, { ...scope, urlEntryId: url.urlEntryId, version: url.version });
      await database.runInPrincipalDatabaseTransaction(admin, async (tx) => {
        await tx.outboxEvent.updateMany({ where: { organizationId: scope.organizationId, topic: "snapshot.build.request" },
          data: { availableAt: new Date(Date.now() + 60 * 60_000) } });
        await tx.source.update({ where: { id: target.sourceId },
          data: { schedulePolicy: { mode: "SCHEDULED", cadenceMinutes: 60 },
            lastAttemptAt: new Date(Date.now() - 61 * 60_000), updatedAt: new Date(Date.now() - 61 * 60_000) } });
      });
      vi.stubEnv("SNAPSHOT_BUILD_ENABLED", "true");
      const execute = async (xml: string, expected: "completed" | "retry") => {
        const bytes = new TextEncoder().encode(xml);
        gateway.mockResolvedValue({ status: 200, contentType: "application/xml", contentLength: bytes.length,
          finalUrl: new URL(process.env[feedRef]!), body: (async function* () { yield bytes; })(), close: vi.fn() });
        const boss = await getPgBoss();
        await boss.createQueue(SOURCE_IMPORT_QUEUE, { policy: "exclusive", retryLimit: 3, retryDelay: 30 });
        let jobId: string | null = null; let snapshotCompleted = false;
        if (expected === "completed") {
          await boss.schedule(SOURCE_IMPORT_QUEUE, "*/5 * * * *", { schemaVersion: 1, ...target, sourceId: "deleted-synthetic", trigger: "SCHEDULED" },
            { key: "deleted-synthetic", singletonKey: "deleted-synthetic", tz: "UTC" });
        } else {
          await database.runInPrincipalDatabaseTransaction(admin, (tx) => tx.source.update({ where: { id: target.sourceId },
            data: { schedulePolicy: { mode: "MANUAL_ONLY" } } }));
          jobId = await boss.send(SOURCE_IMPORT_QUEUE, { schemaVersion: 1, ...target, trigger: "MANUAL" }, { singletonKey: target.sourceId });
          expect(jobId).toEqual(expect.any(String));
        }
        const controller = new AbortController(); const complete = boss.complete.bind(boss); const fail = boss.fail.bind(boss);
        const timeout = setTimeout(() => controller.abort(), 380_000);
        const completed = vi.spyOn(boss, "complete").mockImplementation(async (name, id, data, options) => {
          const queued = typeof name === "string" && typeof id === "string" ? await boss.getJobById(name, id) : null;
          const result = await complete(name, id, data, options);
          if (queued && (queued.data as { sourceId?: string }).sourceId === target.sourceId) {
            if (expected === "completed") { expect(queued.data).toMatchObject({ ...target, trigger: "SCHEDULED" }); jobId = queued.id; }
            if (expected === "retry") controller.abort();
          }
          const event = (
            queued?.data as
              | { event?: { topic?: string; payload?: { projectId?: string } } }
              | undefined
          )?.event;
          if (expected === "completed" && event?.topic === "snapshot.build.request" && event.payload?.projectId === scope.projectId) {
            expect(data).toEqual({ status: "success" }); snapshotCompleted = true; controller.abort();
          }
          return result;
        });
        const failed = vi.spyOn(boss, "fail").mockImplementation(async (name, id, data, options) => {
          const result = await fail(name, id, data, options); if (name === SOURCE_IMPORT_QUEUE && id === jobId) controller.abort(); return result;
        });
        try {
          const result = await runSourceWorker({ workerId: `synthetic-worker-${suffix}`, signal: controller.signal, pollIntervalMs: 10 });
          expect(result[expected === "completed" ? "completed" : "failed"]).toBeGreaterThanOrEqual(1);
          if (expected === "retry") expect(failed).toHaveBeenCalledWith(SOURCE_IMPORT_QUEUE, jobId, { status: "FAILED", code: "SOURCE_IMPORT_FAILED" });
          else expect(snapshotCompleted).toBe(true);
        } finally { clearTimeout(timeout); completed.mockRestore(); failed.mockRestore(); }
        const inspect = await getPgBoss();
        expect(jobId).toEqual(expect.any(String));
        expect((await inspect.getJobById(SOURCE_IMPORT_QUEUE, jobId!))?.state).toBe(expected);
        const schedules = await inspect.getSchedules(SOURCE_IMPORT_QUEUE);
        expect(schedules.map((schedule) => schedule.key)).not.toContain("deleted-synthetic");
        expect(schedules.some((schedule) => schedule.key === target.sourceId)).toBe(expected === "completed");
        await stopPgBoss();
        return jobId!;
      };
      await execute(baselineXml, "completed");
      const good = await database.runInPrincipalDatabaseTransaction(admin, (tx) => tx.source.findUniqueOrThrow({ where: { id: target.sourceId } }));
      expect(good.lastGoodRevisionId).toEqual(expect.any(String));
      const snapshot = await database.runInPrincipalDatabaseTransaction(admin, async (tx) => ({
        input: await tx.snapshotBuildInput.findFirstOrThrow({ where: scope }),
        binding: await tx.snapshotPublicationBinding.findFirstOrThrow({ where: scope }),
        current: await tx.projectCurrentSnapshotManifest.findUniqueOrThrow({ where: { organizationId_projectId: scope } }),
        delivery: await tx.deliveryRun.findFirstOrThrow({ where: scope }),
      }));
      expect(snapshot.binding).toMatchObject({ buildInputId: snapshot.input.id, publishSequence: snapshot.input.publishSequence,
        manifestSha256: snapshot.current.manifestSha256 });
      expect(snapshot.delivery).toMatchObject({ publishSequence: snapshot.current.publishSequence,
        manifestKey: snapshot.current.manifestKey, manifestSha256: snapshot.current.manifestSha256, status: "PENDING" });
      const manifestBytes = objects.get(snapshot.current.manifestKey);
      expect(manifestBytes).toBeInstanceOf(Uint8Array);
      const manifest = snapshotManifestV1Schema.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
      expect(manifest).toMatchObject({ projectId: scope.projectId, publishSequence: snapshot.current.publishSequence,
        keyId: "synthetic-worker-key", signature: expect.stringMatching(/^[A-Za-z0-9_-]{86}$/u) });
      expect(manifest.files).toHaveLength(13);
      const failedJobId = await execute("<broken>", "retry");
      await database.runInPrincipalDatabaseTransaction(admin, async (tx) => {
        expect((await tx.source.findUniqueOrThrow({ where: { id: target.sourceId } })).lastGoodRevisionId).toBe(good.lastGoodRevisionId);
        expect(await tx.sourceRevision.count({ where: { ...target, status: "GOOD" } })).toBe(2);
        expect(await tx.sourceRevision.count({ where: { ...target, status: "FAILED" } })).toBe(1);
        expect(await tx.inventoryIdentity.count({ where: { ...target, status: "ACTIVE" } })).toBe(1);
        expect(await tx.outboxEvent.count({ where: { organizationId: scope.organizationId, topic: "snapshot.build.request", status: "PENDING" } })).toBe(1);
      });
      expect(scopedReads).toBeGreaterThan(4); expect(uploads).toBeGreaterThan(0); expect(gateway).toHaveBeenCalledTimes(3);
      // Prove retry and LastGood preservation first, then retire only this fixture's job.
      // A later combined-worker suite must not intake it with another synthetic transport.
      const cleanupQueue = await getPgBoss();
      await cleanupQueue.cancel(SOURCE_IMPORT_QUEUE, failedJobId);
      expect((await cleanupQueue.getJobById(SOURCE_IMPORT_QUEUE, failedJobId))?.state).toBe("cancelled");
    } finally { await stopPgBoss(); schedulerRole.mockRestore(); role.mockRestore(); sdk.mockRestore(); vi.unstubAllEnvs(); gateway.mockReset(); }
  }, 420_000);
});
