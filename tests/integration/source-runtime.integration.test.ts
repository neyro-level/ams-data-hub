import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
const gateway = vi.hoisted(() => vi.fn());
vi.mock("../../src/platform/http/safe-outbound.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/http/safe-outbound.ts")>();
  return { ...actual, safeOutboundStream: gateway };
});
import { createSourceExecutionServer, inventoryIdentityCommands, sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import { S3ObjectStorage } from "../../src/platform/storage/timeweb-s3-object-storage.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import * as transactionRuntime from "../../src/platform/database/transaction.ts";
import type { DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal, PrincipalContext, ProjectJobPrincipal } from "../../src/platform/authorization/principal.ts";
import { BOOTSTRAP_SOURCE_SAFETY_POLICY, type SourceSafetyPolicy } from "../../src/modules/ingestion-core/domain/safety-engine.ts";
import { PrismaSourceExecutionRepository } from "../../src/modules/ingestion-core/infrastructure/prisma-source-execution-repository.ts";
import { enqueueSourceGoodSnapshot } from "../../src/modules/ingestion-core/infrastructure/source-snapshot-intent.ts";
import { PrismaReliabilityRepository } from "../../src/modules/platform-operations/server.ts";
import { drainOutbox } from "../../src/modules/platform-operations/worker.ts";

const namespace = "http://webmaster.yandex.ru/schemas/feed/realty/2010-06";
const offer = (id: string, price = 1000) => `<offer internal-id="${id}"><category>квартира</category><type>продажа</type><price><value>${price}</value></price><location><address>Синтетический город</address></location></offer>`;
const feed = (...offers: string[]) => `<realty-feed xmlns="${namespace}">${offers.join("")}</realty-feed>`;

async function setup(profileKey = "default-v1", policyOverride?: SourceSafetyPolicy) {
  const principal: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-runtime-admin", correlationId: randomUUID() };
  const suffix = randomUUID().slice(0, 8);
  const scope = await runInPrincipalDatabaseTransaction(principal, async (tx) => {
    const organization = await tx.organization.create({ data: { name: "Synthetic runtime", slug: `runtime-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: organization.id, name: "Synthetic runtime", slug: `runtime-${suffix}` } });
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() }, update: { jobsFrozen: false, unfrozenAt: new Date() } });
    return { organizationId: organization.id, projectId: project.id };
  });
  const referenceName = `SYNTHETIC_RUNTIME_${suffix.toUpperCase()}`;
  process.env[referenceName] = "https://synthetic.example.test/private.xml?token=synthetic-runtime-only";
  // Small normalization fixtures use an explicit project-owned test policy,
  // not the producer's calibrated 777-record live-feed threshold.
  const safetyPolicyId = profileKey === "default-v1" && !policyOverride ? "" : (await runInPrincipalDatabaseTransaction(principal,
    (tx) => tx.sourceSafetyPolicy.create({ data: { ...scope, policy: policyOverride ?? BOOTSTRAP_SOURCE_SAFETY_POLICY } }))).id;
  const source = await sourceRegistryCommands.createSource(principal, { ...scope,
    sourceKey: "synthetic", name: "Synthetic", endpointCredentialRef: referenceName,
    adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey, profileVersion: "1.0.0",
    datasetType: "MIXED_REALTY", transportType: "HTTPS_XML", sharingPolicy: "PROJECT_ONLY", schedulePolicy: { mode: "MANUAL_ONLY" },
    safetyPolicyId, expectedNamespace: "", expectedProducer: "",
  });
  await sourceRegistryCommands.setSourceEnabled(principal, { ...scope, sourceId: source.sourceId, version: source.version, enabled: true });
  let uploaded = 0;
  const storage = new S3ObjectStorage({ bucket: "synthetic-runtime", client: { send: async (command: { input: { Body: AsyncIterable<Uint8Array> } }) => {
    for await (const chunk of command.input.Body) uploaded += chunk.byteLength;
    return {};
  } } as unknown as S3Client });
  const target = { ...scope, sourceId: source.sourceId };
  const runtime = createSourceExecutionServer(storage);
  const provide = (xml: string) => {
    const bytes = new TextEncoder().encode(xml);
    gateway.mockResolvedValue({ status: 200, contentType: "application/xml", contentLength: bytes.byteLength,
      finalUrl: new URL(process.env[referenceName]!), body: (async function* () { yield bytes; })(), close: vi.fn() });
  };
  const read = () => runInPrincipalDatabaseTransaction(principal, async (tx) => ({
    source: await tx.source.findUniqueOrThrow({ where: { id: target.sourceId } }),
    revisions: await tx.sourceRevision.findMany({ where: target, orderBy: { startedAt: "asc" } }),
    identities: await tx.inventoryIdentity.findMany({ where: target, orderBy: { externalOfferId: "asc" } }),
    records: await tx.sourceRevisionRecord.findMany({ where: target }),
    events: await tx.inventoryLifecycleEvent.findMany({ where: { ...scope, inventory: { sourceId: target.sourceId } }, orderBy: { occurredAt: "asc" } }),
    intents: await tx.outboxEvent.findMany({ where: { organizationId: scope.organizationId, topic: "snapshot.build.request",
      payload: { path: ["projectId"], equals: scope.projectId } }, orderBy: { occurredAt: "asc" } }),
  }));
  return { principal, target, runtime, provide, read, uploaded: () => uploaded, cleanup: () => { delete process.env[referenceName]; gateway.mockReset(); } };
}

describe("concrete Source application runtime with PostgreSQL and real spool/storage adapter", () => {
  it("keeps snapshot intent pending while the real default outbox drain completes maintenance", async () => {
    const context = await setup();
    const workerId = `mp03-reservation-${randomUUID().slice(0, 8)}`;
    try {
      context.provide(feed(offer("one")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", snapshotTriggered: true });
      const baseline = await context.read();
      const now = new Date();
      const maintenance = await runInPrincipalDatabaseTransaction(context.principal, (tx) => new PrismaReliabilityRepository(tx).enqueueEvent({
        organizationId: context.target.organizationId, organizationScope: context.target.organizationId,
        idempotencyScope: "mp03.maintenance", idempotencyKey: randomUUID(), requestHash: "a".repeat(64),
        topic: "platform.maintenance.requested", payload: { operation: "synthetic-maintenance" },
        actorType: "SYSTEM", actorId: "synthetic-admin", action: "platform.maintenance.requested",
        entityType: "Project", entityId: context.target.projectId, source: "synthetic-runtime",
        correlationId: randomUUID(), schemaVersion: 1, occurredAt: now.toISOString(), availableAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
      }));
      await drainOutbox({ workerId, maxEvents: 25 });
      await drainOutbox({ workerId, maxEvents: 25 });
      const status = await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.outboxEvent.findUniqueOrThrow({ where: { id: maintenance.outboxEventId } }));
      expect(status.status).toBe("PROCESSED");
      expect((await context.read()).intents).toEqual(baseline.intents);
    } finally {
      await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.runtimeHeartbeat.deleteMany({ where: { workerId } }));
      context.cleanup();
    }
  });

  it("executes real GOOD and outbox writes with the non-bypass worker database role", async () => {
    const context = await setup();
    const original = transactionRuntime.runInPrincipalDatabaseTransaction;
    let checked = 0;
    const failures: string[] = [];
    async function runAsWorker<T>(principal: PrincipalContext, execute: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
      return original(principal, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe('SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user')).toEqual([{ rolbypassrls: false }]);
        checked += 1;
        try { return await execute(tx); } catch (error) {
          const message = error instanceof Error ? error.message : "";
          failures.push(message.match(/permission denied for (?:table|schema) [A-Za-z0-9_]+/u)?.[0]
            ?? (error && typeof error === "object" && "code" in error ? String(error.code) : "DATABASE_EXECUTION_FAILED"));
          throw error;
        }
      });
    }
    // Keep the production facade/SQL unchanged. The test fixture login is an
    // owner for setup; explicitly lower the actual session role for execution.
    const role = vi.spyOn(transactionRuntime, "runInPrincipalDatabaseTransaction").mockImplementation(runAsWorker);
    try {
      context.provide(feed(offer("one")));
      const result = await context.runtime.run(context.target);
      expect(result, JSON.stringify({ result, failures })).toMatchObject({ state: "GOOD", snapshotTriggered: true });
      expect(checked).toBeGreaterThan(3);
      role.mockRestore();
      expect((await context.read()).intents).toHaveLength(1);
    } finally { role.mockRestore(); context.cleanup(); }
  });

  it("commits one durable idempotent value-free snapshot intent per GOOD revision", async () => {
    const context = await setup();
    try {
      context.provide(feed(offer("one")));
      const result = await context.runtime.run(context.target);
      expect(result).toMatchObject({ state: "GOOD", snapshotTriggered: true });
      if (result.state !== "GOOD") throw new Error("SYNTHETIC_GOOD_REQUIRED");
      const current = await context.read();
      expect(current.intents).toHaveLength(1);
      expect(current.intents[0]).toMatchObject({ status: "PENDING", attempts: 0,
        payload: { schemaVersion: 1, ...context.target, sourceRevisionId: result.revisionId, sourceRevisionSequence: 1 } });
      const job: ProjectJobPrincipal = { kind: "project-job", jobName: "source-import", ...context.target, correlationId: randomUUID() };
      const duplicate = await runInPrincipalDatabaseTransaction(job, (tx) => enqueueSourceGoodSnapshot(tx, job, context.target, result));
      expect(duplicate).toMatchObject({ duplicate: true, outboxEventId: current.intents[0]!.id });
      expect((await context.read()).intents).toEqual(current.intents);
      expect(JSON.stringify(current.intents)).not.toContain("synthetic.example.test");
      expect(JSON.stringify(current.intents)).not.toContain("synthetic-runtime-only");
      context.provide(feed(offer("one", 2000)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 2, snapshotTriggered: true });
      expect((await context.read()).intents).toHaveLength(2);
    } finally { context.cleanup(); }
  });

  it("rolls back GOOD, identities and lifecycle when transactional outbox enqueue fails", async () => {
    const context = await setup("default-v1", { ...BOOTSTRAP_SOURCE_SAFETY_POLICY,
      deactivationEnabled: true, inactiveAfterMissingHours: 0, inactiveAfterMissingGoodRuns: 1 });
    let fault: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const all = [1, 2, 3, 4, 5].map((id) => offer(String(id)));
      context.provide(feed(...all));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      const baseline = await context.read();
      fault = vi.spyOn(PrismaReliabilityRepository.prototype, "enqueueEvent").mockRejectedValueOnce(new Error("SYNTHETIC_OUTBOX_UNAVAILABLE"));
      context.provide(feed(...all.slice(0, 4)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED", failedStage: "DATABASE_APPLY" });
      const current = await context.read();
      expect(current.source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
      expect(current.identities).toEqual(baseline.identities);
      expect(current.events).toEqual(baseline.events);
      expect(current.intents).toEqual(baseline.intents);
      expect(current.revisions.at(-1)?.status).toBe("FAILED");
    } finally { fault?.mockRestore(); context.cleanup(); }
  });

  it("rolls back identity/lifecycle/GOOD changes when the final database transaction fails", async () => {
    const context = await setup("default-v1", { ...BOOTSTRAP_SOURCE_SAFETY_POLICY,
      deactivationEnabled: true, inactiveAfterMissingHours: 0, inactiveAfterMissingGoodRuns: 1 });
    const original = PrismaSourceExecutionRepository.prototype.apply;
    let fault: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const all = [1, 2, 3, 4, 5].map((id) => offer(String(id)));
      context.provide(feed(...all));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      const baseline = await context.read();
      // Fault injection is only a negative DB-commit boundary probe. The real
      // apply executes first, including identities, events and GOOD/pointer.
      fault = vi.spyOn(PrismaSourceExecutionRepository.prototype, "apply").mockImplementationOnce(async function (
        this: PrismaSourceExecutionRepository, execution, revisionId, plan,
      ) {
        await original.call(this, execution, revisionId, plan);
        throw new Error("SYNTHETIC_POST_GOOD_FAILURE");
      });
      context.provide(feed(...all.slice(0, 4)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED", failedStage: "DATABASE_APPLY" });
      const current = await context.read();
      expect(current.source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
      expect(current.identities).toEqual(baseline.identities);
      expect(current.events).toEqual(baseline.events);
      expect(current.intents).toEqual(baseline.intents);
      expect(current.revisions.at(-1)?.status).toBe("FAILED");
    } finally { fault?.mockRestore(); context.cleanup(); }
  });

  it("serializes competing runs against the pinned Last Good instead of letting a stale run overwrite it", async () => {
    const context = await setup();
    try {
      context.provide(feed(offer("one")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 1 });
      let calls = 0;
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => { release = resolve; });
      gateway.mockImplementation(async () => {
        const price = ++calls * 2000;
        if (calls === 2) release();
        await barrier;
        const bytes = new TextEncoder().encode(feed(offer("one", price)));
        return { status: 200, contentType: "application/xml", contentLength: bytes.byteLength,
          body: (async function* () { yield bytes; })(), close: vi.fn() };
      });
      const results = await Promise.all([context.runtime.run(context.target), context.runtime.run(context.target)]);
      expect(results.map((result) => result.state).sort()).toEqual(["FAILED", "GOOD"]);
      const winner = results.find((result) => result.state === "GOOD")!;
      const current = await context.read();
      expect(winner).toMatchObject({ state: "GOOD", sequence: 2, revisionId: current.source.lastGoodRevisionId });
      expect(current.revisions.filter((revision) => revision.status === "GOOD")).toHaveLength(2);
      expect(current.identities).toHaveLength(1);
      expect(current.identities[0]!.sourceHash).toBe(winner.state === "GOOD" ? winner.rawArtifactHash : "");
    } finally { context.cleanup(); }
  });

  it("advances missing grace only on safe GOOD runs and preserves inventory across broken runs", async () => {
    const context = await setup("default-v1", { ...BOOTSTRAP_SOURCE_SAFETY_POLICY,
      deactivationEnabled: true, inactiveAfterMissingHours: 0, inactiveAfterMissingGoodRuns: 2 });
    try {
      const all = [1, 2, 3, 4, 5].map((id) => offer(String(id)));
      context.provide(feed(...all));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 1 });
      const initial = await context.read();
      const missingUid = initial.identities.find((item) => item.externalOfferId === "5")!.uid;
      context.provide(feed(...all.slice(0, 4)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 2 });
      const grace = await context.read();
      expect(grace.identities.find((item) => item.uid === missingUid)).toMatchObject({ status: "ACTIVE", missingGoodRuns: 1 });
      expect(grace.events).toHaveLength(0);
      for (const broken of ["<realty-feed>", feed(), feed(offer("1"), offer("1")), feed(offer("1")), feed(offer("1", -1))]) {
        context.provide(broken);
        expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED" });
        const current = await context.read();
        expect(current.source.lastGoodRevisionId).toBe(grace.source.lastGoodRevisionId);
        expect(current.identities).toEqual(grace.identities);
        expect(current.events).toEqual(grace.events);
        expect(current.intents).toEqual(grace.intents);
      }
      context.provide(feed(...all.slice(0, 4)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 3 });
      const inactive = await context.read();
      expect(inactive.identities).toHaveLength(5);
      expect(inactive.identities.find((item) => item.uid === missingUid)).toMatchObject({ status: "INACTIVE", missingGoodRuns: 2 });
      expect(inactive.events).toMatchObject([{ inventoryUid: missingUid, type: "INACTIVATED" }]);
      context.provide(feed(...all));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 4 });
      const reactivated = await context.read();
      expect(reactivated.identities.find((item) => item.uid === missingUid)).toMatchObject({ status: "ACTIVE", missingGoodRuns: 0, missingSince: null });
      expect(reactivated.events.map((event) => event.type)).toEqual(["INACTIVATED", "REACTIVATED"]);
    } finally { context.cleanup(); }
  });

  it("preserves pre-revision identities on baseline and requires both run and elapsed-time grace", async () => {
    const context = await setup("default-v1", { ...BOOTSTRAP_SOURCE_SAFETY_POLICY,
      deactivationEnabled: true, inactiveAfterMissingHours: 24, inactiveAfterMissingGoodRuns: 1 });
    const job: ProjectJobPrincipal = { kind: "project-job", jobName: "source-import", ...context.target, correlationId: randomUUID() };
    try {
      const legacy = await inventoryIdentityCommands.recordSeen(job, { ...context.target, externalOfferId: "legacy",
        sourceHash: "a".repeat(64), normalizedHash: "b".repeat(64), seenAt: new Date(Date.now() - 48 * 3_600_000) });
      const all = [1, 2, 3, 4, 5].map((id) => offer(String(id)));
      context.provide(feed(...all));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      expect((await context.read()).identities.find((item) => item.uid === legacy.uid)).toMatchObject({ status: "ACTIVE", missingGoodRuns: 0, missingSince: null });
      for (let run = 0; run < 2; run += 1) {
        context.provide(feed(...all.slice(0, 4)));
        expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      }
      const grace = await context.read();
      const missing = grace.identities.find((item) => item.externalOfferId === "5")!;
      expect(missing).toMatchObject({ status: "ACTIVE", missingGoodRuns: 2 });
      expect(grace.events).toHaveLength(0);
      // Age only the isolated synthetic identity clock; immutable GOOD history
      // remains untouched. The next real apply exercises elapsed-time policy.
      await runInPrincipalDatabaseTransaction(job, (tx) => tx.inventoryIdentity.update({
        where: { uid: missing.uid }, data: { missingSince: new Date(Date.now() - 25 * 3_600_000) },
      }));
      context.provide(feed(...all.slice(0, 4)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      expect((await context.read()).identities.find((item) => item.uid === missing.uid)).toMatchObject({ status: "INACTIVE", missingGoodRuns: 3 });
    } finally { context.cleanup(); }
  });

  it("enforces persisted revision RLS and forbids cross-source or cleared Last Good pointers", async () => {
    const first = await setup();
    const second = await setup();
    try {
      first.provide(feed(offer("one")));
      expect(await first.runtime.run(first.target)).toMatchObject({ state: "GOOD" });
      const baseline = await first.read();
      const job: ProjectJobPrincipal = { kind: "project-job", jobName: "source-import", ...second.target, correlationId: randomUUID() };
      await runInPrincipalDatabaseTransaction(job, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe('SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user')).toEqual([{ rolbypassrls: false }]);
        expect(await tx.sourceRevision.findMany({ where: first.target })).toEqual([]);
        expect(await tx.project.findMany({ where: { organizationId: first.target.organizationId, id: first.target.projectId } })).toEqual([]);
        expect(await tx.sourceRevisionRecord.findMany({ where: first.target })).toEqual([]);
        expect((await tx.sourceRevision.updateMany({ where: { id: baseline.source.lastGoodRevisionId! }, data: { failureCode: "TEST_DENIED" } })).count).toBe(0);
      });
      await expect(runInPrincipalDatabaseTransaction(first.principal, (tx) => tx.source.update({
        where: { id: second.target.sourceId }, data: { lastGoodRevisionId: baseline.source.lastGoodRevisionId },
      }))).rejects.toThrow();
      await expect(runInPrincipalDatabaseTransaction(first.principal, (tx) => tx.source.update({
        where: { id: first.target.sourceId }, data: { lastGoodRevisionId: null },
      }))).rejects.toThrow();
      expect((await first.read()).source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
    } finally { first.cleanup(); second.cleanup(); }
  });

  it("persists profile-normalized square metres and rejects unknown units or rental periods before GOOD", async () => {
    const context = await setup("vladis-vt24-v1");
    try {
      context.provide(feed(offer("one").replace("</offer>", "<area><value>6</value><unit>сотка</unit></area></offer>")));
      const result = await context.runtime.run(context.target);
      expect(result, JSON.stringify(result)).toMatchObject({ state: "GOOD" });
      const baseline = await context.read();
      expect(baseline.records[0]!.payload).toMatchObject({ draft: { areaM2: 600 } });
      for (const broken of [
        offer("one").replace("</offer>", "<area><value>6</value><unit>unknown</unit></area></offer>"),
        offer("one").replace("продажа", "аренда"),
        offer("one").replace("продажа", "аренда").replace("<price>", '<price period="unknown">'),
      ]) {
        context.provide(feed(broken));
        expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED" });
        const current = await context.read();
        expect(current.source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
        expect(current.identities).toEqual(baseline.identities);
      }
    } finally { context.cleanup(); }
  });

  it("serializes status-only project changes with runtime apply and rechecks status after intake", async () => {
    const context = await setup();
    try {
      await runInPrincipalDatabaseTransaction(context.principal, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))`;
        const pending = runInPrincipalDatabaseTransaction(context.principal, async (other) => {
          await other.$executeRawUnsafe("SET LOCAL lock_timeout = '1000ms'");
          await other.project.update({ where: { id: context.target.projectId }, data: { status: "DISABLED", slug: `changed-${randomUUID()}` } });
        }).then(() => false, () => true);
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const locks = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
          if (locks[0]!.count > 0n) { waiting = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        // A mixed unique-key/status update must not hold the Project key lock
        // while waiting for the runtime advisory lock (FK inserts need it).
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${context.target.projectId} FOR KEY SHARE`;
        expect(await pending).toBe(true);
      });
      context.provide(feed(offer("one")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      const baseline = await context.read();
      context.provide(feed(offer("one", 2000)));
      const response = await gateway();
      gateway.mockImplementationOnce(async () => {
        await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.project.update({
          where: { id: context.target.projectId }, data: { status: "DISABLED" },
        }));
        return response;
      });
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED" });
      const current = await context.read();
      expect(current.source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
      expect(current.identities).toEqual(baseline.identities);
    } finally { context.cleanup(); }
  });

  it("applies GOOD revision and stable scoped identity from configuration-only Source IDs", async () => {
    const context = await setup();
    try {
      context.provide(feed(offer("one")));
      const result = await context.runtime.run(context.target);
      expect(result).toMatchObject({ state: "GOOD", sourceId: context.target.sourceId, sequence: 1, snapshotTriggered: true });
      const first = await context.read();
      expect(first.source.lastGoodRevisionId).toBe(first.revisions[0]!.id);
      expect(first.revisions[0]).toMatchObject({ status: "GOOD", recordCount: 1, safetyPolicy: BOOTSTRAP_SOURCE_SAFETY_POLICY });
      expect(first.records[0]!.inventoryUid).toBe(first.identities[0]!.uid);
      expect(context.uploaded()).toBeGreaterThan(0);
      context.provide(feed(offer("one", 2000)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 2 });
      const second = await context.read();
      expect(second.identities[0]!.uid).toBe(first.identities[0]!.uid);
      expect(second.revisions[1]!.normalizedContentHash).not.toBe(first.revisions[0]!.normalizedContentHash);
      const serialized = JSON.stringify(second.revisions);
      expect(serialized).not.toContain("synthetic.example.test");
      expect(serialized).not.toContain("synthetic-runtime-only");
    } finally { context.cleanup(); }
  });

  it("retains GOOD and current identities after malformed XML, duplicate IDs and rejected empty feed", async () => {
    const context = await setup();
    try {
      context.provide(feed(offer("one")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      const baseline = await context.read();
      for (const broken of ["<realty-feed>", feed(offer("one"), offer("one")), feed()]) {
        context.provide(broken);
        expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED" });
        const current = await context.read();
        expect(current.source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
        expect(current.identities).toEqual(baseline.identities);
      }
      expect((await context.read()).revisions.map((revision) => revision.status)).toEqual(["GOOD", "FAILED", "FAILED", "REJECTED"]);
    } finally { context.cleanup(); }
  });

  it("persists SUSPICIOUS staged facts without replacing Last Good or applying a destructive plan", async () => {
    const context = await setup();
    try {
      context.provide(feed(...[1, 2, 3, 4, 5].map((id) => offer(String(id)))));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      const baseline = await context.read();
      context.provide(feed(offer("1")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED", code: "IMPORT_REQUIRES_APPROVAL" });
      const current = await context.read();
      expect(current.source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
      expect(current.identities).toEqual(baseline.identities);
      expect(current.revisions.at(-1)).toMatchObject({ status: "SUSPICIOUS", recordCount: 1 });
      expect(current.records.filter((record) => record.revisionId === current.revisions.at(-1)!.id)).toHaveLength(1);
    } finally { context.cleanup(); }
  });

  it("blocks frozen or disabled sources before outbound and protects GOOD records from changes", async () => {
    const context = await setup();
    try {
      context.provide(feed(offer("one")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      const baseline = await context.read();
      await expect(runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.sourceRevisionRecord.update({
        where: { revisionId_externalId: { revisionId: baseline.source.lastGoodRevisionId!, externalId: "one" } }, data: { recordHash: "c".repeat(64) },
      }))).rejects.toThrow();
      await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } }));
      gateway.mockClear();
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED" });
      expect(gateway).not.toHaveBeenCalled();
    } finally { context.cleanup(); }
  });
});
