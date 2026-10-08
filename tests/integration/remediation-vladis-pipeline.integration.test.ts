import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { snapshotManifestV1Schema } from "@ams-data-hub/snapshot-verifier";
import { publicInventoryDtoSchema } from "@ams-data-hub/realty-contracts";
import { expect, it, vi } from "vitest";

// Mock only external transport. Intake, parser, profile, spool, repositories,
// queue handlers and transaction boundaries remain the production composition.
const wire = vi.hoisted(() => ({ dns: vi.fn(), https: vi.fn(), http: vi.fn(), workerCuts: 0, failures: [] as string[] }));
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
      if (context.principalKind === "snapshot-consumer") {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_web");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]);
      }
      try { return await execute(tx); } catch (error) {
        const message = error instanceof Error ? error.message : "";
        wire.failures.push(message.match(/permission denied for (?:table|schema) [A-Za-z0-9_]+/u)?.[0]
          ?? (error && typeof error === "object" && "code" in error ? String(error.code) : "DATABASE_EXECUTION_FAILED"));
        throw error;
      }
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
import { runSourceWorker } from "../../src/infrastructure/source-worker-runtime.ts";
import { sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import { BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../../src/modules/ingestion-core/index.ts";
import { SOURCE_IMPORT_QUEUE } from "../../src/modules/ingestion-core/worker.ts";
import { getPgBoss, stopPgBoss } from "../../src/modules/platform-operations/worker.ts";
import { catalogSubscriptionCommands } from "../../src/modules/shared-catalog/server.ts";
import { projectPublicContactCommands, projectUrlRegistryCommands } from "../../src/modules/project-state/server.ts";
import { handleSnapshotConsumerGet, handleSnapshotConsumerAck, PrismaSnapshotDeliveryRepository } from "../../src/modules/snapshot-delivery/server.ts";
import { createSnapshotAckService } from "../../src/modules/snapshot-delivery/application/snapshot-ack.ts";
import { verifySnapshotPublicArtifacts } from "../../src/modules/snapshot-delivery/application/snapshot-public-verification.ts";

const variants = ["квартира", "комната", "house", "часть дома", "lot", "дача", "таунхаус", "гараж", "newdevelopmentflat", "коммерческая"];
const xml = (omitLast = false, price = 1000) => `<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06">${
  variants.slice(0, omitLast ? -1 : undefined).map((category, index) => `<offer internal-id="synthetic-${index}">
  <category>${category}</category><type>${index % 2 ? "аренда" : "продажа"}</type>
  <price${index % 2 ? ' period="месяц"' : ""}><value>${price}</value><currency>RUB</currency></price>
  <location><locality-name>Тестоград</locality-name><address>ул. Макетная</address><apartment>PRIVATE-APARTMENT</apartment><latitude>47.0001</latitude><longitude>39.0001</longitude></location>
  <description><![CDATA[Код объекта: SYN-${index}. <p>Синтетический дом</p><script>alert(1)</script>]]></description>
  <picture>https://media.example.test/synthetic-${index}.jpg?token=synthetic</picture>
  </offer>`).join("")}</realty-feed>`;

it("executes configured Vladis intake on the real worker and preserves GOOD identity/grace across restart and broken input", async () => {
  const suffix = randomUUID().slice(0, 8);
  const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-remediation", correlationId: randomUUID() };
  const scope = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const org = await tx.organization.create({ data: { name: "Synthetic remediation", slug: `remediation-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic remediation", slug: `remediation-${suffix}` } });
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
      update: { jobsFrozen: false, unfrozenAt: new Date() } });
    return { organizationId: org.id, projectId: project.id };
  });
  // Explicit project-owned small-fixture policy, never a change to live profile calibration.
  const policy = await runInPrincipalDatabaseTransaction(admin, (tx) => tx.sourceSafetyPolicy.create({ data: {
    ...scope, policy: { ...BOOTSTRAP_SOURCE_SAFETY_POLICY, deactivationEnabled: true },
  } }));
  const feedRef = `SYNTHETIC_REMEDIATION_FEED_${suffix.toUpperCase()}`;
  const source = await sourceRegistryCommands.createSource(admin, { ...scope, sourceKey: "synthetic-vladis", name: "Synthetic Vladis",
    endpointCredentialRef: feedRef, adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
    datasetType: "MIXED_REALTY", transportType: "HTTPS_XML", sharingPolicy: "PROJECT_ONLY", schedulePolicy: { mode: "MANUAL_ONLY" },
    safetyPolicyId: policy.id, expectedNamespace: "", expectedProducer: "" });
  const target = { ...scope, sourceId: source.sourceId };
  await sourceRegistryCommands.setSourceEnabled(admin, { ...target, version: source.version, enabled: true });
  vi.stubEnv(feedRef, "https://feed.example.test/synthetic.xml?token=synthetic");
  vi.stubEnv("PROJECT_STORAGE_BINDINGS", JSON.stringify([{ ...scope, bucketRef: "SYNTHETIC_REMEDIATION_BUCKET",
    endpointRef: "SYNTHETIC_REMEDIATION_ENDPOINT", regionRef: "SYNTHETIC_REMEDIATION_REGION",
    accessKeyIdRef: "SYNTHETIC_REMEDIATION_ACCESS", secretAccessKeyRef: "SYNTHETIC_REMEDIATION_SECRET" }]));
  vi.stubEnv("SYNTHETIC_REMEDIATION_BUCKET", `synthetic-remediation-${suffix}`);
  vi.stubEnv("SYNTHETIC_REMEDIATION_ENDPOINT", "https://s3.twcstorage.ru");
  vi.stubEnv("SYNTHETIC_REMEDIATION_REGION", "ru-1");
  vi.stubEnv("SYNTHETIC_REMEDIATION_ACCESS", "synthetic-access");
  vi.stubEnv("SYNTHETIC_REMEDIATION_SECRET", "synthetic-secret");
  vi.stubEnv("SNAPSHOT_BUILD_ENABLED", "false");
  vi.stubEnv("SNAPSHOT_PUBLISH_ENABLED", "false");
  vi.stubEnv("SNAPSHOT_ROLLBACK_ENABLED", "false");
  vi.stubEnv("SNAPSHOT_WEBHOOK_ENABLED", "false");
  wire.dns.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  const objects = new Map<string, Uint8Array>();
  const contentTypes = new Map<string, string>();
  const sdk = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: unknown) => {
    if (!(command instanceof PutObjectCommand) && !(command instanceof GetObjectCommand) && !(command instanceof HeadObjectCommand))
      throw new Error("SYNTHETIC_UNEXPECTED_SDK_OPERATION");
    expect(command.input.Bucket).toBe(`synthetic-remediation-${suffix}`);
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
    identities: await tx.inventoryIdentity.findMany({ where: target, orderBy: { externalOfferId: "asc" } }),
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
    const controller = new AbortController();
    const complete = boss.complete.bind(boss); const fail = boss.fail.bind(boss);
    const completed = vi.spyOn(boss, "complete").mockImplementation(async (name, id, data, options) => {
      const result = await complete(name, id, data, options);
      if (name === SOURCE_IMPORT_QUEUE && id === jobId) controller.abort(); return result;
    });
    const failed = vi.spyOn(boss, "fail").mockImplementation(async (name, id, data, options) => {
      const result = await fail(name, id, data, options);
      if (name === SOURCE_IMPORT_QUEUE && id === jobId) controller.abort(); return result;
    });
    const timer = setTimeout(() => controller.abort(), 60_000);
    try { await runSourceWorker({ workerId: `synthetic-remediation-${suffix}`, signal: controller.signal, pollIntervalMs: 10 }); }
    finally { clearTimeout(timer); completed.mockRestore(); failed.mockRestore(); }
    const inspect = await getPgBoss();
    const persisted = await read();
    expect((await inspect.getJobById(SOURCE_IMPORT_QUEUE, jobId!))?.state, JSON.stringify({
      failures: wire.failures, revisions: persisted.revisions.map(({ status, failureCode }) => ({ status, failureCode })),
      outboundCalls: wire.https.mock.calls.length, rawObjects: objects.size,
    })).toBe(expected);
    await stopPgBoss(); // Real runtime is restarted between imports.
  };
  try {
    await execute(xml(), "completed");
    const first = await read();
    const good = first.revisions.find((revision) => revision.id === first.source.lastGoodRevisionId)!;
    expect(good).toMatchObject({ status: "GOOD", recordCount: 10, sequence: 1 });
    const raw = objects.get(good.rawStorageKey!)!;
    expect(new TextDecoder().decode(raw)).toBe(xml());
    expect(createHash("sha256").update(raw).digest("hex")).toBe(good.rawArtifactHash);
    expect(first.identities).toHaveLength(10); expect(first.intents).toHaveLength(1);
    await execute(xml(true, 1100), "completed");
    const second = await read();
    expect(second.identities.map((identity) => identity.uid)).toEqual(first.identities.map((identity) => identity.uid));
    const missing = second.identities.find((identity) => identity.externalOfferId === "synthetic-9")!;
    // Grace is a decision/counter, not a third persisted lifecycle status.
    expect(missing).toMatchObject({ status: "ACTIVE", missingGoodRuns: 1 });
    expect(missing.missingSince).toBeInstanceOf(Date);
    expect(second.intents).toHaveLength(2);
    await execute("<broken>", "retry");
    const broken = await read();
    expect(broken.source.lastGoodRevisionId).toBe(second.source.lastGoodRevisionId);
    expect(broken.identities).toEqual(second.identities);
    expect(broken.intents).toHaveLength(2);
    expect(broken.revisions.filter((revision) => revision.status === "FAILED")).toHaveLength(1);
    expect(wire.workerCuts).toBeGreaterThan(5);
    expect(wire.dns).toHaveBeenCalledTimes(6); expect(wire.http).not.toHaveBeenCalled();

    // Prepare through public commands, not fabricated URL/contact/subscription rows.
    // This explicit preparation is not claimed to be automatic orchestration.
    await catalogSubscriptionCommands.replaceProjectSubscription(admin, { ...scope, version: 0, mode: "ALL_SHARED",
      cityUids: ["01M41T6Q04BADHXSERJHZFXKCH"], selections: [] });
    await projectPublicContactCommands.replaceProjectPublicContact(admin, { ...scope, version: 0,
      phone: "+70000000077", email: "", addressPublic: "", messengers: [], hours: "" });
    await projectUrlRegistryCommands.replaceProjectUrlPolicy(admin, { ...scope, version: 0, policyKey: "synthetic-remediation",
      pathTemplates: [{ entityType: "INVENTORY", template: "/inventory/{slug}" }], reservedNamespaces: [] });
    for (const identity of broken.identities) {
      const entry = await projectUrlRegistryCommands.createProjectUrlEntry(admin, { ...scope, entityType: "INVENTORY",
        entityUid: identity.uid, slug: identity.externalOfferId, canonicalPath: `/inventory/${identity.externalOfferId}` });
      await projectUrlRegistryCommands.publishProjectUrlEntry(admin, { ...scope, urlEntryId: entry.urlEntryId, version: entry.version });
    }
    const token = `synthetic-remediation-${randomUUID()}`;
    await runInPrincipalDatabaseTransaction(admin, (tx) => createSnapshotAckService({ repository: new PrismaSnapshotDeliveryRepository(tx), now: () => new Date() })
      .initializeCredential({ ...scope, token }));
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
    vi.stubEnv("SYNTHETIC_REMEDIATION_PRIVATE", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    vi.stubEnv("SYNTHETIC_REMEDIATION_PUBLIC", publicKey);
    vi.stubEnv("PROJECT_SNAPSHOT_SIGNING_BINDINGS", JSON.stringify([{ ...scope, keyId: "synthetic", privateKeyRef: "SYNTHETIC_REMEDIATION_PRIVATE",
      currentKeyId: "synthetic", nextKeyId: null, revokedKeyIds: [], publicKeyRefs: { synthetic: "SYNTHETIC_REMEDIATION_PUBLIC" } }]));
    vi.stubEnv("SNAPSHOT_BUILD_ENABLED", "true");
    const ownIntent = second.intents.find((event) => (event.payload as { sourceRevisionId?: string }).sourceRevisionId === second.source.lastGoodRevisionId)!;
    expect(ownIntent).toBeTruthy();
    await runInPrincipalDatabaseTransaction(admin, (tx) => tx.outboxEvent.update({ where: { id: ownIntent.id }, data: { availableAt: new Date("2000-01-01T00:00:00Z") } }));
    const boss = await getPgBoss(); const complete = boss.complete.bind(boss); const controller = new AbortController();
    let ownCompletion = false; let ownJobId: string | null = null;
    const completion = vi.spyOn(boss, "complete").mockImplementation(async (name, id, data, options) => {
      const queued = name === "outbox.dispatch" && typeof id === "string" ? await boss.getJobById(name, id) : null;
      const result = await complete(name, id, data, options);
      if ((queued?.data as { event?: { outboxEventId?: string } } | undefined)?.event?.outboxEventId === ownIntent.id) {
        expect(data).toEqual({ status: "success" }); ownCompletion = true; ownJobId = queued!.id; controller.abort();
      }
      return result;
    });
    const timer = setTimeout(() => controller.abort(), 60_000);
    try { await runSourceWorker({ workerId: `synthetic-publication-${suffix}`, signal: controller.signal, pollIntervalMs: 10 }); }
    finally { clearTimeout(timer); completion.mockRestore(); await stopPgBoss(); }
    expect(ownCompletion).toBe(true); expect(ownJobId).toEqual(expect.any(String));
    const completionState = await runInPrincipalDatabaseTransaction(admin, async (tx) => ({
      event: await tx.outboxEvent.findUniqueOrThrow({ where: { id: ownIntent.id } }),
      runs: await tx.jobRun.findMany({ where: { outboxEventId: ownIntent.id } }),
    }));
    expect(completionState.event.status).toBe("PROCESSED");
    expect(completionState.runs).toContainEqual(expect.objectContaining({ status: "SUCCESS" }));
    const queue = await getPgBoss();
    expect((await queue.getJobById("outbox.dispatch", ownJobId!))?.state).toBe("completed");
    await stopPgBoss();
    const request = () => new Request(`http://127.0.0.1/api/snapshots/${scope.organizationId}/${scope.projectId}/current`, { headers: { authorization: `Bearer ${token}` } });
    const response = await handleSnapshotConsumerGet(request(), scope);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const { manifest: rawManifest } = await response.json();
    const manifest = snapshotManifestV1Schema.parse(rawManifest);
    const files: Record<string, Uint8Array> = {};
    for (const file of manifest.files) {
      const artifact = await handleSnapshotConsumerGet(request(), { ...scope, publishSequence: String(manifest.publishSequence), kind: file.kind });
      expect(artifact.status).toBe(200); files[file.key] = new Uint8Array(await artifact.arrayBuffer());
    }
    const verified = verifySnapshotPublicArtifacts({ manifest, files, trustSet: { currentKeyId: "synthetic", nextKeyId: null,
      revokedKeyIds: [], publicKeys: { synthetic: publicKey } }, expectedProjectId: scope.projectId, supportedSchemaMajor: 1, lastGood: null });
    expect(verified.accepted).toBe(true);
    if (!verified.accepted) throw new Error("SYNTHETIC_PORTABLE_VERIFY_FAILED");
    const inventory = verified.datasets.inventory.map((row) => publicInventoryDtoSchema.parse(row));
    expect(inventory.map((row) => row.uid).sort()).toEqual(broken.identities.map((row) => row.uid).sort());
    expect(new Set(inventory.map((row) => row.propertyType))).toEqual(new Set([
      "APARTMENT", "ROOM", "HOUSE", "HOUSE_PART", "LAND", "COTTAGE", "TOWNHOUSE", "GARAGE_BOX", "NEW_BUILD_UNIT", "COMMERCIAL",
    ]));
    expect(new Set(inventory.map((row) => row.transactionType))).toEqual(new Set(["SALE", "RENT"]));
    for (const row of inventory) expect(row.price).toBe(row.uid === missing.uid ? 1000 : 1100);
    const publicJson = JSON.stringify(verified.datasets);
    expect(publicJson).not.toContain("PRIVATE-APARTMENT"); expect(publicJson).not.toContain("<script>");
    expect(publicJson).not.toContain("SYN-0");
    expect(publicJson).not.toContain("?token="); expect(manifest.sourceRevisions).toContain(second.source.lastGoodRevisionId);
    const ack = { projectId: scope.projectId, publishSequence: manifest.publishSequence, applied: true,
      manifestSha256: createHash("sha256").update(canonicalJsonBytes(manifest as CanonicalJsonValue)).digest("hex"), idempotencyKey: randomUUID() };
    const ackRequest = () => new Request(`http://127.0.0.1/api/snapshots/${scope.organizationId}/${scope.projectId}/ack`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(ack) });
    const accepted = await handleSnapshotConsumerAck(ackRequest(), scope);
    expect(accepted.status).toBe(200); expect((await accepted.json()).idempotent).toBe(false);
    const replay = await handleSnapshotConsumerAck(ackRequest(), scope);
    expect(replay.status).toBe(200); expect((await replay.json()).idempotent).toBe(true);
    expect(await runInPrincipalDatabaseTransaction(admin, (tx) => tx.deliveryRun.findFirstOrThrow({ where: { ...scope, publishSequence: manifest.publishSequence } })))
      .toMatchObject({ status: "ACKNOWLEDGED" });
  } finally {
    await stopPgBoss(); sdk.mockRestore(); vi.unstubAllEnvs();
    wire.dns.mockReset(); wire.https.mockReset(); wire.http.mockReset();
  }
}, 180_000);
