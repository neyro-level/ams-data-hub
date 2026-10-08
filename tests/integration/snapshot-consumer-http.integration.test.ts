import { generateKeyPairSync, randomUUID } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";

const cuts = vi.hoisted(() => ({ active: 0, afterAuth: null as (() => void) | null, beforeAck: null as (() => Promise<void>) | null,
  acceptanceCorrelation: null as string | null, acceptancePid: null as number | null }));
vi.mock("../../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = async (context, execute, options) => {
    const result = await actual.runInAuthorizedDatabaseTransaction(context, async (tx) => {
      if (context.correlationId === cuts.acceptanceCorrelation) {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_web");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]);
        const [backend] = await tx.$queryRawUnsafe<{ pid: number }[]>("SELECT pg_backend_pid() AS pid");
        cuts.acceptancePid = backend!.pid;
      }
      const consumer = context.principalKind === "snapshot-consumer";
      if (consumer || ["snapshot-input", "snapshot-publication", "snapshot-notifier"].includes(context.actorId)) {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${consumer ? "ams_data_hub_web" : "ams_data_hub_worker"}`);
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]);
      }
      cuts.active++;
      try {
        if (context.actorId === "snapshot-consumer-ack" && cuts.beforeAck) {
          const hook = cuts.beforeAck; cuts.beforeAck = null; await hook();
        }
        return await execute(tx);
      } finally { cuts.active--; }
    }, options);
    if (context.actorId === "snapshot-consumer-auth" && cuts.afterAuth) {
      const hook = cuts.afterAuth; cuts.afterAuth = null; hook();
    }
    return result;
  };
  const principal: typeof actual.runInPrincipalDatabaseTransaction = (context, execute) =>
    authorized(actual.createDatabaseAuthorizationContext(context), execute);
  return { ...actual, runInAuthorizedDatabaseTransaction: authorized, runInPrincipalDatabaseTransaction: principal };
});
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import { captureSnapshotInput, createSnapshotStagedBuildServer, createSnapshotPublicationServer,
  PrismaSnapshotDeliveryRepository, handleSnapshotConsumerGet, handleSnapshotConsumerAck } from "../../src/modules/snapshot-delivery/server.ts";
import { calculateObjectSha256 } from "../../src/platform/storage/object-storage.ts";
import { createSnapshotAckService } from "../../src/modules/snapshot-delivery/application/snapshot-ack.ts";
import { defineSecretRef } from "../../src/platform/security/secret-ref.ts";
import { S3ObjectStorage } from "../../src/platform/storage/timeweb-s3-object-storage.ts";
import { PrismaSnapshotRollbackRepository } from "../../src/modules/snapshot-delivery/infrastructure/prisma-snapshot-rollback-repository.ts";
import { createSourceExecutionServer } from "../../src/modules/ingestion-core/server.ts";
import { createSnapshotNotificationHandler, createProjectSnapshotWebhookResolver } from "../../src/modules/snapshot-delivery/server.ts";
import { SNAPSHOT_NOTIFICATION_TOPIC } from "../../src/modules/snapshot-delivery/contracts.ts";
import { ReliabilityService, type ClaimedReliabilityEvent } from "../../src/modules/platform-operations/index.ts";
import { PrismaReliabilityRepository } from "../../src/modules/platform-operations/server.ts";
import { executeSafeOutboundWebhook } from "../../src/platform/http/safe-outbound-core.ts";
import type { SnapshotTrustSet } from "../../src/modules/snapshot-delivery/contracts.ts";
import { createDataSafetyService } from "../../src/modules/platform-operations/application/data-safety-service.ts";
import { PrismaDataSafetyRepository } from "../../src/modules/platform-operations/infrastructure/prisma-data-safety-repository.ts";
import { createRawArtifactRetentionCutReader } from "../../src/infrastructure/raw-artifact-retention-cut.ts";
import { requestOperationalAction, createRawRetentionOperationReader } from "../../src/modules/operations-control/server.ts";
import { PrismaSnapshotInputRepository } from "../../src/modules/snapshot-delivery/server.ts";

async function fixture(publish = true) {
  const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-consumer-admin", correlationId: randomUUID() };
  const token = `synthetic-current-${randomUUID()}`;
  const scope = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const suffix = randomUUID();
    const org = await tx.organization.create({ data: { name: "Synthetic consumer", slug: suffix } });
    const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic consumer", slug: suffix } });
    const scope = { organizationId: org.id, projectId: project.id };
    await tx.projectCatalogSubscription.create({ data: { ...scope, mode: "CURATED", cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
      update: { jobsFrozen: false, unfrozenAt: new Date() } });
    await createSnapshotAckService({ repository: new PrismaSnapshotDeliveryRepository(tx), now: () => new Date() })
      .initializeCredential({ ...scope, token });
    return scope;
  });
  const pair = generateKeyPairSync("ed25519");
  const trustSet: SnapshotTrustSet = { currentKeyId: "synthetic", nextKeyId: null, revokedKeyIds: [],
    publicKeys: { synthetic: pair.publicKey.export({ format: "pem", type: "spki" }).toString() } };
  vi.stubEnv("SYNTHETIC_CONSUMER_PRIVATE", pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
  vi.stubEnv("SYNTHETIC_CONSUMER_PUBLIC", trustSet.publicKeys.synthetic!);
  vi.stubEnv("PROJECT_SNAPSHOT_SIGNING_BINDINGS", JSON.stringify([{ ...scope, currentKeyId: "synthetic", nextKeyId: null,
    revokedKeyIds: [], publicKeyRefs: { synthetic: "SYNTHETIC_CONSUMER_PUBLIC" } }]));
  vi.stubEnv("PROJECT_STORAGE_BINDINGS", JSON.stringify([{ ...scope, bucketRef: "SYNTHETIC_CONSUMER_BUCKET", endpointRef: "SYNTHETIC_CONSUMER_ENDPOINT",
    regionRef: "SYNTHETIC_CONSUMER_REGION", accessKeyIdRef: "SYNTHETIC_CONSUMER_ACCESS", secretAccessKeyRef: "SYNTHETIC_CONSUMER_SECRET" }]));
  for (const [name, value] of Object.entries({ SYNTHETIC_CONSUMER_BUCKET: "synthetic-consumer", SYNTHETIC_CONSUMER_ENDPOINT: "https://s3.twcstorage.ru",
    SYNTHETIC_CONSUMER_REGION: "ru-1", SYNTHETIC_CONSUMER_ACCESS: "synthetic-consumer-access", SYNTHETIC_CONSUMER_SECRET: "synthetic-consumer-secret" })) vi.stubEnv(name, value);
  const objects = new Map<string, Uint8Array>(); let gets = 0; let corrupt = false; let hook: (() => Promise<void>) | null = null;
  const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
    expect(cuts.active).toBe(0);
    if (command instanceof PutObjectCommand) { objects.set(command.input.Key!, Uint8Array.from(command.input.Body as Uint8Array)); return {} as never; }
    if (command instanceof HeadObjectCommand) return { ContentLength: objects.get(command.input.Key!)?.length ?? 0 } as never;
    if (command instanceof GetObjectCommand) {
      gets++; const bytes = objects.get(command.input.Key!); if (!bytes) throw new Error("SYNTHETIC_MISSING");
      if (hook) { const run = hook; hook = null; await run(); }
      return { ContentLength: bytes.length, ContentType: "application/octet-stream", LastModified: new Date(0),
        Body: { destroy() {}, async *[Symbol.asyncIterator]() { yield corrupt ? Uint8Array.from(bytes, (_byte, index) => index === 0 ? 0 : _byte) : bytes; } } } as never;
    }
    throw new Error("SYNTHETIC_UNEXPECTED_IO");
  });
  const client = new S3Client({ region: "ru-1", credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" } });
  const storage = new S3ObjectStorage({ client, bucket: "synthetic-consumer" });
  const principal = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input", correlationId: randomUUID() });
  try {
    const receipt = await captureSnapshotInput(principal, { ...scope, idempotencyKey: randomUUID(), schemaMinor: 0 });
    const lookup = { idempotencyKeyHash: receipt.idempotencyKeyHash, requestHash: receipt.requestHash };
    const bound = { ...scope, storage, trustSet, keyId: "synthetic", privateKeyRef: defineSecretRef("SYNTHETIC_CONSUMER_PRIVATE") };
    if (publish) await createSnapshotPublicationServer(bound)(principal, lookup);
    else await createSnapshotStagedBuildServer(bound)(principal, lookup);
    gets = 0;
    const params = { ...scope };
    const request = (credential = token, path = "current", signal?: AbortSignal) => new Request(`http://127.0.0.1/api/snapshots/${scope.organizationId}/${scope.projectId}/${path}`,
      { headers: { authorization: `Bearer ${credential}` }, signal });
    return { admin, scope, params, request, token, sequence: receipt.publishSequence, objects, bound, principal, storage, lookup,
      gets: () => gets, corrupt: () => { corrupt = true; }, hook: (value: () => Promise<void>) => { hook = value; },
      cleanup: () => { cuts.afterAuth = null; cuts.beforeAck = null; send.mockRestore(); client.destroy(); vi.unstubAllEnvs(); } };
  } catch (error) { send.mockRestore(); client.destroy(); vi.unstubAllEnvs(); throw error; }
}

describe("actual project-authenticated snapshot consumer HTTP and FORCE RLS", () => {
  it("serializes actual rollback acceptance behind retention and reads the old acknowledged non-current root on the next cut", async () => {
    const f = await fixture();
    const trace = vi.spyOn(PrismaSnapshotInputRepository.prototype, "find");
    let releaseFence: (() => void) | undefined;
    let holding: Promise<void> | undefined;
    let accepting: ReturnType<typeof requestOperationalAction> | undefined;
    try {
      expect((await handleSnapshotConsumerAck(ackRequest(f, await ackInput(f)), f.params)).status).toBe(200);
      expect((await readRun(f))?.status).toBe("ACKNOWLEDGED");
      const second = await captureSnapshotInput(f.principal, { ...f.scope, idempotencyKey: randomUUID(), schemaMinor: 0 });
      await createSnapshotPublicationServer(f.bound)(f.principal,
        { idempotencyKeyHash: second.idempotencyKeyHash, requestHash: second.requestHash });
      const context = { principalKind: "project-job" as const, actorId: "raw-artifact-retention",
        organizationId: f.scope.organizationId, projectIds: [f.scope.projectId], correlationId: randomUUID() };
      trace.mockClear();
      let markHeld!: (pid: number) => void;
      const held = new Promise<number>((resolve) => { markHeld = resolve; });
      const release = new Promise<void>((resolve) => { releaseFence = resolve; });
      holding = runInAuthorizedDatabaseTransaction(context, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect((await createRawArtifactRetentionCutReader(tx).read(f.scope)).coverage).toBe("COMPLETE");
        const [backend] = await tx.$queryRawUnsafe<{ pid: number }[]>("SELECT pg_backend_pid() AS pid");
        markHeld(backend!.pid); await release;
      });
      const blockerPid = await Promise.race([held, holding.then(() => { throw new Error("SYNTHETIC_RETENTION_FENCE_NOT_HELD"); })]);
      expect(trace.mock.calls.some((call) => call[2] === f.lookup.idempotencyKeyHash)).toBe(false);
      let settled = false;
      cuts.acceptanceCorrelation = randomUUID(); cuts.acceptancePid = null;
      accepting = requestOperationalAction({ ...f.admin, correlationId: cuts.acceptanceCorrelation }, { ...f.scope, action: "SNAPSHOT_ROLLBACK", sourcePublishSequence: f.sequence,
        sourceId: "", sourceRevisionId: "", reason: "", idempotencyKey: randomUUID() }).finally(() => { settled = true; });
      let blocked = false; const deadline = Date.now() + 1500;
      while (!blocked && Date.now() < deadline) {
        blocked = await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
          const [row] = await tx.$queryRawUnsafe<{ blocked: boolean }[]>(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid=$2::integer AND $1::integer=ANY(pg_blocking_pids(pid))) AS blocked",
            blockerPid, cuts.acceptancePid);
          return row!.blocked;
        });
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true); expect(settled).toBe(false);
      releaseFence?.(); await holding; await accepting;
      trace.mockClear();
      await runInAuthorizedDatabaseTransaction(context, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect((await createRawArtifactRetentionCutReader(tx).read(f.scope)).coverage).toBe("COMPLETE");
        expect((await createRawRetentionOperationReader(tx).read(f.scope)).sourcePublishSequences).toContain(f.sequence);
      });
      expect(trace.mock.calls.some((call) => call[2] === f.lookup.idempotencyKeyHash)).toBe(true);
    } finally {
      releaseFence?.(); const owned = await Promise.allSettled([holding, accepting]);
      trace.mockRestore(); cuts.acceptanceCorrelation = null; cuts.acceptancePid = null; f.cleanup();
      const failed = owned.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
  }, 30_000);
  it("reconciles populated private receipts through counts-only NOBYPASS web recovery and rejects stale clean markers", async () => {
    const f = await fixture();
    const recovery = createDataSafetyService({
      createRepository: (tx) => new PrismaDataSafetyRepository(tx),
      runInTransaction: (principal, execute) => runInAuthorizedDatabaseTransaction({
        principalKind: principal.kind, actorId: f.admin.userId, organizationId: null,
        projectIds: "*", correlationId: f.admin.correlationId,
      }, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_web");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]);
        return execute(tx);
      }),
    });
    const zeroes = { publicUrlIdConflicts: 0, uidConflicts: 0, publishSequenceConflicts: 0 };
    const ownAudits = () => runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.auditEvent.findMany({
      where: { correlationId: f.admin.correlationId, action: { startsWith: "data-safety." } }, orderBy: { createdAt: "asc" },
    }));
    try {
      const stage = await createSnapshotStagedBuildServer(f.bound)(f.principal, f.lookup);
      expect(stage.publishSequence).toBe(f.sequence);
      await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
        expect(await tx.$queryRawUnsafe(`SELECT owner.rolname, owner.rolsuper, owner.rolbypassrls,
          p.prosecdef, p.proconfig, has_function_privilege('ams_data_hub_web',p.oid,'EXECUTE') AS "webExecute",
          has_table_privilege('ams_data_hub_web','public."SnapshotBuildInput"','SELECT') AS "privateRead"
          FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
          WHERE p.oid='public.data_safety_consistency_report()'::regprocedure`)).toEqual([{
          rolname: "ams_data_hub_worker", rolsuper: false, rolbypassrls: false, prosecdef: true,
          proconfig: ["search_path=pg_catalog, public, pg_temp", "row_security=on"], webExecute: true, privateRead: false,
        }]);
      });
      await expect(recovery.reconcileAfterRestore(f.admin, zeroes)).rejects.toThrow("DATA_SAFETY_RECONCILE_REQUIRED");
      await recovery.freezeMutatingJobs(f.admin, { reason: "Synthetic recovery proof" });
      await expect(recovery.unfreezeMutatingJobs(f.admin, {})).rejects.toThrow("DATA_SAFETY_RECONCILE_REQUIRED");
      await expect(recovery.reconcileAfterRestore(f.admin, zeroes)).resolves.toMatchObject({ jobsFrozen: true });
      const current = await runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.projectCurrentSnapshotManifest.findUniqueOrThrow({
        where: { organizationId_projectId: f.scope },
      }));
      expect(current.publishSequence).toBe(f.sequence);
      // The current monotonic guard must reject same-sequence changes; do not
      // disable it to manufacture corruption. Delivery metadata permits this
      // mismatch, which the counts-only recovery cut must actually detect.
      await expect(runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.projectCurrentSnapshotManifest.update({
        where: { organizationId_projectId: f.scope }, data: { publishedAt: new Date(current.publishedAt.getTime() + 1) },
      }))).rejects.toThrow("Current snapshot sequence must increase");
      await runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.deliveryRun.update({
        where: { organizationId_projectId_publishSequence: { ...f.scope, publishSequence: f.sequence } },
        data: { publishedAt: new Date(current.publishedAt.getTime() + 1) },
      }));
      const before = await ownAudits();
      await expect(recovery.unfreezeMutatingJobs(f.admin, {})).rejects.toThrow("DATA_SAFETY_RECONCILE_FAILED");
      await expect(recovery.reconcileAfterRestore(f.admin, zeroes)).rejects.toThrow("DATA_SAFETY_RECONCILE_FAILED");
      expect(await ownAudits()).toEqual(before);
      await runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.deliveryRun.update({
        where: { organizationId_projectId_publishSequence: { ...f.scope, publishSequence: f.sequence } }, data: { publishedAt: current.publishedAt },
      }));
      await expect(recovery.unfreezeMutatingJobs(f.admin, {})).resolves.toMatchObject({ jobsFrozen: false });
      expect((await ownAudits()).map((row) => row.action)).toEqual(["data-safety.freeze", "data-safety.reconcile", "data-safety.unfreeze"]);
      await expect(runInAuthorizedDatabaseTransaction({ principalKind: "snapshot-consumer", actorId: "snapshot-consumer-read",
        organizationId: f.scope.organizationId, projectIds: [f.scope.projectId], correlationId: randomUUID() },
      (tx) => tx.$queryRawUnsafe("SELECT * FROM public.data_safety_consistency_report()")))
        .rejects.toThrow("DATA_SAFETY_RECONCILIATION_SCOPE_DENIED");
      // A web admin still has no raw SELECT privilege on the private capture.
      await expect(runInAuthorizedDatabaseTransaction({ principalKind: "platform-admin", actorId: f.admin.userId,
        organizationId: null, projectIds: "*", correlationId: randomUUID() }, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_web");
        return tx.$queryRawUnsafe('SELECT * FROM public."SnapshotBuildInput"');
      })).rejects.toThrow();
    } finally { f.cleanup(); }
  });
  it("blocks new ingestion and publication for SUSPENDED alone while preserving readable current artifacts", async () => {
    const f = await fixture();
    try {
      const pending = await captureSnapshotInput(f.principal, { ...f.scope, idempotencyKey: randomUUID(), schemaMinor: 0 });
      const source = await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
        const source = await tx.source.create({ data: { ...f.scope, sourceKey: "synthetic-suspended", name: "Synthetic suspended",
          enabled: true, adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
          datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" },
          credentialRef: { create: { endpointCredentialRefName: "SYNTHETIC_UNUSED_ENDPOINT" } } } });
        await tx.project.update({ where: { id: f.scope.projectId }, data: { serviceState: "SUSPENDED" } });
        expect((await tx.dataSafetyState.findUniqueOrThrow({ where: { id: "global" } })).jobsFrozen).toBe(false);
        return source;
      });
      const original = await readRun(f); const keys = [...f.objects.keys()];
      expect(await createSourceExecutionServer(f.storage).run({ ...f.scope, sourceId: source.id }))
        .toMatchObject({ state: "FAILED", code: "SOURCE_EXECUTION_PROJECT_BLOCKED" });
      await expect(captureSnapshotInput(f.principal, { ...f.scope, idempotencyKey: randomUUID(), schemaMinor: 0 }))
        .rejects.toThrow("SNAPSHOT_INPUT_PROJECT_BLOCKED");
      await expect(createSnapshotPublicationServer(f.bound)(f.principal,
        { idempotencyKeyHash: pending.idempotencyKeyHash, requestHash: pending.requestHash }))
        .rejects.toThrow("SNAPSHOT_PUBLICATION_PROJECT_BLOCKED");
      expect([...f.objects.keys()]).toEqual(keys);
      expect(await readRun(f)).toEqual(original);
      await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
        expect(await tx.sourceRevision.count({ where: { sourceId: source.id } })).toBe(0);
        expect(await tx.deliveryRun.count({ where: f.scope })).toBe(1);
        expect((await tx.projectCurrentSnapshotManifest.findFirstOrThrow({ where: f.scope })).publishSequence).toBe(f.sequence);
      });
      const current = await handleSnapshotConsumerGet(f.request(), f.params);
      expect(current.status).toBe(200); expect((await current.json()).manifest.publishSequence).toBe(f.sequence);
      const artifact = await handleSnapshotConsumerGet(f.request(), { ...f.params, publishSequence: String(f.sequence), kind: "geo" });
      expect(artifact.status).toBe(200); expect((await artifact.arrayBuffer()).byteLength).toBeGreaterThan(0);
    } finally { f.cleanup(); }
  });
  it("serves signed current and immutable bytes, and denies foreign/arbitrary access before IO", async () => {
    const f = await fixture();
    try {
      const current = await handleSnapshotConsumerGet(f.request(), f.params);
      expect(current.status).toBe(200); expect(current.headers.get("cache-control")).toBe("no-store");
      const data = await current.json(); expect(data.manifest).toMatchObject({ projectId: f.scope.projectId, publishSequence: f.sequence });
      expect(data.artifacts).toHaveLength(13);
      const serialized = JSON.stringify(data);
      for (const field of ["manifestKey", "inputHash", "rootBuildInputId", "currentTokenHash", "nextTokenHash", "leaseJobRunId"]) expect(serialized).not.toContain(field);
      for (const physicalKey of f.objects.keys()) expect(serialized).not.toContain(physicalKey);
      const before = f.gets();
      expect((await handleSnapshotConsumerGet(f.request("wrong-synthetic-token-that-is-long-enough"), f.params)).status).toBe(401);
      expect((await handleSnapshotConsumerGet(f.request(), { ...f.params, projectId: "synthetic-foreign" })).status).toBe(401);
      expect((await handleSnapshotConsumerGet(f.request(), { ...f.params, publishSequence: String(f.sequence), kind: "../backups" })).status).toBe(400);
      expect((await handleSnapshotConsumerGet(f.request(f.token, "current?token=forbidden"), f.params)).status).toBe(400);
      expect(f.gets()).toBe(before);
      const file = await handleSnapshotConsumerGet(f.request(f.token, `${f.sequence}/files/geo`), { ...f.params, publishSequence: String(f.sequence), kind: "geo" });
      expect(file.status).toBe(200); expect(file.headers.get("content-type")).toBe("application/gzip");
      const descriptor = data.manifest.files.find((value: { kind: string }) => value.kind === "geo");
      expect(Buffer.from(await file.arrayBuffer())).toEqual(Buffer.from(f.objects.get(`snapshots/${f.scope.projectId}/${descriptor.sha256}`)!));
      const key = `snapshots/${f.scope.projectId}/${descriptor.sha256}`;
      f.objects.set(key, Uint8Array.from(f.objects.get(key)!, (byte, index) => index === 0 ? byte ^ 1 : byte));
      expect((await handleSnapshotConsumerGet(f.request(), { ...f.params, publishSequence: String(f.sequence), kind: "geo" })).status).toBe(503);
    } finally { f.cleanup(); }
  });
  it("does not treat completed staging as committed publication", async () => {
    const f = await fixture(false);
    try {
      expect((await handleSnapshotConsumerGet(f.request(), f.params)).status).toBe(404);
      expect((await handleSnapshotConsumerGet(f.request(), { ...f.params, publishSequence: String(f.sequence), kind: "geo" })).status).toBe(404);
      expect(f.gets()).toBe(0);
    } finally { f.cleanup(); }
  });
  it("keeps SUSPENDED/frozen pull available, honors overlap and denies promotion-stale in-flight credentials", async () => {
    const f = await fixture(); const next = `synthetic-next-${randomUUID()}`;
    const change = async (phase: "STAGE" | "PROMOTE") => runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
      const repo = new PrismaSnapshotDeliveryRepository(tx); const credential = await repo.getAckCredential(f.scope.organizationId, f.scope.projectId);
      if (!credential) throw new Error("SYNTHETIC_CREDENTIAL_MISSING");
      const service = createSnapshotAckService({ repository: repo, now: () => new Date() });
      return phase === "STAGE" ? service.stageRotation(credential, next) : service.promoteRotation(credential);
    });
    try {
      await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
        await tx.project.update({ where: { id: f.scope.projectId }, data: { serviceState: "SUSPENDED" } });
        await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true, frozenAt: new Date() } });
      });
      expect((await handleSnapshotConsumerGet(f.request(), f.params)).status).toBe(200);
      await change("STAGE");
      expect((await handleSnapshotConsumerGet(f.request(), f.params)).status).toBe(200);
      expect((await handleSnapshotConsumerGet(f.request(next), f.params)).status).toBe(200);
      f.hook(async () => { await change("PROMOTE"); });
      expect((await handleSnapshotConsumerGet(f.request(), f.params)).status).toBe(401);
      expect((await handleSnapshotConsumerGet(f.request(), f.params)).status).toBe(401);
      expect((await handleSnapshotConsumerGet(f.request(next), f.params)).status).toBe(200);
    } finally { f.cleanup(); }
  });
  it("fails closed for corrupt manifest and revoked trust, without private error details", async () => {
    const f = await fixture();
    try {
      vi.stubEnv("PROJECT_SNAPSHOT_SIGNING_BINDINGS", JSON.stringify([{ ...f.scope, currentKeyId: "synthetic", nextKeyId: null,
        revokedKeyIds: ["synthetic"], publicKeyRefs: { synthetic: "SYNTHETIC_CONSUMER_PUBLIC" } }]));
      expect((await handleSnapshotConsumerGet(f.request(), f.params)).status).toBe(503); expect(f.gets()).toBe(0);
      vi.stubEnv("PROJECT_SNAPSHOT_SIGNING_BINDINGS", JSON.stringify([{ ...f.scope, currentKeyId: "synthetic", nextKeyId: null,
        revokedKeyIds: [], publicKeyRefs: { synthetic: "SYNTHETIC_CONSUMER_PUBLIC" } }]));
      f.corrupt(); const result = await handleSnapshotConsumerGet(f.request(), f.params);
      expect(result.status).toBe(503); expect(await result.json()).toEqual({ error: "SNAPSHOT_UNAVAILABLE" });
    } finally { f.cleanup(); }
  });
  it("denies direct private reads/writes and wildcard purpose, ignoring temp-table shadowing", async () => {
    const f = await fixture();
    const context = { principalKind: "snapshot-consumer" as const, actorId: "snapshot-consumer-read", organizationId: f.scope.organizationId,
      projectIds: [f.scope.projectId], correlationId: randomUUID() };
    try {
      const publicRead = await runInAuthorizedDatabaseTransaction(context, async (tx) => {
        expect(await tx.$queryRawUnsafe(`SELECT r.rolsuper,r.rolbypassrls,
          has_schema_privilege(r.rolname,'public','CREATE') AS schema_create FROM pg_roles r JOIN pg_proc f ON f.proowner=r.oid
          WHERE f.oid='public.snapshot_consumer_manifest(text,text,integer)'::regprocedure`))
          .toEqual([{ rolsuper: false, rolbypassrls: false, schema_create: false }]);
        await tx.$executeRawUnsafe('CREATE TEMP TABLE "DeliveryRun" (id text) ON COMMIT DROP');
        return tx.$queryRawUnsafe('SELECT * FROM public.snapshot_consumer_manifest($1,$2,NULL)', f.scope.organizationId, f.scope.projectId);
      });
      expect(publicRead).toHaveLength(1);
      for (const table of ["SnapshotBuildInput", "SnapshotBuildInputPart", "SnapshotPublicationBinding", "SnapshotArtifactStageReceipt", "SnapshotRollbackBinding", "SourceRevision"]) {
        // Tables with no web grant raise permission denial; existing granted private tables return no RLS rows.
        let rows: unknown[] = [];
        try { rows = await runInAuthorizedDatabaseTransaction(context, (tx) => tx.$queryRawUnsafe(`SELECT * FROM public."${table}" LIMIT 1`)); }
        catch (error) { expect(error).toMatchObject({ meta: { driverAdapterError: { cause: { code: "42501" } } } }); }
        expect(rows).toEqual([]);
      }
      await expect(runInAuthorizedDatabaseTransaction({ ...context, projectIds: "*" }, (tx) =>
        tx.$queryRawUnsafe('SELECT * FROM public.snapshot_consumer_manifest($1,$2,NULL)', f.scope.organizationId, f.scope.projectId)))
        .rejects.toThrow("SNAPSHOT_CONSUMER_SCOPE_DENIED");
      await expect(runInAuthorizedDatabaseTransaction(context, (tx) => tx.projectAckCredential.update({
        where: { organizationId_projectId: f.scope }, data: { version: { increment: 1 } } }))).rejects.toThrow();
      const cancelled = new AbortController(); cancelled.abort(); const count = f.gets();
      expect((await handleSnapshotConsumerGet(f.request(f.token, "current", cancelled.signal), f.params)).status).toBe(503);
      expect(f.gets()).toBe(count);
    } finally { f.cleanup(); }
  });
  it("rechecks revoked trust after the final credential database await", async () => {
    const f = await fixture();
    try {
      f.hook(async () => {
        cuts.afterAuth = () => vi.stubEnv("PROJECT_SNAPSHOT_SIGNING_BINDINGS", JSON.stringify([{ ...f.scope, currentKeyId: "synthetic", nextKeyId: null,
          revokedKeyIds: ["synthetic"], publicKeyRefs: { synthetic: "SYNTHETIC_CONSUMER_PUBLIC" } }]));
      });
      expect((await handleSnapshotConsumerGet(f.request(), f.params)).status).toBe(503);
      expect(f.gets()).toBe(1);
    } finally { f.cleanup(); }
  });
  it("recognizes actual automatic publication as rollback source but never stage alone", async () => {
    for (const publish of [true, false]) {
      const f = await fixture(publish);
      try {
        const read = () => runInAuthorizedDatabaseTransaction({ principalKind: "project-job", actorId: "snapshot-publication",
          organizationId: f.scope.organizationId, projectIds: [f.scope.projectId], correlationId: randomUUID() },
          (tx) => new PrismaSnapshotRollbackRepository(tx).approvedSource(f.scope, f.sequence));
        if (publish) expect(await read()).toMatchObject({ sourceDeliveryRunId: (await readRun(f))?.deliveryRunId });
        else await expect(read()).rejects.toThrow("SNAPSHOT_ROLLBACK_SOURCE_NOT_APPROVED");
      } finally { f.cleanup(); }
    }
  });
});

