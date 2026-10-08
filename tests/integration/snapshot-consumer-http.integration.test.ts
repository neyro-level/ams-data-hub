import { generateKeyPairSync, randomUUID } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";

const cuts = vi.hoisted(() => ({ active: 0, afterAuth: null as (() => void) | null, beforeAck: null as (() => Promise<void>) | null }));
vi.mock("../../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = async (context, execute, options) => {
    const result = await actual.runInAuthorizedDatabaseTransaction(context, async (tx) => {
      const consumer = context.principalKind === "snapshot-consumer";
      if (consumer || ["snapshot-input", "snapshot-publication"].includes(context.actorId)) {
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
  return { ...actual, runInAuthorizedDatabaseTransaction: authorized };
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
import type { SnapshotTrustSet } from "../../src/modules/snapshot-delivery/contracts.ts";

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
    return { admin, scope, params, request, token, sequence: receipt.publishSequence, objects, bound, principal, storage,
      gets: () => gets, corrupt: () => { corrupt = true; }, hook: (value: () => Promise<void>) => { hook = value; },
      cleanup: () => { cuts.afterAuth = null; cuts.beforeAck = null; send.mockRestore(); client.destroy(); vi.unstubAllEnvs(); } };
  } catch (error) { send.mockRestore(); client.destroy(); vi.unstubAllEnvs(); throw error; }
}

describe("actual project-authenticated snapshot consumer HTTP and FORCE RLS", () => {
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
