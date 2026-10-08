import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { publicInventoryDtoSchema } from "@ams-data-hub/realty-contracts";
import { expect, it, vi } from "vitest";

// Only external wire/storage transports are synthetic. Production Safe Outbound,
// configured worker, parser/profile, repositories and snapshot assembly remain real.
const wire = vi.hoisted(() => ({ dns: vi.fn(), https: vi.fn(), http: vi.fn(), workerCuts: 0 }));
vi.mock("node:dns/promises", () => ({ lookup: wire.dns }));
vi.mock("node:https", () => ({ request: wire.https }));
vi.mock("node:http", () => ({ request: wire.http }));
vi.mock("../../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = (context, execute, options) =>
    actual.runInAuthorizedDatabaseTransaction(context, async (tx) => {
      if (context.principalKind === "project-job" || context.principalKind === "system-job") {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]);
        wire.workerCuts++;
      }
      return execute(tx);
    }, options);
  const principal: typeof actual.runInPrincipalDatabaseTransaction = (context, execute) =>
    authorized(actual.createDatabaseAuthorizationContext(context), execute);
  const system: typeof actual.runInSystemJobDatabaseTransaction = (context, execute) =>
    authorized(actual.createSystemJobDatabaseAuthorizationContext(context), execute);
  return { ...actual, runInAuthorizedDatabaseTransaction: authorized,
    runInPrincipalDatabaseTransaction: principal, runInSystemJobDatabaseTransaction: system };
});
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import { createProjectObjectStorageResolver } from "../../src/platform/storage/project-object-storage.ts";
import { runSourceWorker } from "../../src/infrastructure/source-worker-runtime.ts";
import { sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import { BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../../src/modules/ingestion-core/index.ts";
import { SOURCE_IMPORT_QUEUE } from "../../src/modules/ingestion-core/worker.ts";
import { getPgBoss, stopPgBoss } from "../../src/modules/platform-operations/worker.ts";
import { catalogSubscriptionCommands } from "../../src/modules/shared-catalog/server.ts";
import { projectPublicContactCommands, projectUrlRegistryCommands } from "../../src/modules/project-state/server.ts";
import { captureSnapshotInput, createSnapshotCandidateAssemblyServer } from "../../src/modules/snapshot-delivery/server.ts";

const families = [
  { adapter: "yrl-realty-2010", profile: "joywork-domclick-v1", format: "DOMCLICK_YRL",
    xml: '<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06"><offer internal-id="synthetic-one"><category>квартира</category><type>продажа</type><price><value>1000</value><currency>RUB</currency></price><location><address>ул. Макетная</address></location></offer></realty-feed>',
    wrong: '<Ads formatVersion="3" target="Avito.ru"><Ad><Id>synthetic-one</Id></Ad></Ads>' },
  { adapter: "avito-xml-v3", profile: "joywork-avito-v3", format: "AVITO_V3",
    xml: '<Ads formatVersion="3" target="Avito.ru"><Ad><Id>synthetic-one</Id><Category>Квартиры</Category><OperationType>Продам</OperationType><Price>1000</Price><Address>ул. Макетная</Address></Ad></Ads>',
    wrong: '<Feed><Feed_Version>2</Feed_Version><Object><ExternalId>synthetic-one</ExternalId></Object></Feed>' },
  { adapter: "cian-xml-v2", profile: "joywork-cian-v2", format: "CIAN_V2",
    xml: '<Feed><Feed_Version>2</Feed_Version><Object><ExternalId>synthetic-one</ExternalId><Category>flatSale</Category><BargainTerms><Price>1000</Price><Currency>RUB</Currency></BargainTerms><Address>ул. Макетная</Address></Object></Feed>',
    wrong: '<Ads formatVersion="3" target="Avito.ru"><Ad><Id>synthetic-one</Id></Ad></Ads>' },
];

it.each(families)("executes $profile on native worker and projects compatible DTO while rejecting a foreign format", async (family) => {
  const suffix = randomUUID().slice(0, 8);
  const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-marketplace", correlationId: randomUUID() };
  const scope = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const org = await tx.organization.create({ data: { name: "Synthetic marketplace", slug: `marketplace-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic marketplace", slug: `marketplace-${suffix}` } });
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
      update: { jobsFrozen: false, unfrozenAt: new Date() } });
    return { organizationId: org.id, projectId: project.id };
  });
  const policy = await runInPrincipalDatabaseTransaction(admin, (tx) => tx.sourceSafetyPolicy.create({ data: {
    ...scope, policy: BOOTSTRAP_SOURCE_SAFETY_POLICY,
  } }));
  const feedRef = `SYNTHETIC_MARKETPLACE_FEED_${suffix.toUpperCase()}`;
  const source = await sourceRegistryCommands.createSource(admin, { ...scope, sourceKey: "synthetic-marketplace", name: "Synthetic marketplace",
    endpointCredentialRef: feedRef, adapterKey: family.adapter, adapterVersion: "1.0.0", profileKey: family.profile, profileVersion: "1.0.0",
    datasetType: "MIXED_REALTY", transportType: "HTTPS_XML", sharingPolicy: "PROJECT_ONLY", schedulePolicy: { mode: "MANUAL_ONLY" },
    safetyPolicyId: policy.id, expectedNamespace: "", expectedProducer: "" });
  const target = { ...scope, sourceId: source.sourceId };
  await sourceRegistryCommands.setSourceEnabled(admin, { ...target, version: source.version, enabled: true });
  vi.stubEnv(feedRef, "https://feed.example.test/synthetic.xml?token=synthetic");
  vi.stubEnv("PROJECT_STORAGE_BINDINGS", JSON.stringify([{ ...scope, bucketRef: "SYNTHETIC_MARKETPLACE_BUCKET",
    endpointRef: "SYNTHETIC_MARKETPLACE_ENDPOINT", regionRef: "SYNTHETIC_MARKETPLACE_REGION",
    accessKeyIdRef: "SYNTHETIC_MARKETPLACE_ACCESS", secretAccessKeyRef: "SYNTHETIC_MARKETPLACE_SECRET" }]));
  vi.stubEnv("SYNTHETIC_MARKETPLACE_BUCKET", `synthetic-marketplace-${suffix}`);
  vi.stubEnv("SYNTHETIC_MARKETPLACE_ENDPOINT", "https://s3.twcstorage.ru");
  vi.stubEnv("SYNTHETIC_MARKETPLACE_REGION", "ru-1");
  vi.stubEnv("SYNTHETIC_MARKETPLACE_ACCESS", "synthetic-access");
  vi.stubEnv("SYNTHETIC_MARKETPLACE_SECRET", "synthetic-secret");
  for (const flag of ["SNAPSHOT_BUILD_ENABLED", "SNAPSHOT_PUBLISH_ENABLED", "SNAPSHOT_ROLLBACK_ENABLED", "SNAPSHOT_WEBHOOK_ENABLED"])
    vi.stubEnv(flag, "false");
  wire.dns.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  const objects = new Map<string, Uint8Array>();
  const contentTypes = new Map<string, string>();
  const sdk = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: unknown) => {
    if (!(command instanceof PutObjectCommand) && !(command instanceof GetObjectCommand) && !(command instanceof HeadObjectCommand))
      throw new Error("SYNTHETIC_UNEXPECTED_SDK_OPERATION");
    expect(command.input.Bucket).toBe(`synthetic-marketplace-${suffix}`);
    if (command instanceof PutObjectCommand) {
      const chunks: Uint8Array[] = [];
      if (command.input.Body instanceof Uint8Array) chunks.push(command.input.Body);
      else for await (const chunk of command.input.Body as AsyncIterable<Uint8Array>) chunks.push(Uint8Array.from(chunk));
      objects.set(command.input.Key!, Uint8Array.from(Buffer.concat(chunks)));
      contentTypes.set(command.input.Key!, command.input.ContentType!);
      return { ETag: "synthetic" } as never;
    }
    const body = objects.get(command.input.Key!);
    if (!body) throw { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } };
    return { ContentLength: body.length, ContentType: contentTypes.get(command.input.Key!), LastModified: new Date(0), ETag: "synthetic",
      ...(command instanceof GetObjectCommand ? { Body: { async *[Symbol.asyncIterator]() { yield body; }, destroy: vi.fn() } } : {}) } as never;
  });
  const read = () => runInPrincipalDatabaseTransaction(admin, async (tx) => ({
    source: await tx.source.findUniqueOrThrow({ where: { id: target.sourceId } }),
    revisions: await tx.sourceRevision.findMany({ where: target, orderBy: { sequence: "asc" } }),
    records: await tx.sourceRevisionRecord.findMany({ where: target }),
    identities: await tx.inventoryIdentity.findMany({ where: target }),
    intents: await tx.outboxEvent.findMany({ where: { organizationId: scope.organizationId, topic: "snapshot.build.request",
      payload: { path: ["projectId"], equals: scope.projectId } } }),
  }));
  const execute = async (body: string, expected: "completed" | "retry") => {
    const bytes = new TextEncoder().encode(body);
    wire.https.mockImplementation((options, receive) => {
      expect(options).toMatchObject({ hostname: "93.184.216.34", servername: "feed.example.test", method: "GET" });
      const message = Object.assign(Readable.from([bytes.subarray(0, 31), bytes.subarray(31)]), {
        statusCode: 200, headers: { "content-type": "application/xml", "content-length": String(bytes.length) },
      });
      const request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
      request.end.mockImplementation(() => receive(message)); return request;
    });
    const boss = await getPgBoss();
    await boss.createQueue(SOURCE_IMPORT_QUEUE, { policy: "exclusive", retryLimit: 3, retryDelay: 30 });
    const jobId = await boss.send(SOURCE_IMPORT_QUEUE, { schemaVersion: 1, ...target, trigger: "MANUAL" }, { singletonKey: target.sourceId });
    expect(jobId).toEqual(expect.any(String));
    const controller = new AbortController(); const complete = boss.complete.bind(boss); const fail = boss.fail.bind(boss);
    const completed = vi.spyOn(boss, "complete").mockImplementation(async (name, id, data, options) => {
      const result = await complete(name, id, data, options); if (name === SOURCE_IMPORT_QUEUE && id === jobId) controller.abort(); return result;
    });
    const failed = vi.spyOn(boss, "fail").mockImplementation(async (name, id, data, options) => {
      const result = await fail(name, id, data, options); if (name === SOURCE_IMPORT_QUEUE && id === jobId) controller.abort(); return result;
    });
    const timer = setTimeout(() => controller.abort(), 60_000);
    try { await runSourceWorker({ workerId: `synthetic-marketplace-${suffix}`, signal: controller.signal, pollIntervalMs: 10 }); }
    finally { clearTimeout(timer); completed.mockRestore(); failed.mockRestore(); }
    const inspect = await getPgBoss();
    expect((await inspect.getJobById(SOURCE_IMPORT_QUEUE, jobId!))?.state).toBe(expected);
    await stopPgBoss();
    return jobId!;
  };
  try {
    await execute(family.xml, "completed");
    const good = await read();
    expect(good.source).toMatchObject({ adapterKey: family.adapter, profileKey: family.profile });
    expect(good.revisions).toHaveLength(1); expect(good.revisions[0]).toMatchObject({ status: "GOOD", recordCount: 1 });
    const revision = good.revisions[0]!;
    const raw = objects.get(revision.rawStorageKey!)!;
    expect(new TextDecoder().decode(raw)).toBe(family.xml);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(revision.rawArtifactHash);
    expect(good.records).toHaveLength(1); expect(good.identities).toHaveLength(1); expect(good.intents).toHaveLength(1);
    expect(good.records[0]!.payload).toMatchObject({ draft: { externalId: "synthetic-one", sourceFormat: family.format,
      propertyType: "APARTMENT", transactionType: "SALE", price: 1000 } });
    const uid = good.identities[0]!.uid;
    await catalogSubscriptionCommands.replaceProjectSubscription(admin, { ...scope, version: 0, mode: "ALL_SHARED",
      cityUids: ["01M41T6Q04BADHXSERJHZFXKCH"], selections: [] });
    await projectPublicContactCommands.replaceProjectPublicContact(admin, { ...scope, version: 0, phone: "+70000000077",
      email: "", addressPublic: "", messengers: [], hours: "" });
    await projectUrlRegistryCommands.replaceProjectUrlPolicy(admin, { ...scope, version: 0, policyKey: "synthetic-marketplace",
      pathTemplates: [{ entityType: "INVENTORY", template: "/inventory/{slug}" }], reservedNamespaces: [] });
    const entry = await projectUrlRegistryCommands.createProjectUrlEntry(admin, { ...scope, entityType: "INVENTORY", entityUid: uid,
      slug: "synthetic-one", canonicalPath: "/inventory/synthetic-one" });
    await projectUrlRegistryCommands.publishProjectUrlEntry(admin, { ...scope, urlEntryId: entry.urlEntryId, version: entry.version });
    const storage = createProjectObjectStorageResolver()(scope);
    const snapshotJob = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input" });
    const capture = await captureSnapshotInput(snapshotJob, { ...scope, schemaMinor: 0, idempotencyKey: randomUUID() });
    const assembled = await createSnapshotCandidateAssemblyServer({ ...scope, storage })(snapshotJob,
      { idempotencyKeyHash: capture.idempotencyKeyHash, requestHash: capture.requestHash });
    const inventory = assembled.datasets.find((dataset) => dataset.kind === "inventory")!.records;
    expect(inventory).toHaveLength(1);
    expect(publicInventoryDtoSchema.parse(inventory[0]!.value)).toMatchObject({ uid, propertyType: "APARTMENT", transactionType: "SALE", price: 1000 });
    expect(JSON.stringify(assembled.datasets)).not.toMatch(/rawRecord|sourceFormat|normalizedHash|sourceHash|endpointCredentialRef|\?token=/u);
    const rejectedJobId = await execute(family.wrong, "retry");
    const rejected = await read();
    expect(rejected.revisions.at(-1)).toMatchObject({ status: "FAILED" });
    expect(rejected.source.lastGoodRevisionId).toBe(good.source.lastGoodRevisionId);
    expect(rejected.identities).toEqual(good.identities); expect(rejected.records).toEqual(good.records); expect(rejected.intents).toEqual(good.intents);
    // After proving actual retry and preservation, cancel only this fixture's job.
    // A stopped client alone would leave it eligible under the next case's wire.
    const cleanupQueue = await getPgBoss();
    await cleanupQueue.cancel(SOURCE_IMPORT_QUEUE, rejectedJobId);
    expect((await cleanupQueue.getJobById(SOURCE_IMPORT_QUEUE, rejectedJobId))?.state).toBe("cancelled");
    expect(wire.workerCuts).toBeGreaterThan(0); expect(wire.dns).toHaveBeenCalled(); expect(wire.http).not.toHaveBeenCalled();
  } finally {
    await stopPgBoss(); sdk.mockRestore(); vi.unstubAllEnvs();
    wire.dns.mockReset(); wire.https.mockReset(); wire.http.mockReset(); wire.workerCuts = 0;
  }
}, 120_000);