async function ackInput(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await handleSnapshotConsumerGet(f.request(), f.params);
  expect(response.status).toBe(200);
  const { manifest } = await response.json();
  return { projectId: f.scope.projectId, publishSequence: f.sequence, applied: true,
    manifestSha256: calculateObjectSha256(canonicalJsonBytes(manifest as CanonicalJsonValue)), idempotencyKey: randomUUID() };
}
function ackRequest(f: Awaited<ReturnType<typeof fixture>>, body: unknown, token = f.token, signal?: AbortSignal) {
  return new Request(`http://127.0.0.1/api/snapshots/${f.scope.organizationId}/${f.scope.projectId}/ack`,
    { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal });
}
async function readRun(f: Awaited<ReturnType<typeof fixture>>) {
  return runInPrincipalDatabaseTransaction(f.admin, (tx) => new PrismaSnapshotDeliveryRepository(tx)
    .getRun(f.scope.organizationId, f.scope.projectId, f.sequence));
}

async function notificationFixture() {
  const f = await fixture();
  const event = await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
    const own = await tx.outboxEvent.findFirstOrThrow({ where: { organizationId: f.scope.organizationId, topic: SNAPSHOT_NOTIFICATION_TOPIC } });
    // Only this fixture's event is available to the synthetic claim clock.
    // Independent fixtures and suites keep their queue state unchanged.
    await tx.outboxEvent.update({ where: { id: own.id }, data: { availableAt: new Date("2000-01-01T00:00:00Z") } });
    return own;
  });
  vi.stubEnv("PROJECT_SNAPSHOT_WEBHOOK_BINDINGS", JSON.stringify([{ ...f.scope, endpointRef: "SYNTHETIC_NOTIFICATION_ENDPOINT" }]));
  vi.stubEnv("SYNTHETIC_NOTIFICATION_ENDPOINT", "https://consumer.example.test/hint");
  let now = new Date("2000-01-01T00:00:01Z");
  const reliability = new ReliabilityService(new PrismaReliabilityRepository(), () => now);
  const lease = await reliability.claim(`notification-${randomUUID()}`, 300_000, [SNAPSHOT_NOTIFICATION_TOPIC]);
  expect(lease?.outboxEventId).toBe(event.id);
  if (!lease) throw new Error("SYNTHETIC_NOTIFICATION_LEASE_MISSING");
  const bodies: unknown[] = [];
  let status = 204; let afterSend: (() => Promise<void>) | null = null;
  const handler = createSnapshotNotificationHandler({ resolveEndpoint: createProjectSnapshotWebhookResolver(),
    send: (url, notification, options) => executeSafeOutboundWebhook(url, notification, {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (input) => {
        expect(cuts.active).toBe(0);
        bodies.push(JSON.parse(new TextDecoder().decode(input.jsonBody)));
        if (afterSend) { const hook = afterSend; afterSend = null; await hook(); }
        return { status, headers: {}, body: (async function* () {})(), abort() {} };
      },
    }, options) });
  return { f, event, reliability, lease, bodies, handler, setStatus: (value: number) => { status = value; },
    advance: () => { now = new Date(now.getTime() + 3_600_000); },
    hook: (value: () => Promise<void>) => { afterSend = value; } };
}

