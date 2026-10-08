import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
const gateway = vi.hoisted(() => vi.fn());
vi.mock("../../src/platform/http/safe-outbound.ts", async (original) => ({
  ...await original<typeof import("../../src/platform/http/safe-outbound.ts")>(), safeOutboundStream: gateway,
}));
import { runSourceWorker } from "../../src/infrastructure/source-worker-runtime.ts";
import { sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import { SOURCE_IMPORT_QUEUE } from "../../src/modules/ingestion-core/worker.ts";
import { getPgBoss, stopPgBoss } from "../../src/modules/platform-operations/worker.ts";
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
    const source = await sourceRegistryCommands.createSource(admin, { ...scope, sourceKey: "synthetic", name: "Synthetic worker",
      endpointCredentialRef: feedRef, adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "default-v1", profileVersion: "1.0.0",
      datasetType: "MIXED_REALTY", transportType: "HTTPS_XML", sharingPolicy: "PROJECT_ONLY", schedulePolicy: { mode: "SCHEDULED", cadenceMinutes: 60 },
      safetyPolicyId: "", expectedNamespace: "", expectedProducer: "" });
    const target = { ...scope, sourceId: source.sourceId };
    await sourceRegistryCommands.setSourceEnabled(admin, { ...target, version: source.version, enabled: true });
    await database.runInPrincipalDatabaseTransaction(admin, (tx) => tx.source.update({ where: { id: target.sourceId },
      data: { updatedAt: new Date(Date.now() - 61 * 60_000) } }));
    vi.stubEnv(feedRef, "https://synthetic.example.invalid/worker.xml");
    vi.stubEnv("PROJECT_STORAGE_BINDINGS", JSON.stringify([{ ...scope, bucketRef: "SYNTHETIC_WORKER_BUCKET", endpointRef: "SYNTHETIC_WORKER_ENDPOINT",
      regionRef: "SYNTHETIC_WORKER_REGION", accessKeyIdRef: "SYNTHETIC_WORKER_ACCESS", secretAccessKeyRef: "SYNTHETIC_WORKER_SECRET" }]));
    vi.stubEnv("SYNTHETIC_WORKER_BUCKET", `synthetic-worker-${suffix}`); vi.stubEnv("SYNTHETIC_WORKER_ENDPOINT", "https://s3.twcstorage.ru");
    vi.stubEnv("SYNTHETIC_WORKER_REGION", "ru-1"); vi.stubEnv("SYNTHETIC_WORKER_ACCESS", "synthetic-worker-access");
    vi.stubEnv("SYNTHETIC_WORKER_SECRET", "synthetic-worker-secret");
    let uploads = 0; let scopedReads = 0;
    const sdk = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: unknown) => {
      if (!(command instanceof PutObjectCommand)) throw new Error("SYNTHETIC_S3_OPERATION_DENIED");
      for await (const chunk of command.input.Body as AsyncIterable<Uint8Array>) uploads += chunk.byteLength;
      return { ETag: "synthetic" } as never;
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
      const execute = async (xml: string, expected: "completed" | "retry") => {
        const bytes = new TextEncoder().encode(xml);
        gateway.mockResolvedValue({ status: 200, contentType: "application/xml", contentLength: bytes.length,
          finalUrl: new URL(process.env[feedRef]!), body: (async function* () { yield bytes; })(), close: vi.fn() });
        const boss = await getPgBoss();
        await boss.createQueue(SOURCE_IMPORT_QUEUE, { policy: "exclusive", retryLimit: 3, retryDelay: 30 });
        let jobId: string | null = null;
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
          const queued = name === SOURCE_IMPORT_QUEUE && typeof id === "string" ? await boss.getJobById(SOURCE_IMPORT_QUEUE, id) : null;
          const result = await complete(name, id, data, options);
          if (queued && (queued.data as { sourceId?: string }).sourceId === target.sourceId) {
            if (expected === "completed") { expect(queued.data).toMatchObject({ ...target, trigger: "SCHEDULED" }); jobId = queued.id; }
            controller.abort();
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
      await execute('<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06"><offer internal-id="one"><category>квартира</category><type>продажа</type><price><value>1000</value></price></offer></realty-feed>', "completed");
      const good = await database.runInPrincipalDatabaseTransaction(admin, (tx) => tx.source.findUniqueOrThrow({ where: { id: target.sourceId } }));
      expect(good.lastGoodRevisionId).toEqual(expect.any(String));
      const failedJobId = await execute("<broken>", "retry");
      await database.runInPrincipalDatabaseTransaction(admin, async (tx) => {
        expect((await tx.source.findUniqueOrThrow({ where: { id: target.sourceId } })).lastGoodRevisionId).toBe(good.lastGoodRevisionId);
        expect(await tx.sourceRevision.count({ where: { ...target, status: "GOOD" } })).toBe(1);
        expect(await tx.sourceRevision.count({ where: { ...target, status: "FAILED" } })).toBe(1);
        expect(await tx.inventoryIdentity.count({ where: { ...target, status: "ACTIVE" } })).toBe(1);
        expect(await tx.outboxEvent.count({ where: { organizationId: scope.organizationId, topic: "snapshot.build.request", status: "PENDING" } })).toBe(1);
      });
      expect(scopedReads).toBeGreaterThan(4); expect(uploads).toBeGreaterThan(0); expect(gateway).toHaveBeenCalledTimes(2);
      // Prove retry and LastGood preservation first, then retire only this fixture's job.
      // A later combined-worker suite must not intake it with another synthetic transport.
      const cleanupQueue = await getPgBoss();
      await cleanupQueue.cancel(SOURCE_IMPORT_QUEUE, failedJobId);
      expect((await cleanupQueue.getJobById(SOURCE_IMPORT_QUEUE, failedJobId))?.state).toBe("cancelled");
    } finally { await stopPgBoss(); schedulerRole.mockRestore(); role.mockRestore(); sdk.mockRestore(); vi.unstubAllEnvs(); gateway.mockReset(); }
  }, 420_000);
});
