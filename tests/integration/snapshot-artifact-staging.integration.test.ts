import { generateKeyPairSync, randomUUID } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { canonicalJson, createUlid, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";

const cuts = vi.hoisted(() => ({ active: 0, roles: 0,
  afterInitialReplay: null as (() => Promise<void>) | null }));
vi.mock("../../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = async (context, execute, options) => {
    const result = await actual.runInAuthorizedDatabaseTransaction(context, async (tx) => {
      const snapshot = ["snapshot-input", "snapshot-publication", "outbox-claim", "outbox-takeover", "outbox-complete"].includes(context.actorId);
      if (snapshot) {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]); cuts.roles++;
      }
      // Observer queries in the SDK test transport are not producer transactions.
      const track = snapshot && context.correlationId !== "synthetic-binding-observer";
      if (track) cuts.active++;
      try { return await execute(tx); } finally { if (track) cuts.active--; }
    }, options);
    if (context.actorId === "snapshot-publication" && context.correlationId === "synthetic-cancel-replay-race"
      && cuts.afterInitialReplay) {
      const after = cuts.afterInitialReplay; cuts.afterInitialReplay = null;
      await after(); // Actual transaction has committed and released its locks.
    }
    return result;
  };
  const system: typeof actual.runInSystemJobDatabaseTransaction = (input, execute) =>
    authorized(actual.createSystemJobDatabaseAuthorizationContext(input), execute);
  return { ...actual, runInAuthorizedDatabaseTransaction: authorized, runInSystemJobDatabaseTransaction: system };
});
import { captureSnapshotInput, createSnapshotArtifactStagingServer, createSnapshotPublicationServer, createSnapshotSignedBuildServer,
  PrismaSnapshotPublicationRepository, PrismaSnapshotDeliveryRepository } from "../../src/modules/snapshot-delivery/server.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import { calculateObjectSha256, createMediaKey } from "../../src/platform/storage/object-storage.ts";
import { S3ObjectStorage } from "../../src/platform/storage/timeweb-s3-object-storage.ts";
import { defineSecretRef } from "../../src/platform/security/secret-ref.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { createSnapshotBuildCapability } from "../../src/infrastructure/snapshot-build-capability.ts";
import { enqueueSourceGoodSnapshot } from "../../src/modules/ingestion-core/infrastructure/source-snapshot-intent.ts";
import { analyzeImportSafety, BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../../src/modules/ingestion-core/index.ts";
import { ReliabilityService } from "../../src/modules/platform-operations/application/reliability-service.ts";
import { PrismaReliabilityRepository } from "../../src/modules/platform-operations/infrastructure/prisma-reliability-repository.ts";
import { Prisma } from "../../src/generated/prisma/client.ts";
import { drainOutboxWithDependencies } from "../../src/modules/platform-operations/worker.ts";

async function fixture(withMedia = false) {
  const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-binding-admin", correlationId: randomUUID() };
  const setup = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const suffix = randomUUID().slice(0, 8);
    const org = await tx.organization.create({ data: { name: "Synthetic binding", slug: `binding-${suffix}` } });
    const instant = new Date("2026-10-07T01:02:03.789Z");
    const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic binding",
      slug: `binding-${suffix}`, createdAt: instant } });
    expect(project.createdAt).toEqual(instant);
    expect(await tx.$queryRaw`SELECT (extract(epoch FROM "createdAt") * 1000)::bigint::text AS epoch
      FROM "Project" WHERE "id" = ${project.id}`).toEqual([{ epoch: String(instant.getTime()) }]);
    const foreign = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic foreign", slug: `binding-b-${suffix}` } });
    const scope = { organizationId: org.id, projectId: project.id };
    await tx.projectCatalogSubscription.create({ data: { ...scope, mode: "CURATED",
      cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
      update: { jobsFrozen: false, unfrozenAt: new Date() } });
    let mediaId: string | null = null;
    if (withMedia) {
      const asset = await tx.mediaAsset.create({ data: { ...scope, sha256: "a".repeat(64), storageKey: createMediaKey("a".repeat(64)),
        contentType: "image/jpeg", byteSize: 100, originalFileName: "synthetic-private-file", source: "synthetic-private-source",
        rightsBasis: "LICENSED", license: "synthetic-private-license", uploadedBy: "synthetic" } });
      mediaId = asset.id;
      await tx.agent.create({ data: { ...scope, uid: createUlid(), slug: "synthetic-public-agent", fullName: "Synthetic public Agent",
        showOnSite: true, consentConfirmedAt: instant, photoMediaId: asset.id } });
    }
    return { scope, foreignId: foreign.id, mediaId };
  });
  const principal = createProjectJobPrincipal({ ...setup.scope, jobName: "snapshot-input" });
  const receipt = await captureSnapshotInput(principal, { ...setup.scope, idempotencyKey: "synthetic-binding", schemaMinor: 0 });
  const lookup = { idempotencyKeyHash: receipt.idempotencyKeyHash, requestHash: receipt.requestHash };
  return { ...setup, principal, receipt, lookup };
}
function observer<T>(scope: { organizationId: string; projectId: string }, execute: (tx: DatabaseTransaction) => Promise<T>,
  actorId = "snapshot-publication", projectIds: readonly string[] | "*" = [scope.projectId], principalKind: "project-job" | "job" = "project-job") {
  return runInAuthorizedDatabaseTransaction({ principalKind, actorId, organizationId: scope.organizationId,
    projectIds, correlationId: "synthetic-binding-observer" }, execute, { isolationLevel: "ReadCommitted", timeout: 5000 });
}