describe("actual durable snapshot notifier without publication rollback", () => {
  it("commits one intent, sends only project/sequence outside TX and replays without another intent", async () => {
    const n = await notificationFixture(); const { f } = n;
    try {
      const before = [...f.objects.keys()];
      await n.handler(n.lease);
      expect(n.bodies).toEqual([{ projectId: f.scope.projectId, publishSequence: f.sequence }]);
      expect(await readRun(f)).toMatchObject({ status: "NOTIFIED", notifiedAt: expect.any(Date) });
      await n.reliability.complete(n.lease);
      await createSnapshotPublicationServer(f.bound)(f.principal, f.lookup);
      expect([...f.objects.keys()]).toEqual(before);
      await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
        expect(await tx.outboxEvent.count({ where: { organizationId: f.scope.organizationId, topic: SNAPSHOT_NOTIFICATION_TOPIC } })).toBe(1);
        expect((await tx.outboxEvent.findUniqueOrThrow({ where: { id: n.event.id } })).status).toBe("PROCESSED");
        expect((await tx.projectCurrentSnapshotManifest.findFirstOrThrow({ where: f.scope })).publishSequence).toBe(f.sequence);
      });
      expect((await handleSnapshotConsumerGet(f.request(), f.params)).status).toBe(200);
    } finally { f.cleanup(); }
  });
  it("exhausts the real bounded notification retry budget without failing or undoing publication", async () => {
    const n = await notificationFixture(); const { f } = n;
    try {
      const original = await readRun(f); n.setStatus(503); let lease = n.lease;
      for (let attempt = 1; attempt <= 5; attempt++) {
        await expect(n.handler(lease)).rejects.toMatchObject({ code: "SNAPSHOT_NOTIFICATION_UNAVAILABLE", retryable: true });
        const result = await n.reliability.fail(lease, "SNAPSHOT_NOTIFICATION_UNAVAILABLE", true);
        expect(result.status).toBe(attempt < 5 ? "pending" : "dead_letter");
        if (attempt < 5) {
          n.advance(); // Actual retry backoff, not an availability override.
          const claimed = await n.reliability.claim(`notification-retry-${attempt}-${randomUUID()}`, 300_000, [SNAPSHOT_NOTIFICATION_TOPIC]);
          expect(claimed?.outboxEventId).toBe(n.event.id); if (!claimed) throw new Error("SYNTHETIC_RETRY_MISSING"); lease = claimed;
        }
      }
      expect(n.bodies).toHaveLength(5);
      expect(await readRun(f)).toEqual(original);
      await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
        expect(await tx.outboxEvent.findUniqueOrThrow({ where: { id: n.event.id } })).toMatchObject({ status: "DEAD_LETTER", attempts: 5 });
        expect((await tx.projectCurrentSnapshotManifest.findFirstOrThrow({ where: f.scope })).publishSequence).toBe(f.sequence);
      });
      expect((await handleSnapshotConsumerGet(f.request(), f.params)).status).toBe(200);
    } finally { f.cleanup(); }
  });
  it("allows at-least-once POST replay after lease loss but fences the obsolete write and settlement", async () => {
    const n = await notificationFixture(); const { f } = n; let replacement: ClaimedReliabilityEvent | null = null;
    try {
      n.hook(async () => { replacement = await n.reliability.takeOver(n.lease, `notification-replacement-${randomUUID()}`); });
      await expect(n.handler(n.lease)).rejects.toMatchObject({ code: "SNAPSHOT_NOTIFICATION_UNAVAILABLE" });
      expect((await readRun(f))?.status).toBe("PENDING");
      await expect(n.reliability.complete(n.lease)).rejects.toMatchObject({ code: "OUTBOX_LEASE_LOST" });
      if (!replacement) throw new Error("SYNTHETIC_REPLACEMENT_MISSING");
      await n.handler(replacement);
      await n.reliability.complete(replacement);
      expect(n.bodies).toEqual([{ projectId: f.scope.projectId, publishSequence: f.sequence }, { projectId: f.scope.projectId, publishSequence: f.sequence }]);
      expect((await readRun(f))?.status).toBe("NOTIFIED");
    } finally { f.cleanup(); }
  });
  it("never downgrades an actual consumer ACK committed while POST is in flight", async () => {
    const n = await notificationFixture(); const { f } = n;
    try {
      const input = await ackInput(f);
      n.hook(async () => { expect((await handleSnapshotConsumerAck(ackRequest(f, input), f.params)).status).toBe(200); });
      await n.handler(n.lease); await n.reliability.complete(n.lease);
      const original = await readRun(f); expect(original?.status).toBe("ACKNOWLEDGED"); expect(original?.notifiedAt).toBeNull();
      expect(n.bodies).toHaveLength(1);
      expect((await handleSnapshotConsumerGet(f.request(), f.params)).status).toBe(200);
    } finally { f.cleanup(); }
  });
  it("defers unconfigured projects and rejects forged extra fields before any POST", async () => {
    const n = await notificationFixture(); const { f } = n;
    try {
      await expect(n.handler({ ...n.lease, payload: { ...n.lease.payload, datasets: [] } })).rejects.toMatchObject({ code: "SNAPSHOT_NOTIFICATION_INVALID", retryable: false });
      vi.stubEnv("PROJECT_SNAPSHOT_WEBHOOK_BINDINGS", "[]");
      expect(await n.handler(n.lease)).toEqual({ deferred: true, code: "OUTBOX_EXECUTOR_RESERVED" });
      await n.reliability.defer(n.lease, "OUTBOX_EXECUTOR_RESERVED");
      expect(n.bodies).toEqual([]); expect((await readRun(f))?.status).toBe("PENDING");
      expect((await handleSnapshotConsumerGet(f.request(), f.params)).status).toBe(200);
    } finally { f.cleanup(); }
  });
  it("denies notifier identity/private/status writes except scoped PENDING to NOTIFIED", async () => {
    const n = await notificationFixture(); const { f } = n;
    try {
      const original = await readRun(f); if (!original) throw new Error("SYNTHETIC_RUN_MISSING");
      const context = { principalKind: "project-job" as const, actorId: "snapshot-notifier", organizationId: f.scope.organizationId,
        projectIds: [f.scope.projectId], correlationId: randomUUID() };
      for (const data of [{ manifestSha256: "a".repeat(64) }, { status: "FAILED" as const, failedAt: new Date() }]) {
        await expect(runInAuthorizedDatabaseTransaction(context, async (tx) => {
          await tx.$executeRawUnsafe("SELECT set_config('app.snapshot_notification_sequence',$1,true)", String(f.sequence));
          return tx.deliveryRun.update({ where: { id: original.deliveryRunId }, data });
        })).rejects.toThrow("SNAPSHOT_NOTIFICATION_WRITE_DENIED");
      }
      expect(await readRun(f)).toEqual(original); expect(n.bodies).toEqual([]);
    } finally { f.cleanup(); }
  });
});

