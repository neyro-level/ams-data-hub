import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
const gateway = vi.hoisted(() => vi.fn());
vi.mock("../../src/platform/http/safe-outbound.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/http/safe-outbound.ts")>();
  return { ...actual, safeOutboundStream: gateway };
});
import { createSourceExecutionServer, sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import { S3ObjectStorage } from "../../src/platform/storage/timeweb-s3-object-storage.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal, ProjectJobPrincipal } from "../../src/platform/authorization/principal.ts";
import { BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../../src/modules/ingestion-core/domain/safety-engine.ts";

const namespace = "http://webmaster.yandex.ru/schemas/feed/realty/2010-06";
const offer = (id: string, price = 1000) => `<offer internal-id="${id}"><category>квартира</category><type>продажа</type><price><value>${price}</value></price><location><address>Синтетический город</address></location></offer>`;
const feed = (...offers: string[]) => `<realty-feed xmlns="${namespace}">${offers.join("")}</realty-feed>`;

async function setup(profileKey = "default-v1") {
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
  const safetyPolicyId = profileKey === "default-v1" ? "" : (await runInPrincipalDatabaseTransaction(principal,
    (tx) => tx.sourceSafetyPolicy.create({ data: { ...scope, policy: BOOTSTRAP_SOURCE_SAFETY_POLICY } }))).id;
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
  }));
  return { principal, target, runtime, provide, read, uploaded: () => uploaded, cleanup: () => { delete process.env[referenceName]; gateway.mockReset(); } };
}

describe("concrete Source application runtime with PostgreSQL and real spool/storage adapter", () => {
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
      expect(result).toMatchObject({ state: "GOOD", sourceId: context.target.sourceId, sequence: 1, snapshotTriggered: false });
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