describe("actual capture/sign/bind and immutable S3 artifact staging", () => {
  it("executes a canonical GOOD intent through the enabled capability and replays committed publication after lease recovery", async () => {
    const setup = await fixture(); const { scope } = setup;
    const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-executor-setup", correlationId: randomUUID() };
    const intent = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const source = await tx.source.create({ data: { ...scope, sourceKey: "synthetic-executor", name: "Synthetic executor",
        adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
        datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" } } });
      const target = { ...scope, sourceId: source.id };
      // Fixture-only empty GOOD. No real feed, imported inventory or provider IO.
      const policy = { ...BOOTSTRAP_SOURCE_SAFETY_POLICY, allowEmpty: true };
      const analysis = analyzeImportSafety({ recordCount: 0, previousGoodRecordCount: null, invalidRecordCount: 0, issues: [] }, policy);
      const revision = await tx.sourceRevision.create({ data: { ...target, sourceVersion: source.version,
        adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey, profileVersion: source.profileVersion,
        safetyPolicy: policy, safetyAnalysis: JSON.parse(JSON.stringify(analysis)) as Prisma.InputJsonObject, recordCount: 0 } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence: 1,
        rawStorageKey: "synthetic-private/executor", rawArtifactHash: "a".repeat(64), rawByteCount: 1,
        normalizedContentHash: "b".repeat(64), completedAt: new Date() } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
      await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: revision.id } });
      const producer = createProjectJobPrincipal({ ...scope, jobName: "source-import", correlationId: randomUUID() });
      if (producer.kind !== "project-job") throw new Error("SYNTHETIC_PRODUCER_PRINCIPAL_INVALID");
      const queued = await enqueueSourceGoodSnapshot(tx, producer, target, { revisionId: revision.id, sequence: 1 });
      // The shared integration DB also holds earlier fixtures' valid intents.
      // Give only our event a historical availability and claim with the same
      // synthetic clock; do not settle/delete another fixture's pending work.
      await tx.outboxEvent.update({ where: { id: queued.outboxEventId }, data: { availableAt: new Date("2000-01-01T00:00:00.000Z") } });
      return queued;
    });
    let now = new Date("2000-01-01T00:00:01.000Z");
    const service = () => new ReliabilityService(new PrismaReliabilityRepository(), () => now);
    const first = await service().claim("synthetic-snapshot-worker", 1000, ["snapshot.build.request"]);
    expect(first?.outboxEventId).toBe(intent.outboxEventId); if (!first) throw new Error("SYNTHETIC_CLAIM_MISSING");
    const keys = generateKeyPairSync("ed25519"); const previous = process.env.SYNTHETIC_BINDING_SIGNING_KEY;
    process.env.SYNTHETIC_BINDING_SIGNING_KEY = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const env = { SNAPSHOT_BUILD_ENABLED: "true", PROJECT_SNAPSHOT_SIGNING_BINDINGS: JSON.stringify([{ ...scope,
      keyId: "synthetic-binding-key", privateKeyRef: "SYNTHETIC_BINDING_SIGNING_KEY", currentKeyId: "synthetic-binding-key",
      nextKeyId: null, revokedKeyIds: [], publicKeyRefs: { "synthetic-binding-key": "SYNTHETIC_PUBLIC_KEY" } }]),
      SYNTHETIC_PUBLIC_KEY: keys.publicKey.export({ format: "pem", type: "spki" }).toString() };
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      expect(cuts.active).toBe(0); expect(command).toBeInstanceOf(PutObjectCommand); return { ETag: "synthetic-etag" } as never;
    });
    const storage = new S3ObjectStorage({ bucket: "synthetic-durable-handler", client });
    const resolveStorage = vi.fn(() => storage);
    try {
      const handler = createSnapshotBuildCapability(resolveStorage, env); if (!handler) throw new Error("SYNTHETIC_CAPABILITY_MISSING");
      await handler(first); expect(send).toHaveBeenCalledTimes(14); expect(resolveStorage).toHaveBeenCalledOnce();
      const original = await observer(scope, (tx) => tx.deliveryRun.findFirstOrThrow());
      now = new Date(now.getTime() + 2000);
      const recovered = await service().claim("synthetic-snapshot-worker", 1000, ["snapshot.build.request"]);
      expect(recovered?.outboxEventId).toBe(intent.outboxEventId); expect(recovered?.attempt).toBe(2);
      if (!recovered) throw new Error("SYNTHETIC_RECOVERY_MISSING");
      await expect(service().complete(first)).rejects.toMatchObject({ code: "OUTBOX_LEASE_LOST" });
      delete process.env.SYNTHETIC_BINDING_SIGNING_KEY;
      await runInPrincipalDatabaseTransaction(admin, (tx) => tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } }));
      const restart = createSnapshotBuildCapability(() => { throw new Error("SYNTHETIC_REPLAY_MUST_NOT_RESOLVE_STORAGE"); },
        { ...env, SYNTHETIC_PUBLIC_KEY: "synthetic-missing-rotated-public-key" });
      if (!restart) throw new Error("SYNTHETIC_CAPABILITY_MISSING");
      // Replace only queue transport. Existing drain performs actual DB takeover,
      // handler invocation and fenced settlement, not a fixture completion shortcut.
      const queueComplete = vi.fn(async () => undefined);
      const queue = { fetch: vi.fn(async () => [{ id: "synthetic-recovered-job", data: { schemaVersion: 1, event: recovered } }]),
        send: vi.fn(), complete: queueComplete };
      await expect(drainOutboxWithDependencies({ workerId: "synthetic-restarted-worker", maxEvents: 1 }, {
        boss: queue as never, reliability: service(), heartbeat: vi.fn(async () => undefined),
        topics: ["snapshot.build.request"], handle: restart,
      })).resolves.toEqual({ claimed: 1, completed: 1, failed: 0 });
      expect(queueComplete).toHaveBeenCalledWith("outbox.dispatch", "synthetic-recovered-job", { status: "success" });
      expect(send).toHaveBeenCalledTimes(14);
      await observer(scope, async (tx) => {
        expect(await tx.deliveryRun.count()).toBe(1); expect((await tx.deliveryRun.findFirstOrThrow()).id).toBe(original.id);
        expect((await tx.projectCurrentSnapshotManifest.findFirstOrThrow()).publishSequence).toBe(original.publishSequence);
      });
      await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        expect((await tx.outboxEvent.findUniqueOrThrow({ where: { id: intent.outboxEventId } })).status).toBe("PROCESSED");
        expect((await tx.jobRun.findUniqueOrThrow({ where: { id: recovered.jobRunId } })).status).toBe("SUCCESS");
      });
    } finally {
      await runInPrincipalDatabaseTransaction(admin, (tx) => tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: false, unfrozenAt: new Date() } }));
      if (previous === undefined) delete process.env.SYNTHETIC_BINDING_SIGNING_KEY; else process.env.SYNTHETIC_BINDING_SIGNING_KEY = previous;
      send.mockRestore(); client.destroy();
    }
  }, 60_000);
  it.each(["head", "artifacts", "manifest", "bound-head", "bound-artifacts"])("cancels active %s SDK work and joins every owned request before returning", async (mode) => {
    const phase = mode.replace("bound-", ""); const boundAbort = mode.startsWith("bound-");
    const setup = await fixture(phase === "head"); const controller = new AbortController(); const invocation = new AbortController();
    const keys = generateKeyPairSync("ed25519"); const previous = process.env.SYNTHETIC_BINDING_SIGNING_KEY;
    process.env.SYNTHETIC_BINDING_SIGNING_KEY = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    let active = 0; let aborted = 0; let artifacts = 0; let manifests = 0;
    const transport = async (command: unknown, options: unknown) => {
      expect(cuts.active).toBe(0);
      const signal = (options as { abortSignal?: AbortSignal })?.abortSignal;
      expect(signal).toBeInstanceOf(AbortSignal);
      if (!signal) throw new Error("SYNTHETIC_MISSING_ABORT_SIGNAL");
      const isHead = command instanceof HeadObjectCommand;
      const isManifest = command instanceof PutObjectCommand && command.input.ContentType === "application/json";
      if (command instanceof PutObjectCommand) { if (isManifest) manifests++; else artifacts++; }
      const held = (phase === "head" && isHead) || (phase === "artifacts" && !isHead && !isManifest) || (phase === "manifest" && isManifest);
      if (!held) return { ETag: "synthetic-etag" };
      active++;
      if (phase !== "artifacts" || artifacts === 13) queueMicrotask(() => controller.abort());
      try {
        await new Promise<never>((_resolve, reject) => {
          const cancel = () => { aborted++; setTimeout(() => reject(new Error("SYNTHETIC_TRANSPORT_ABORT")), aborted % 3); };
          if (signal.aborted) cancel(); else signal.addEventListener("abort", cancel, { once: true });
        });
      } finally { active--; }
    };
    const send = vi.spyOn(client, "send").mockImplementation(transport as never);
    try {
      await expect(createSnapshotPublicationServer({ ...setup.scope,
        ...(boundAbort ? { signal: controller.signal } : {}),
        storage: new S3ObjectStorage({ bucket: "synthetic-active-abort", client }), keyId: "synthetic-binding-key",
        privateKeyRef: defineSecretRef("SYNTHETIC_BINDING_SIGNING_KEY"), trustSet: { currentKeyId: "synthetic-binding-key", nextKeyId: null,
          revokedKeyIds: [], publicKeys: { "synthetic-binding-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } },
      })(setup.principal, setup.lookup, boundAbort ? invocation.signal : controller.signal)).rejects.toThrow("SNAPSHOT_PUBLICATION_CANCELLED");
      expect(invocation.signal.aborted).toBe(false);
      expect(active).toBe(0); expect(aborted).toBe(phase === "artifacts" ? 13 : 1);
      expect(artifacts).toBe(phase === "head" ? 0 : 13); expect(manifests).toBe(phase === "manifest" ? 1 : 0);
      const calls = send.mock.calls.length; await new Promise((resolve) => setTimeout(resolve, 10));
      expect(send).toHaveBeenCalledTimes(calls); expect(active).toBe(0);
      await observer(setup.scope, async (tx) => {
        expect(await tx.projectCurrentSnapshotManifest.count()).toBe(0); expect(await tx.deliveryRun.count()).toBe(0);
        expect(await tx.snapshotPublicationBinding.count()).toBe(phase === "head" ? 0 : 1);
      });
    } finally {
      controller.abort();
      if (previous === undefined) delete process.env.SYNTHETIC_BINDING_SIGNING_KEY; else process.env.SYNTHETIC_BINDING_SIGNING_KEY = previous;
      send.mockRestore(); client.destroy();
    }
  }, 60_000);
  it("replays a concurrent commit when cancelled just after initial no-run lookup", async () => {
    const setup = await fixture(); const { scope } = setup; const controller = new AbortController();
    const keys = generateKeyPairSync("ed25519"); const previous = process.env.SYNTHETIC_BINDING_SIGNING_KEY;
    process.env.SYNTHETIC_BINDING_SIGNING_KEY = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      expect(command).toBeInstanceOf(PutObjectCommand); return { ETag: "synthetic-etag" } as never;
    });
    const bound = { ...scope, storage: new S3ObjectStorage({ bucket: "synthetic-replay-race", client }), keyId: "synthetic-binding-key",
      privateKeyRef: defineSecretRef("SYNTHETIC_BINDING_SIGNING_KEY"), trustSet: { currentKeyId: "synthetic-binding-key", nextKeyId: null,
        revokedKeyIds: [], publicKeys: { "synthetic-binding-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } } };
    let committedId: string | undefined; let committedWrites = 0;
    cuts.afterInitialReplay = async () => {
      const run = await createSnapshotPublicationServer(bound)(setup.principal, setup.lookup);
      committedId = run.deliveryRunId; committedWrites = send.mock.calls.length; controller.abort();
    };
    try {
      const result = await createSnapshotPublicationServer(bound)({ ...setup.principal,
        correlationId: "synthetic-cancel-replay-race" }, setup.lookup, controller.signal);
      expect(committedId).toBeDefined(); expect(result.deliveryRunId).toBe(committedId);
      expect(committedWrites).toBe(14); expect(send).toHaveBeenCalledTimes(committedWrites);
      expect(cuts.afterInitialReplay).toBeNull();
    } finally {
      cuts.afterInitialReplay = null;
      if (previous === undefined) delete process.env.SYNTHETIC_BINDING_SIGNING_KEY; else process.env.SYNTHETIC_BINDING_SIGNING_KEY = previous;
      send.mockRestore(); client.destroy();
    }
  }, 60_000);
  it.each(["project", "source", "catalog", "media", "freeze", "cancel", "rollback"])("does not publish after post-PUT %s changes", async (mode) => {
    const setup = await fixture(mode === "media"); const { scope } = setup; const controller = new AbortController();
    const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-final-cut", correlationId: randomUUID() };
    const keys = generateKeyPairSync("ed25519"); const previous = process.env.SYNTHETIC_BINDING_SIGNING_KEY;
    process.env.SYNTHETIC_BINDING_SIGNING_KEY = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    let manifestPut = false;
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      expect(cuts.active).toBe(0);
      if (command instanceof HeadObjectCommand) {
        expect(mode).toBe("media"); expect(command.input.Key).toBe(createMediaKey("a".repeat(64)));
        return { ContentType: "image/jpeg", ContentLength: 100, ETag: "synthetic-etag", LastModified: new Date(0) } as never;
      }
      expect(command).toBeInstanceOf(PutObjectCommand);
      if (!(command instanceof PutObjectCommand)) throw new Error("SYNTHETIC_UNEXPECTED_IO");
      if (command.input.ContentType === "application/json") {
        manifestPut = true;
        await runInPrincipalDatabaseTransaction(admin, async (tx) => {
          if (mode === "project") await tx.project.update({ where: { id: scope.projectId }, data: { serviceState: "SUSPENDED" } });
          if (mode === "source") await tx.source.create({ data: { ...scope, sourceKey: "synthetic-post-put", name: "Synthetic post PUT",
            adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
            datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" } } });
          if (mode === "catalog") await tx.projectCatalogSubscriptionCity.deleteMany({ where: scope });
          if (mode === "media") await tx.mediaAsset.update({ where: { id: setup.mediaId! }, data: { rightsBasis: "OWNED", license: null } });
          if (mode === "freeze") await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } });
        });
        if (mode === "cancel") controller.abort();
      }
      return { ETag: "synthetic-etag" } as never;
    });
    // Abort after actual DB writes but before transaction callback completes.
    const actualPublish = PrismaSnapshotDeliveryRepository.prototype.publishCurrentAndCreateRun;
    const publish = vi.spyOn(PrismaSnapshotDeliveryRepository.prototype, "publishCurrentAndCreateRun").mockImplementation(async function (this: PrismaSnapshotDeliveryRepository, input) {
      const run = await actualPublish.call(this, input); if (mode === "rollback") controller.abort(); return run;
    });
    try {
      const expected = { project: "SNAPSHOT_PUBLICATION_PROJECT_BLOCKED", source: "SNAPSHOT_PUBLICATION_SOURCE_STALE",
        catalog: "SNAPSHOT_PUBLICATION_CATALOG_STALE", media: "SNAPSHOT_PUBLICATION_MEDIA_STALE", freeze: "SNAPSHOT_PUBLICATION_JOBS_FROZEN",
        cancel: "SNAPSHOT_PUBLICATION_CANCELLED", rollback: "SNAPSHOT_PUBLICATION_CANCELLED" }[mode];
      await expect(createSnapshotPublicationServer({ ...scope, storage: new S3ObjectStorage({ bucket: "synthetic-final-cut", client }),
        keyId: "synthetic-binding-key", privateKeyRef: defineSecretRef("SYNTHETIC_BINDING_SIGNING_KEY"), trustSet: {
          currentKeyId: "synthetic-binding-key", nextKeyId: null, revokedKeyIds: [],
          publicKeys: { "synthetic-binding-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } },
      })(setup.principal, setup.lookup, controller.signal)).rejects.toThrow(expected);
      expect(manifestPut).toBe(true);
      await observer(scope, async (tx) => {
        expect(await tx.snapshotPublicationBinding.count()).toBe(1);
        expect(await tx.projectCurrentSnapshotManifest.count()).toBe(0); expect(await tx.deliveryRun.count()).toBe(0);
      });
      if (mode === "rollback") expect(publish).toHaveBeenCalledOnce(); else expect(publish).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.SYNTHETIC_BINDING_SIGNING_KEY; else process.env.SYNTHETIC_BINDING_SIGNING_KEY = previous;
      publish.mockRestore(); send.mockRestore(); client.destroy();
    }
  }, 30_000);

  it("publishes atomically and replays after restart/rotation without IO or moving newer current", async () => {
    const setup = await fixture(); const { scope } = setup;
    const keys = generateKeyPairSync("ed25519"); const previous = process.env.SYNTHETIC_BINDING_SIGNING_KEY;
    process.env.SYNTHETIC_BINDING_SIGNING_KEY = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      // Other concurrent invocations may own a DB cut; the serial post-PUT
      // tests above trace that this invocation itself performs IO outside DB.
      expect(command).toBeInstanceOf(PutObjectCommand); return { ETag: "synthetic-etag" } as never;
    });
    const bound = { ...scope, storage: new S3ObjectStorage({ bucket: "synthetic-final-cut", client }), keyId: "synthetic-binding-key",
      privateKeyRef: defineSecretRef("SYNTHETIC_BINDING_SIGNING_KEY"), trustSet: { currentKeyId: "synthetic-binding-key", nextKeyId: null,
        revokedKeyIds: [], publicKeys: { "synthetic-binding-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } } };
    try {
      const runs = await Promise.all([1, 2].map(() => createSnapshotPublicationServer(bound)(setup.principal, setup.lookup)));
      expect(runs[0]).toEqual(runs[1]); const run = runs[0]!;
      expect(run.status).toBe("PENDING"); const before = send.mock.calls.length;
      await observer(scope, async (tx) => {
        expect(await tx.deliveryRun.count()).toBe(1);
        expect((await tx.projectCurrentSnapshotManifest.findFirstOrThrow()).manifestSha256).toBe(run.manifestSha256);
      });
      const next = await captureSnapshotInput(setup.principal, { ...scope, idempotencyKey: "synthetic-next-publication", schemaMinor: 0 });
      await createSnapshotPublicationServer(bound)(setup.principal, { idempotencyKeyHash: next.idempotencyKeyHash, requestHash: next.requestHash });
      expect(send.mock.calls.length).toBeGreaterThan(before); const afterNewer = send.mock.calls.length;
      delete process.env.SYNTHETIC_BINDING_SIGNING_KEY; // A committed receipt must not resolve any signer.
      const replay = await createSnapshotPublicationServer({ ...bound, keyId: "synthetic-rotated-unconfigured",
        trustSet: { currentKeyId: "synthetic-rotated-unconfigured", nextKeyId: null, revokedKeyIds: [bound.keyId], publicKeys: {} },
      })(setup.principal, setup.lookup);
      expect(replay).toEqual(run); expect(send).toHaveBeenCalledTimes(afterNewer);
      await observer(scope, async (tx) => {
        expect(await tx.deliveryRun.count()).toBe(2);
        expect((await tx.projectCurrentSnapshotManifest.findFirstOrThrow()).publishSequence).toBe(next.publishSequence);
      });
      await expect(createSnapshotPublicationServer(bound)(createProjectJobPrincipal({ ...scope, projectId: setup.foreignId,
        jobName: "snapshot-input" }), setup.lookup)).rejects.toThrow("SNAPSHOT_INPUT_ACCESS_DENIED");
      expect(send).toHaveBeenCalledTimes(afterNewer);
    } finally {
      if (previous === undefined) delete process.env.SYNTHETIC_BINDING_SIGNING_KEY; else process.env.SYNTHETIC_BINDING_SIGNING_KEY = previous;
      send.mockRestore(); client.destroy();
    }
  }, 60_000);
  it("returns concurrent committed success even when its own manifest PUT then fails", async () => {
    const setup = await fixture(); const { scope } = setup;
    const keys = generateKeyPairSync("ed25519"); const previous = process.env.SYNTHETIC_BINDING_SIGNING_KEY;
    process.env.SYNTHETIC_BINDING_SIGNING_KEY = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    const bound = { ...scope, storage: new S3ObjectStorage({ bucket: "synthetic-concurrent-cut", client }), keyId: "synthetic-binding-key",
      privateKeyRef: defineSecretRef("SYNTHETIC_BINDING_SIGNING_KEY"), trustSet: { currentKeyId: "synthetic-binding-key", nextKeyId: null,
        revokedKeyIds: [], publicKeys: { "synthetic-binding-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } } };
    let nested = false; let committedId: string | undefined;
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      expect(command).toBeInstanceOf(PutObjectCommand);
      if (command instanceof PutObjectCommand && command.input.ContentType === "application/json" && !nested) {
        nested = true;
        const run = await createSnapshotPublicationServer(bound)(setup.principal, setup.lookup);
        committedId = run.deliveryRunId;
        // The other invocation is durable before this owned attempt fails.
        throw new Error("SYNTHETIC_AFTER_CONCURRENT_COMMIT_PUT_FAILURE");
      }
      return { ETag: "synthetic-etag" } as never;
    });
    try {
      const result = await createSnapshotPublicationServer(bound)(setup.principal, setup.lookup);
      expect(committedId).toBeDefined(); expect(result.deliveryRunId).toBe(committedId);
      await observer(scope, async (tx) => {
        expect(await tx.snapshotPublicationBinding.count()).toBe(1); expect(await tx.deliveryRun.count()).toBe(1);
        expect((await tx.projectCurrentSnapshotManifest.findFirstOrThrow()).manifestSha256).toBe(result.manifestSha256);
      });
    } finally {
      if (previous === undefined) delete process.env.SYNTHETIC_BINDING_SIGNING_KEY; else process.env.SYNTHETIC_BINDING_SIGNING_KEY = previous;
      send.mockRestore(); client.destroy();
    }
  }, 60_000);

  it("rejects a changed Source cohort before binding or any artifact PUT", async () => {
    const setup = await fixture();
    await runInPrincipalDatabaseTransaction({ kind: "platform-admin", userId: "synthetic-fresh-staging", correlationId: randomUUID() },
      (tx) => tx.source.create({ data: { ...setup.scope, sourceKey: "synthetic-added-after-capture", name: "Synthetic added source",
        adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
        datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" } } }));
    const keys = generateKeyPairSync("ed25519"); const previous = process.env.SYNTHETIC_BINDING_SIGNING_KEY;
    process.env.SYNTHETIC_BINDING_SIGNING_KEY = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    const send = vi.spyOn(client, "send").mockResolvedValue({ ETag: "synthetic-etag" } as never);
    try {
      await expect(createSnapshotArtifactStagingServer({ ...setup.scope,
        storage: new S3ObjectStorage({ bucket: "synthetic-binding-bucket", client }), keyId: "synthetic-binding-key",
        privateKeyRef: defineSecretRef("SYNTHETIC_BINDING_SIGNING_KEY"), trustSet: { currentKeyId: "synthetic-binding-key",
          nextKeyId: null, revokedKeyIds: [], publicKeys: {
            "synthetic-binding-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } },
      })(setup.principal, setup.lookup)).rejects.toThrow("SNAPSHOT_PUBLICATION_SOURCE_STALE");
      expect(send).not.toHaveBeenCalled();
      await observer(setup.scope, async (tx) => {
        expect(await tx.snapshotPublicationBinding.count()).toBe(0);
        expect(await tx.projectCurrentSnapshotManifest.count()).toBe(0);
        expect(await tx.deliveryRun.count()).toBe(0);
      });
    } finally {
      if (previous === undefined) delete process.env.SYNTHETIC_BINDING_SIGNING_KEY; else process.env.SYNTHETIC_BINDING_SIGNING_KEY = previous;
      send.mockRestore(); client.destroy();
    }
  });

  it("binds before PUT, leaves no partial current after failure, replays on restart and denies key-rotation substitution", async () => {
    cuts.roles = 0; const setup = await fixture(); const { scope } = setup;
    const client = new S3Client({ endpoint: "https://synthetic-storage.example.invalid", region: "synthetic-1",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" }, forcePathStyle: true });
    const stored = new Map<string, { body: Uint8Array; contentType: string }>();
    let puts = 0; let fail = true; let firstPutProof: Promise<unknown> | undefined; let firstPutSettled = false;
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      expect(cuts.active).toBe(0);
      if (command instanceof PutObjectCommand) {
        const index = ++puts;
        if (index === 1) {
          firstPutProof = observer(scope, async (tx) => {
            expect(await tx.snapshotPublicationBinding.count()).toBe(1);
            expect(await tx.deliveryRun.count()).toBe(0);
            expect(await tx.projectCurrentSnapshotManifest.count()).toBe(0);
          });
          await firstPutProof;
          firstPutSettled = true;
        }
        if (fail && index === 3) throw new Error("SYNTHETIC_PARTIAL_PUT_FAILURE");
        expect(command.input.Key).toMatch(new RegExp(`^snapshots/${scope.projectId}/[a-f0-9]{64}$`, "u"));
        expect(command.input.Body).toBeInstanceOf(Uint8Array);
        stored.set(command.input.Key!, { body: Uint8Array.from(command.input.Body as Uint8Array), contentType: command.input.ContentType! });
        return { ETag: "synthetic-etag" } as never;
      }
      if (command instanceof GetObjectCommand) {
        const object = stored.get(command.input.Key!); if (!object) throw Object.assign(new Error(), { name: "NoSuchKey" });
        return { Body: { transformToByteArray: async () => object.body }, ContentType: object.contentType,
          ContentLength: object.body.byteLength, LastModified: new Date(0), ETag: "synthetic-etag" } as never;
      }
      throw new Error("SYNTHETIC_UNEXPECTED_S3_OPERATION");
    });
    const storage = new S3ObjectStorage({ bucket: "synthetic-binding-bucket", client });
    const keys = generateKeyPairSync("ed25519"); const rotated = generateKeyPairSync("ed25519");
    const previous = process.env.SYNTHETIC_BINDING_SIGNING_KEY;
    process.env.SYNTHETIC_BINDING_SIGNING_KEY = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const bound = { ...scope, storage, keyId: "synthetic-binding-key", privateKeyRef: defineSecretRef("SYNTHETIC_BINDING_SIGNING_KEY"),
      trustSet: { currentKeyId: "synthetic-binding-key", nextKeyId: null, revokedKeyIds: [],
        publicKeys: { "synthetic-binding-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } } };
    try {
      const signed = await createSnapshotSignedBuildServer(bound)(setup.principal, setup.lookup);
      const text = canonicalJson(signed.manifest as CanonicalJsonValue);
      // Compare independently in PostgreSQL, without logging the signed payload.
      expect(await observer(scope, (tx) => tx.$queryRaw`
        SELECT (m->>'projectId' = r."projectId") AS project,
          (current_setting('TimeZone') = 'UTC') AS "utcSession",
          (m->>'schemaMajor' = '1') AS major,
          (m->>'schemaMinor' = r."schemaMinor"::text) AS minor,
          (m->>'publishSequence' = r."publishSequence"::text) AS sequence,
          (m->>'catalogRevision' = r."catalogRevision"::text) AS catalog,
          ((m->>'generatedAt')::timestamptz = r."capturedAt") AS generated,
          ((m->>'publishedAt')::timestamptz = r."capturedAt") AS published,
          (extract(epoch FROM ((m->>'generatedAt')::timestamptz - r."capturedAt")) * 1000)::int AS "timestampDeltaMs",
          (jsonb_array_length(m->'files') = 13) AS files,
          (jsonb_typeof(m->'signature') = 'string') AS signature
        FROM "SnapshotBuildInput" r CROSS JOIN (SELECT ${text}::jsonb AS m) payload
        WHERE r."id" = ${setup.receipt.id}
      `)).toEqual([{ project: true, utcSession: true, major: true, minor: true, sequence: true, catalog: true,
        generated: true, published: true, timestampDeltaMs: 0, files: true, signature: true }]);
      await expect(createSnapshotArtifactStagingServer(bound)(setup.principal, setup.lookup)).rejects.toThrow("SYNTHETIC_PARTIAL_PUT_FAILURE");
      expect(firstPutSettled).toBe(true);
      await firstPutProof;
      const binding = await observer(scope, (tx) => tx.snapshotPublicationBinding.findFirstOrThrow());
      expect(binding.buildInputId).toBe(setup.receipt.id); expect(binding.inputHash).toBe(setup.receipt.inputHash);
      expect(stored.size).toBeGreaterThan(0);
      expect([...stored.values()].every((object) => object.contentType === "application/gzip")).toBe(true);
      fail = false;
      const staged = await createSnapshotArtifactStagingServer(bound)(setup.principal, setup.lookup); // Fresh factory models process restart.
      expect(staged.binding).toEqual(binding);
      expect(staged.current.manifestSha256).toBe(binding.manifestSha256);
      const object = await storage.get(staged.current.manifestKey);
      expect(calculateObjectSha256(object!.body)).toBe(binding.manifestSha256);
      expect(new TextDecoder().decode(object!.body)).toBe(binding.manifestCanonical);
      await observer(scope, async (tx) => {
        expect(await tx.snapshotPublicationBinding.count()).toBe(1);
        expect(await tx.deliveryRun.count()).toBe(0); expect(await tx.projectCurrentSnapshotManifest.count()).toBe(0);
      });
      const beforeRotation = puts;
      process.env.SYNTHETIC_BINDING_SIGNING_KEY = rotated.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      await expect(createSnapshotArtifactStagingServer({ ...bound, keyId: "synthetic-rotated-key", trustSet: {
        currentKeyId: "synthetic-rotated-key", nextKeyId: null, revokedKeyIds: [],
        publicKeys: { "synthetic-rotated-key": rotated.publicKey.export({ format: "pem", type: "spki" }).toString() },
      } })(setup.principal, setup.lookup)).rejects.toThrow("SNAPSHOT_PUBLICATION_BINDING_CONFLICT");
      expect(puts).toBe(beforeRotation);
      expect(await observer(scope, (tx) => tx.snapshotPublicationBinding.findFirstOrThrow())).toEqual(binding);
      await expect(createSnapshotArtifactStagingServer(bound)(createProjectJobPrincipal({ ...scope,
        projectId: setup.foreignId, jobName: "snapshot-input" }), setup.lookup)).rejects.toThrow("SNAPSHOT_INPUT_ACCESS_DENIED");
      expect(cuts.roles).toBeGreaterThan(6);
    } finally {
      if (previous === undefined) delete process.env.SYNTHETIC_BINDING_SIGNING_KEY; else process.env.SYNTHETIC_BINDING_SIGNING_KEY = previous;
      send.mockRestore(); client.destroy();
    }
  }, 60_000);

  it("enforces exact binding/receipt scope, immutable grants and header/hash checks independently of the server seam", async () => {
    const setup = await fixture(); const { scope, receipt } = setup;
    // Real signed server output establishes the DB identity; the SDK remains synthetic.
    const keys = generateKeyPairSync("ed25519"); const previous = process.env.SYNTHETIC_BINDING_SIGNING_KEY;
    process.env.SYNTHETIC_BINDING_SIGNING_KEY = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    const send = vi.spyOn(client, "send").mockResolvedValue({ ETag: "synthetic-etag" } as never);
    try {
      const stage = createSnapshotArtifactStagingServer({ ...scope, storage: new S3ObjectStorage({ bucket: "synthetic-binding-bucket", client }),
        keyId: "synthetic-binding-key", privateKeyRef: defineSecretRef("SYNTHETIC_BINDING_SIGNING_KEY"), trustSet: {
          currentKeyId: "synthetic-binding-key", nextKeyId: null, revokedKeyIds: [],
          publicKeys: { "synthetic-binding-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } } });
      const result = await stage(setup.principal, setup.lookup);
      for (const projects of ["*", [], [scope.projectId, setup.foreignId], [setup.foreignId]] as const) {
        expect(await observer(scope, (tx) => tx.snapshotPublicationBinding.count(), "snapshot-publication", projects)).toBe(0);
      }
      expect(await observer(scope, (tx) => tx.snapshotPublicationBinding.count(), "snapshot-publication", [scope.projectId], "job")).toBe(0);
      expect(await observer(scope, (tx) => tx.snapshotPublicationBinding.count(), "snapshot-input")).toBe(0);
      await expect(observer(scope, (tx) => new PrismaSnapshotPublicationRepository(tx).bind({ ...scope,
        projectId: setup.foreignId, receiptId: receipt.id, inputHash: receipt.inputHash,
        manifest: { ...result.manifest, projectId: setup.foreignId } }))).rejects.toThrow();
      const { createdAt: _createdAt, ...identity } = result.binding; void _createdAt;
      await expect(observer(scope, (tx) => tx.snapshotPublicationBinding.create({ data: { ...identity, inputHash: "f".repeat(64) } })))
        .rejects.toThrow("SNAPSHOT_PUBLICATION_RECEIPT_INVALID");
      const wrongHeader = canonicalJson({ ...result.manifest, catalogRevision: "f".repeat(64) } as CanonicalJsonValue);
      await expect(observer(scope, (tx) => tx.snapshotPublicationBinding.create({ data: { ...identity,
        manifestCanonical: wrongHeader, manifestSha256: calculateObjectSha256(new TextEncoder().encode(wrongHeader)) } })))
        .rejects.toThrow("SNAPSHOT_PUBLICATION_MANIFEST_INVALID");
      const wrongTime = canonicalJson({ ...result.manifest,
        generatedAt: new Date(new Date(result.manifest.generatedAt).getTime() + 1).toISOString() } as CanonicalJsonValue);
      await expect(observer(scope, (tx) => tx.snapshotPublicationBinding.create({ data: { ...identity,
        manifestCanonical: wrongTime, manifestSha256: calculateObjectSha256(new TextEncoder().encode(wrongTime)) } })))
        .rejects.toThrow("SNAPSHOT_PUBLICATION_MANIFEST_INVALID");
      await expect(observer(scope, (tx) => tx.snapshotPublicationBinding.create({ data: { ...identity, manifestSha256: "f".repeat(64) } })))
        .rejects.toThrow();
      await expect(observer(scope, (tx) => tx.$executeRaw`UPDATE "SnapshotPublicationBinding" SET "keyId" = 'synthetic-forged'`)).rejects.toThrow();
      await expect(observer(scope, (tx) => tx.$executeRaw`DELETE FROM "SnapshotPublicationBinding"`)).rejects.toThrow();
      await expect(observer(scope, (tx) => tx.project.updateMany({ where: { id: scope.projectId },
        data: { name: "synthetic-forged" } }))).rejects.toThrow();
      await observer(scope, async (tx) => {
        expect(await tx.$queryRawUnsafe("SELECT has_table_privilege(current_user, 'public.\"SnapshotPublicationBinding\"', 'UPDATE') AS allowed"))
          .toEqual([{ allowed: false }]);
        expect(await tx.project.findFirst({ where: { id: scope.projectId } })).not.toBeNull();
        expect(await tx.snapshotPublicationBinding.findFirstOrThrow()).toEqual(result.binding);
      });
    } finally {
      if (previous === undefined) delete process.env.SYNTHETIC_BINDING_SIGNING_KEY; else process.env.SYNTHETIC_BINDING_SIGNING_KEY = previous;
      send.mockRestore(); client.destroy();
    }
  }, 60_000);
});