describe("actual bounded HTTP ACK through createSnapshotAckService", () => {
  it("allows only scoped attestation status columns, never run identity/creation or direct premature ACK", async () => {
    const f = await fixture();
    const context = { principalKind: "snapshot-consumer" as const, actorId: "snapshot-consumer-ack",
      organizationId: f.scope.organizationId, projectIds: [f.scope.projectId], correlationId: randomUUID() };
    try {
      const run = await readRun(f); if (!run) throw new Error("SYNTHETIC_RUN_MISSING");
      for (const data of [{ manifestSha256: "a".repeat(64) }, { status: "ACKNOWLEDGED" as const, acknowledgedAt: new Date(), ackIdempotencyKeyHash: "a".repeat(64) }]) {
        await expect(runInAuthorizedDatabaseTransaction(context, async (tx) => {
          await tx.$executeRawUnsafe("SELECT set_config('app.snapshot_consumer_ack_sequence',$1,true)", String(f.sequence));
          return tx.deliveryRun.update({ where: { id: run.deliveryRunId }, data });
        })).rejects.toThrow("SNAPSHOT_CONSUMER_ACK_");
      }
      expect(await readRun(f)).toEqual(run);
    } finally { f.cleanup(); }
  });
  it("atomically accepts applied attestation and provides stable exact-key replay", async () => {
    const f = await fixture();
    try {
      const input = await ackInput(f);
      expect((await readRun(f))?.status).toBe("PENDING");
      const response = await handleSnapshotConsumerAck(ackRequest(f, input), f.params);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ projectId: f.scope.projectId, publishSequence: f.sequence, status: "ACKNOWLEDGED", idempotent: false });
      const run = await readRun(f);
      expect(run).toMatchObject({ status: "ACKNOWLEDGED" });
      expect(run?.downloadedAt).toBeInstanceOf(Date); expect(run?.appliedAt).toBeInstanceOf(Date); expect(run?.acknowledgedAt).toBeInstanceOf(Date);
      const replay = await handleSnapshotConsumerAck(ackRequest(f, input), f.params);
      expect(replay.status).toBe(200); expect((await replay.json()).idempotent).toBe(true);
      expect(await readRun(f)).toEqual(run);
      expect((await handleSnapshotConsumerAck(ackRequest(f, { ...input, idempotencyKey: randomUUID() }), f.params)).status).toBe(409);
      expect(await readRun(f)).toEqual(run);
      const readRetention = () => runInAuthorizedDatabaseTransaction({ principalKind: "project-job", actorId: "raw-artifact-retention",
        organizationId: f.scope.organizationId, projectIds: [f.scope.projectId], correlationId: randomUUID() }, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]);
        return createRawArtifactRetentionCutReader(tx).read(f.scope);
      });
      expect((await readRetention()).coverage).toBe("COMPLETE");
      // ACKNOWLEDGED is no longer a pending-delivery pin. The current-root
      // branch must still reject contradictory immutable run/current identity.
      const originalPublishedAt = run!.publishedAt;
      try {
        await runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.deliveryRun.update({ where: { id: run!.deliveryRunId },
          data: { publishedAt: new Date(originalPublishedAt.getTime() + 1) } }));
        expect((await readRetention()).coverage).toBe("INCOMPLETE");
      } finally {
        await runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.deliveryRun.update({ where: { id: run!.deliveryRunId },
          data: { publishedAt: originalPublishedAt } }));
      }
      expect((await readRetention()).coverage).toBe("COMPLETE");
    } finally { f.cleanup(); }
  });
  it("rejects malformed/foreign/token-in-body/oversized requests before artifact IO or mutation", async () => {
    const f = await fixture();
    try {
      const input = await ackInput(f); const before = f.gets();
      for (const changed of [{ ...input, applied: false }, { ...input, token: f.token }, { ...input, publishSequence: 0 }, { ...input, idempotencyKey: "short" }])
        expect((await handleSnapshotConsumerAck(ackRequest(f, changed), f.params)).status).toBe(400);
      expect((await handleSnapshotConsumerAck(ackRequest(f, { ...input, projectId: "foreign" }), f.params)).status).toBe(401);
      expect((await handleSnapshotConsumerAck(ackRequest(f, { padding: "x".repeat(5000) }), f.params)).status).toBe(413);
      expect((await handleSnapshotConsumerAck(ackRequest(f, input, "synthetic-wrong-token-which-is-long-enough"), f.params)).status).toBe(401);
      expect(f.gets()).toBe(before); expect((await readRun(f))?.status).toBe("PENDING");
      expect((await handleSnapshotConsumerAck(ackRequest(f, { ...input, manifestSha256: "a".repeat(64) }), f.params)).status).toBe(409);
      expect((await readRun(f))?.status).toBe("PENDING");
    } finally { f.cleanup(); }
  });
  it.each(["FAILED", "STALE"] as const)("does not revive terminal delivery %s", async (status) => {
    const f = await fixture();
    try {
      const input = await ackInput(f);
      await runInPrincipalDatabaseTransaction(f.admin, (tx) => new PrismaSnapshotDeliveryRepository(tx).transitionRun({ ...f.scope,
        publishSequence: f.sequence, expectedStatuses: ["PENDING"], nextStatus: status, occurredAt: new Date() }));
      const original = await readRun(f);
      expect((await handleSnapshotConsumerAck(ackRequest(f, input), f.params)).status).toBe(409);
      expect(await readRun(f)).toEqual(original);
    } finally { f.cleanup(); }
  });
  it("rolls back all applied/acknowledged writes on late cancellation", async () => {
    const f = await fixture(); const controller = new AbortController();
    const actual = PrismaSnapshotDeliveryRepository.prototype.acknowledgeApplied;
    const method = vi.spyOn(PrismaSnapshotDeliveryRepository.prototype, "acknowledgeApplied").mockImplementationOnce(async function (this: PrismaSnapshotDeliveryRepository, input) {
      const result = await actual.call(this, input); controller.abort(); return result;
    });
    try {
      const input = await ackInput(f);
      expect((await handleSnapshotConsumerAck(ackRequest(f, input, f.token, controller.signal), f.params)).status).toBe(503);
      expect(await readRun(f)).toMatchObject({ status: "PENDING", downloadedAt: null, appliedAt: null, acknowledgedAt: null, ackIdempotencyKeyHash: null });
    } finally { method.mockRestore(); f.cleanup(); }
  });
  it("rolls back all ACK writes when trust is revoked after the actual acknowledge write", async () => {
    const f = await fixture();
    const actual = PrismaSnapshotDeliveryRepository.prototype.acknowledgeApplied;
    const method = vi.spyOn(PrismaSnapshotDeliveryRepository.prototype, "acknowledgeApplied").mockImplementationOnce(async function (this: PrismaSnapshotDeliveryRepository, input) {
      const result = await actual.call(this, input);
      vi.stubEnv("PROJECT_SNAPSHOT_SIGNING_BINDINGS", JSON.stringify([{ ...f.scope, currentKeyId: "synthetic", nextKeyId: null,
        revokedKeyIds: ["synthetic"], publicKeyRefs: { synthetic: "SYNTHETIC_CONSUMER_PUBLIC" } }]));
      return result;
    });
    try {
      const input = await ackInput(f); const original = await readRun(f);
      expect((await handleSnapshotConsumerAck(ackRequest(f, input), f.params)).status).toBe(409);
      expect(await readRun(f)).toEqual(original);
    } finally { method.mockRestore(); f.cleanup(); }
  });
  it("checks promotion-fresh token in the final locked cut and allows SUSPENDED/frozen ACK with next", async () => {
    const f = await fixture(); const next = `synthetic-next-${randomUUID()}`;
    try {
      const input = await ackInput(f);
      const rotate = (phase: "STAGE" | "PROMOTE") => runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
        const repository = new PrismaSnapshotDeliveryRepository(tx); const credential = await repository.getAckCredential(f.scope.organizationId, f.scope.projectId);
        if (!credential) throw new Error("SYNTHETIC_MISSING_CREDENTIAL");
        const service = createSnapshotAckService({ repository, now: () => new Date() });
        return phase === "STAGE" ? service.stageRotation(credential, next) : service.promoteRotation(credential);
      });
      await rotate("STAGE");
      cuts.beforeAck = async () => { await rotate("PROMOTE"); };
      expect((await handleSnapshotConsumerAck(ackRequest(f, input), f.params)).status).toBe(401);
      expect((await readRun(f))?.status).toBe("PENDING");
      await runInPrincipalDatabaseTransaction(f.admin, async (tx) => {
        await tx.project.update({ where: { id: f.scope.projectId }, data: { serviceState: "SUSPENDED" } });
        await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true, frozenAt: new Date() } });
      });
      expect((await handleSnapshotConsumerAck(ackRequest(f, input, next), f.params)).status).toBe(200);
      expect((await readRun(f))?.status).toBe("ACKNOWLEDGED");
    } finally { f.cleanup(); }
  });
});
