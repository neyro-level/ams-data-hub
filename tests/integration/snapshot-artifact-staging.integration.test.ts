import { generateKeyPairSync, randomUUID } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { canonicalJson, createUlid, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";

const cuts = vi.hoisted(() => ({ active: 0, roles: 0,
  afterInitialReplay: null as (() => Promise<void>) | null,
  afterInitialStageReplay: null as (() => Promise<void>) | null }));
vi.mock("../../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = async (context, execute, options) => {
    const result = await actual.runInAuthorizedDatabaseTransaction(context, async (tx) => {
      const snapshot = ["snapshot-input", "snapshot-publication", "operations-executor", "outbox-claim", "outbox-takeover", "outbox-complete"].includes(context.actorId);
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
    if (context.actorId === "snapshot-input" && context.correlationId === "synthetic-stage-replay-race"
      && cuts.afterInitialStageReplay) {
      const after = cuts.afterInitialStageReplay; cuts.afterInitialStageReplay = null;
      await after(); // Inspection completed; a competing BUILD can now commit.
    }
    return result;
  };
  const system: typeof actual.runInSystemJobDatabaseTransaction = (input, execute) =>
    authorized(actual.createSystemJobDatabaseAuthorizationContext(input), execute);
  return { ...actual, runInAuthorizedDatabaseTransaction: authorized, runInSystemJobDatabaseTransaction: system };
});
import { captureSnapshotInput, createSnapshotArtifactStagingServer, createSnapshotPublicationServer, createSnapshotSignedBuildServer,
  createSnapshotStagedBuildServer, inspectStagedSnapshotServer, createSelectedSnapshotPublicationServer, inspectSelectedSnapshotRunServer,
  PrismaSnapshotPublicationRepository, PrismaSnapshotDeliveryRepository, createEd25519SecretRefSigner } from "../../src/modules/snapshot-delivery/server.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import { calculateObjectSha256, createMediaKey, createProjectSnapshotKey } from "../../src/platform/storage/object-storage.ts";
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
import { createOperationalSnapshotBuildExecutor, createOperationalSnapshotPublishExecutor, requestOperationalAction } from "../../src/modules/operations-control/server.ts";
import { OPERATIONAL_ACTION_TOPICS } from "../../src/modules/operations-control/index.ts";
import { OperationalActionLifecycleRepository } from "../../src/modules/operations-control/infrastructure/operational-action-lifecycle.ts";
import { operationalSnapshotBuildRequest } from "../../src/modules/operations-control/application/operational-snapshot-build.ts";
import { snapshotInputRequestHashes } from "../../src/modules/snapshot-delivery/index.ts";
import { settleTerminalOperationalRequests } from "../../src/modules/operations-control/worker.ts";
import { readStagedSnapshotArtifacts, readStagedSnapshotComposition } from "../../src/modules/snapshot-delivery/infrastructure/snapshot-staged-artifact-reader.ts";
import { inspectSelectedSnapshotStageServer, loadSelectedSnapshotCaptureServer } from "../../src/modules/snapshot-delivery/infrastructure/snapshot-selected-stage.ts";
import { PrismaSnapshotInputRepository } from "../../src/modules/snapshot-delivery/infrastructure/prisma-snapshot-input-repository.ts";
import { prepareSelectedSnapshotAdmission } from "../../src/modules/snapshot-delivery/application/snapshot-selected-admission.ts";
import { admitHistoricalSnapshotRollback } from "../../src/modules/snapshot-delivery/infrastructure/snapshot-rollback-admission.ts";
import { lockSnapshotPublication } from "../../src/modules/snapshot-delivery/infrastructure/snapshot-publication-lock.ts";
import { createSnapshotPublicationProjectReader } from "../../src/modules/project-state/server.ts";
import { PrismaSnapshotRollbackRepository, type SnapshotRollbackLease } from "../../src/modules/snapshot-delivery/infrastructure/prisma-snapshot-rollback-repository.ts";
import { composeRollbackSnapshot } from "../../src/modules/snapshot-delivery/application/snapshot-rollback.ts";
import { signSnapshotManifest, verifySnapshotSignatureCandidate } from "../../src/modules/snapshot-delivery/application/snapshot-signing.ts";
import { snapshotManifestV1Schema } from "../../src/modules/snapshot-delivery/contracts.ts";

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
  it.each(["takeover", "identity", "collision", "concurrent", "content", "canonical", "late-failure", "scope", "overflow", "prior-rollback"])("durable request-bound rollback identity: %s", async (mode) => {
    const setup = await fixture(); const { scope } = setup;
    const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-rollback-identity", correlationId: randomUUID() };
    const keys = generateKeyPairSync("ed25519");
    vi.stubEnv("SYNTHETIC_ROLLBACK_KEY", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const trustSet = { currentKeyId: "synthetic-rollback-key", nextKeyId: null, revokedKeyIds: [] as string[],
      publicKeys: { "synthetic-rollback-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } };
    const objects = new Map<string, Uint8Array>(); let puts = 0;
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      expect(cuts.active).toBe(0);
      if (command instanceof PutObjectCommand) { puts++; objects.set(command.input.Key!, Uint8Array.from(command.input.Body as Uint8Array)); return {} as never; }
      if (command instanceof GetObjectCommand) { const body = objects.get(command.input.Key!); if (!body) throw new Error("SYNTHETIC_OBJECT_MISSING");
        return { ContentLength: body.length, ContentType: "application/octet-stream", LastModified: new Date(0),
          Body: { destroy() {}, async *[Symbol.asyncIterator]() { yield body; } } } as never; }
      throw new Error("SYNTHETIC_UNEXPECTED_IO");
    });
    const storage = new S3ObjectStorage({ bucket: "synthetic-rollback", client });
    let now = new Date("1996-01-01T00:00:01Z");
    const reliability = new ReliabilityService(new PrismaReliabilityRepository(), () => now);
    let activeLease: Awaited<ReturnType<typeof reliability.claim>> = null;
    const ownedLeases = new Map<string, NonNullable<Awaited<ReturnType<typeof reliability.claim>>>>();
    const accept = async (sequence: number) => {
      const accepted = await requestOperationalAction(admin, { ...scope, action: "SNAPSHOT_ROLLBACK", sourcePublishSequence: sequence,
        sourceId: "", sourceRevisionId: "", reason: "", idempotencyKey: randomUUID() });
      await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        const request = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } });
        await tx.outboxEvent.update({ where: { id: request.outboxEventId! }, data: { availableAt: new Date("1996-01-01T00:00:00Z") } });
      });
      const claimed = await reliability.claim(`synthetic-rollback-${randomUUID()}`, 300_000, [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_ROLLBACK]);
      if (!claimed || (claimed.payload as { requestId: string }).requestId !== accepted.requestId) throw new Error("SYNTHETIC_ROLLBACK_CLAIM_INVALID");
      activeLease = claimed;
      ownedLeases.set(claimed.outboxEventId, claimed);
      await observer(scope, async (tx) => {
        await lockSnapshotPublication(tx, scope); await new PrismaSnapshotInputRepository(tx).lockProject(scope.organizationId, scope.projectId);
        await new OperationalActionLifecycleRepository(tx).begin(claimed);
      }, "operations-executor");
      const lease: SnapshotRollbackLease = { ...scope, requestId: accepted.requestId, sourcePublishSequence: sequence,
        jobRunId: claimed.jobRunId, attempt: claimed.attempt, workerId: claimed.workerId, leaseAcquiredAt: claimed.leaseAcquiredAt };
      return lease;
    };
    const cut = <T>(execute: (repo: PrismaSnapshotRollbackRepository, tx: DatabaseTransaction) => Promise<T>) =>
      observer(scope, (tx) => execute(new PrismaSnapshotRollbackRepository(tx), tx));
    try {
      const stage = await createSnapshotStagedBuildServer({ ...scope, storage, trustSet, keyId: "synthetic-rollback-key",
        privateKeyRef: defineSecretRef("SYNTHETIC_ROLLBACK_KEY") })(setup.principal, setup.lookup);
      const sourceManifest = await observer(scope, async (tx) => snapshotManifestV1Schema.parse(JSON.parse((await tx.snapshotPublicationBinding.findUniqueOrThrow({
        where: { organizationId_projectId_buildInputId: { ...scope, buildInputId: stage.buildInputId } } })).manifestCanonical)));
      const lease = await accept(stage.publishSequence);
      // Completed signed staging alone is NOT approval to roll back.
      await expect(cut((repo) => repo.reserve(lease))).rejects.toThrow("SNAPSHOT_ROLLBACK_SOURCE_NOT_APPROVED");
      const publishSource = await createSelectedSnapshotPublicationServer({ ...scope, storage, getTrust: () => trustSet })(setup.principal, { buildInputId: stage.buildInputId });
      const sourceRun = await observer(scope, publishSource);
      expect(puts).toBe(14);
      if (mode === "scope") {
        for (const projects of ["*", [], [scope.projectId, setup.foreignId], [setup.foreignId]] as const) {
          await expect(observer(scope, (tx) => new PrismaSnapshotRollbackRepository(tx).reserve(lease), "snapshot-publication", projects))
            .rejects.toThrow("SNAPSHOT_ROLLBACK_ACCESS_DENIED");
        }
      }
      if (mode === "overflow") {
        await observer(scope, (tx) => tx.projectSnapshotSequence.update({ where: { organizationId_projectId: scope }, data: { lastReservedSequence: 2_147_483_647 } }), "snapshot-input");
        await expect(cut((repo) => repo.reserve(lease))).rejects.toThrow("SNAPSHOT_SEQUENCE_EXHAUSTED");
        expect(await cut((_repo, tx) => tx.snapshotRollbackReservation.count({ where: scope }))).toBe(0); return;
      }
      if (mode === "late-failure") {
        await expect(cut(async (repo) => { await repo.reserve(lease); throw new Error("SYNTHETIC_AFTER_RESERVE"); })).rejects.toThrow("SYNTHETIC_AFTER_RESERVE");
        expect(await cut((_repo, tx) => tx.snapshotRollbackReservation.count({ where: scope }))).toBe(0);
      }
      let concurrentCaptureSequence: number | null = null;
      const concurrent = { capture: null as ReturnType<typeof captureSnapshotInput> | null };
      const reservation = mode === "concurrent" ? await cut(async (repo, tx) => {
        const reserved = await repo.reserve(lease);
        concurrent.capture = captureSnapshotInput(setup.principal, { ...scope, idempotencyKey: "synthetic-concurrent-rollback-capture", schemaMinor: 0 });
        const deadline = Date.now() + 1500; let waiting = false;
        while (Date.now() < deadline) {
          const blocked = await tx.$queryRaw<{ pid: number }[]>(Prisma.sql`
            SELECT w.pid FROM pg_locks w JOIN pg_locks owner ON w.locktype=owner.locktype AND w.database=owner.database
              AND w.classid=owner.classid AND w.objid=owner.objid AND w.objsubid=owner.objsubid
            WHERE owner.pid=pg_backend_pid() AND owner.locktype='advisory' AND owner.granted AND NOT w.granted`);
          if (blocked.length) { waiting = true; break; } await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBe(true); return reserved;
      }) : await cut((repo) => repo.reserve(lease));
      if (concurrent.capture) concurrentCaptureSequence = (await concurrent.capture).publishSequence;
      expect(reservation).toMatchObject({ sourceDeliveryRunId: sourceRun.deliveryRunId, sourcePublishSequence: sourceRun.publishSequence,
        rootBuildInputId: setup.receipt.id, inputHash: setup.receipt.inputHash });
      if (mode === "concurrent") expect([reservation.publishSequence, concurrentCaptureSequence].sort()).toEqual([sourceRun.publishSequence + 1, sourceRun.publishSequence + 2]);
      else expect(reservation.publishSequence).toBe(sourceRun.publishSequence + 1);
      expect(await cut((repo) => repo.reserve(lease))).toEqual(reservation);
      if (mode === "identity") {
        const { createdAt: _created, reservationTransactionId: _txid, ...data } = reservation; void _created; void _txid;
        for (const change of [{ sourceDeliveryRunId: "synthetic-wrong-run" }, { rootBuildInputId: "synthetic-wrong-root" },
          { inputHash: "f".repeat(64) }, { publishSequence: sourceRun.publishSequence }]) {
          await expect(cut((_repo, tx) => tx.snapshotRollbackReservation.create({ data: { ...data, ...change } })))
            .rejects.toThrow("SNAPSHOT_ROLLBACK_RESERVATION_INVALID");
        }
        for (const change of [{ initialLeaseJobRunId: "synthetic-wrong-job" }, { initialLeaseAttempt: data.initialLeaseAttempt + 1 },
          { initialLeaseWorkerId: "synthetic-wrong-worker" }, { initialLeaseAcquiredAt: new Date("1996-01-01T00:00:02Z") }]) {
          await expect(cut((_repo, tx) => tx.snapshotRollbackReservation.create({ data: { ...data, ...change } })))
            .rejects.toThrow("OUTBOX_OPERATION_LEASE_LOST");
        }
      }
      if (mode === "takeover") {
        const stale = { ...lease }; now = new Date("1996-01-01T00:06:00Z");
        const replacement = await reliability.claim(`synthetic-takeover-${randomUUID()}`, 300_000, [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_ROLLBACK]);
        if (!replacement || (replacement.payload as { requestId: string }).requestId !== lease.requestId) throw new Error("SYNTHETIC_TAKEOVER_INVALID");
        activeLease = replacement;
        ownedLeases.set(replacement.outboxEventId, replacement);
        await observer(scope, async (tx) => {
          await lockSnapshotPublication(tx, scope); await new PrismaSnapshotInputRepository(tx).lockProject(scope.organizationId, scope.projectId);
          await new OperationalActionLifecycleRepository(tx).begin(replacement);
        }, "operations-executor");
        Object.assign(lease, { jobRunId: replacement.jobRunId, attempt: replacement.attempt, workerId: replacement.workerId, leaseAcquiredAt: replacement.leaseAcquiredAt });
        await expect(cut((repo) => repo.reserve(stale))).rejects.toThrow("OUTBOX_OPERATION_LEASE_LOST");
        expect(await cut((repo) => repo.reserve(lease))).toEqual(reservation);
        expect(reservation.initialLeaseAttempt).toBe(1); expect(lease.attempt).toBe(2);
      }
      if (mode === "collision") {
        // Forge a normal capture at the last reserved rollback counter without
        // advancing it: the new inverse SQL guard rejects the collision.
        await expect(observer(scope, (tx) => tx.snapshotBuildInput.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
          idempotencyKeyHash: "d".repeat(64), requestHash: "e".repeat(64), inputSchemaVersion: 1, projectorVersion: "db-v1", schemaMinor: 0,
          publishSequence: reservation.publishSequence, projectStateRevision: setup.receipt.projectStateRevision, catalogRevision: setup.receipt.catalogRevision,
          inputHash: "f".repeat(64), capturedAt: new Date() } }), "snapshot-input")).rejects.toThrow("SNAPSHOT_ROLLBACK_SEQUENCE_COLLISION");
        const newer = await captureSnapshotInput(setup.principal, { ...scope, idempotencyKey: "synthetic-after-rollback-reserve", schemaMinor: 0 });
        expect(newer.publishSequence).toBe(reservation.publishSequence + 1);
        expect(await cut((repo) => repo.reserve(lease))).toEqual(reservation); // Never reallocate.
      }
      const { verified, composition: source } = await readStagedSnapshotComposition({ projectId: scope.projectId, storage, trustSet, lastGood: null,
        binding: { projectId: scope.projectId, publishSequence: sourceRun.publishSequence, keyId: sourceManifest.keyId,
          manifestSha256: stage.manifestSha256, manifestCanonical: canonicalJson(sourceManifest as CanonicalJsonValue) } });
      for (const file of source.files) expect(Buffer.from(file.body).equals(
        objects.get(createProjectSnapshotKey(scope.projectId, file.manifest.sha256))!)).toBe(true);
      const composition = composeRollbackSnapshot({ source, currentPublishSequence: reservation.publishSequence - 1,
        generatedAt: reservation.createdAt.toISOString(), publishedAt: reservation.createdAt.toISOString(), keyId: "synthetic-rollback-key" });
      expect(composition.files.map((row) => Buffer.from(row.body))).toEqual(source.files.map((row) => Buffer.from(row.body)));
      const manifest = await signSnapshotManifest(composition, createEd25519SecretRefSigner({ keyId: "synthetic-rollback-key", privateKeyRef: defineSecretRef("SYNTHETIC_ROLLBACK_KEY") }));
      expect(verifySnapshotSignatureCandidate({ manifest, trustSet, lastGood: { projectId: scope.projectId, schemaMajor: 1, publishSequence: sourceRun.publishSequence } }).accepted).toBe(true);
      if (mode === "content") await expect(cut((repo) => repo.bind(lease, { ...manifest, catalogRevision: "f".repeat(64) })))
        .rejects.toThrow("SNAPSHOT_ROLLBACK_BINDING_INVALID");
      const binding = await cut((repo) => repo.bind(lease, manifest));
      expect(await cut((repo) => repo.bind(lease, manifest))).toEqual(binding);
      if (mode === "canonical") {
        const altered = JSON.stringify(manifest, null, 2);
        const otherLease = await accept(sourceRun.publishSequence);
        const otherReservation = await cut((repo) => repo.reserve(otherLease));
        const other = { ...manifest, publishSequence: otherReservation.publishSequence,
          generatedAt: otherReservation.createdAt.toISOString(), publishedAt: otherReservation.createdAt.toISOString() };
        const raw = JSON.stringify(other, null, 2);
        await expect(cut((_repo, tx) => tx.snapshotRollbackBinding.create({ data: { ...scope, requestId: otherLease.requestId,
          publishSequence: otherReservation.publishSequence, keyId: other.keyId, manifestCanonical: raw,
          manifestSha256: calculateObjectSha256(new TextEncoder().encode(raw)), leaseJobRunId: otherLease.jobRunId,
          leaseAttempt: otherLease.attempt, leaseWorkerId: otherLease.workerId, leaseAcquiredAt: new Date(otherLease.leaseAcquiredAt) } })))
          .rejects.toThrow("SNAPSHOT_ROLLBACK_BINDING_INVALID");
        expect(altered).not.toBe(binding.manifestCanonical);
        if (activeLease) { await reliability.complete(activeLease); ownedLeases.delete(activeLease.outboxEventId); }
        activeLease = null;
      }
      // Durable identity alone has no rollback PUT/current/run/result effect.
      expect(puts).toBe(14);
      expect(await cut((_repo, tx) => tx.deliveryRun.count({ where: scope }))).toBe(1);
      await observer(scope, async (tx) => {
        expect((await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: lease.requestId } })).status).toBe("RUNNING");
      }, "operations-executor");
      await expect(cut((repo) => repo.markStaged({ ...lease, attempt: lease.attempt + 1 }))).rejects.toThrow("OUTBOX_OPERATION_LEASE_LOST");
      await storage.put({ key: createProjectSnapshotKey(scope.projectId, binding.manifestSha256), body: new TextEncoder().encode(binding.manifestCanonical), contentType: "application/json", sha256: binding.manifestSha256 });
      const captured = await loadSelectedSnapshotCaptureServer(setup.principal, { buildInputId: stage.buildInputId });
      const anchors = prepareSelectedSnapshotAdmission(captured.receipt, verified);
      const staged = await cut(async (repo, tx) => { await repo.fence(lease); await admitHistoricalSnapshotRollback(tx, scope, anchors); return repo.markStaged(lease); });
      expect(staged.stagedAt).toBeInstanceOf(Date); expect(puts).toBe(15);
      expect(await cut((repo) => repo.markStaged(lease))).toEqual(staged);
      await expect(cut((_repo, tx) => tx.snapshotRollbackBinding.update({ where: { organizationId_projectId_requestId: { ...scope, requestId: lease.requestId } }, data: { stagedAt: null } })))
        .rejects.toThrow("SNAPSHOT_ROLLBACK_BINDING_IMMUTABLE");
      await expect(cut((_repo, tx) => tx.$executeRaw(Prisma.sql`UPDATE "SnapshotRollbackReservation" SET "publishSequence"="publishSequence"+1 WHERE "requestId"=${lease.requestId}`)))
        .rejects.toThrow(); // Worker has no reservation UPDATE grant.
      if (mode === "prior-rollback") {
        const rollbackRun = await cut((_repo, tx) => new PrismaSnapshotDeliveryRepository(tx).publishCurrentAndCreateRun({ ...scope,
          publishSequence: reservation.publishSequence, manifestSha256: binding.manifestSha256, manifestKey: createProjectSnapshotKey(scope.projectId, binding.manifestSha256), publishedAt: reservation.createdAt }));
        const followup = await accept(rollbackRun.publishSequence);
        const next = await cut((repo) => repo.reserve(followup));
        expect(next).toMatchObject({ sourceDeliveryRunId: rollbackRun.deliveryRunId, rootBuildInputId: setup.receipt.id,
          inputHash: setup.receipt.inputHash, sourcePublishSequence: reservation.publishSequence, publishSequence: reservation.publishSequence + 1 });
      }
    } finally {
      // Fixture queue cleanup only, NOT operational success or executor proof.
      for (const lease of ownedLeases.values()) await reliability.complete(lease);
      send.mockRestore(); client.destroy(); vi.unstubAllEnvs();
    }
  }, 60_000);
  it.each(["success", "late-failure", "late-cancel", "takeover", "project", "trust"])("atomic operational selected PUBLISH: %s", async (mode) => {
    const setup = await fixture(); const { scope } = setup; const controller = new AbortController();
    const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-ops-publish", correlationId: randomUUID() };
    const keys = generateKeyPairSync("ed25519");
    vi.stubEnv("SYNTHETIC_STAGE_KEY", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    const objects = new Map<string, Uint8Array>(); let puts = 0; let gets = 0; let takeoverDone = false;
    let now = new Date("1996-01-01T00:00:01Z");
    const reliability = new ReliabilityService(new PrismaReliabilityRepository(), () => now);
    let replacement: Awaited<ReturnType<typeof reliability.claim>> = null;
    const trustSet = { currentKeyId: "synthetic-stage-key", nextKeyId: null, revokedKeyIds: [] as string[],
      publicKeys: { "synthetic-stage-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } };
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      expect(cuts.active).toBe(0);
      if (command instanceof PutObjectCommand) {
        puts++; objects.set(command.input.Key!, Uint8Array.from(command.input.Body as Uint8Array)); return { ETag: "synthetic-ops" } as never;
      }
      if (command instanceof GetObjectCommand) {
        gets++; const bytes = objects.get(command.input.Key!); if (!bytes) throw new Error("SYNTHETIC_MISSING_OBJECT");
        if (!takeoverDone && mode === "takeover") {
          takeoverDone = true; now = new Date("1996-01-01T00:06:00Z");
          replacement = await reliability.claim("synthetic-publish-takeover", 300_000, [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_PUBLISH]);
          expect(replacement?.attempt).toBe(2);
        }
        return { ContentLength: bytes.length, ContentType: "application/octet-stream", LastModified: new Date(0),
          Body: { destroy() {}, async *[Symbol.asyncIterator]() { yield bytes; } } } as never;
      }
      throw new Error("SYNTHETIC_UNEXPECTED_IO");
    });
    const storage = new S3ObjectStorage({ bucket: "synthetic-ops", client });
    const actualSucceed = OperationalActionLifecycleRepository.prototype.succeedPublishedSnapshot;
    const succeed = vi.spyOn(OperationalActionLifecycleRepository.prototype, "succeedPublishedSnapshot").mockImplementationOnce(async function (this: OperationalActionLifecycleRepository, lease, result) {
      const value = await actualSucceed.call(this, lease, result);
      if (mode === "late-failure") throw new Error("SYNTHETIC_AFTER_SUCCESS_FAILURE");
      if (mode === "late-cancel") controller.abort();
      return value;
    });
    try {
      const stage = await createSnapshotStagedBuildServer({ ...scope, storage, trustSet, keyId: "synthetic-stage-key",
        privateKeyRef: defineSecretRef("SYNTHETIC_STAGE_KEY") })(setup.principal, setup.lookup);
      vi.stubEnv("SYNTHETIC_STAGE_KEY", "");
      const accepted = await requestOperationalAction(admin, { ...scope, action: "SNAPSHOT_PUBLISH", buildInputId: stage.buildInputId,
        sourceId: "", sourceRevisionId: "", reason: "", idempotencyKey: randomUUID() });
      const eventId = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        const request = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } });
        if (!request.outboxEventId) throw new Error("SYNTHETIC_INTENT_MISSING");
        await tx.outboxEvent.update({ where: { id: request.outboxEventId }, data: { availableAt: new Date("1996-01-01T00:00:00Z") } });
        return request.outboxEventId;
      });
      const lease = await reliability.claim(`synthetic-publish-${randomUUID()}`, 300_000, [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_PUBLISH]);
      if (!lease || lease.outboxEventId !== eventId) throw new Error("SYNTHETIC_LEASE_MISSING");
      const resolvePublication = vi.fn(() => ({ ...scope, storage, getTrust: () => trustSet }));
      const execute = createOperationalSnapshotPublishExecutor({ resolvePublication });
      if (mode === "success") {
        for (const altered of [{ ...lease, attempt: lease.attempt + 1 }, { ...lease, workerId: "synthetic-wrong-worker" },
          { ...lease, jobRunId: "synthetic-missing-job" }, { ...lease, leaseAcquiredAt: "1996-01-01T00:00:02.000Z" }]) {
          await expect(execute(altered)).rejects.toThrow("OUTBOX_OPERATION_LEASE_LOST");
        }
        expect(resolvePublication).not.toHaveBeenCalled(); expect(gets).toBe(0);
      }
      // Direct SQL cannot manufacture success merely from a selected stage.
      await observer(scope, (tx) => new OperationalActionLifecycleRepository(tx).begin(lease), "operations-executor");
      await expect(observer(scope, (tx) => tx.operationalActionRequest.update({ where: { id: accepted.requestId }, data: {
        status: "SUCCEEDED", finishedAt: new Date(), result: { action: "SNAPSHOT_PUBLISH", buildInputId: stage.buildInputId,
          deliveryRunId: "missing-run", publishSequence: stage.publishSequence, manifestSha256: stage.manifestSha256 },
      } }), "operations-executor")).rejects.toThrow("OPERATIONS_CONTROL_RESULT_INVALID");
      if (mode === "project") await runInPrincipalDatabaseTransaction(admin, (tx) => tx.project.update({ where: { id: scope.projectId }, data: { serviceState: "SUSPENDED" } }));
      if (mode === "trust") trustSet.revokedKeyIds.push("synthetic-stage-key");
      const first = execute(lease, controller.signal);
      if (mode === "success") await expect(first).resolves.toMatchObject({ action: "SNAPSHOT_PUBLISH", buildInputId: stage.buildInputId });
      else await expect(first).rejects.toThrow({ "late-failure": "SYNTHETIC_AFTER_SUCCESS_FAILURE", "late-cancel": "OPERATIONS_CONTROL_EXECUTION_CANCELLED",
        takeover: "OUTBOX_OPERATION_LEASE_LOST", project: "SNAPSHOT_PUBLICATION_PROJECT_BLOCKED", trust: "SNAPSHOT_ARTIFACT_REVOKED_KEY_ID" }[mode]);
      await observer(scope, async (tx) => {
        expect((await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } })).status).toBe(mode === "success" ? "SUCCEEDED" : "RUNNING");
        expect(await tx.deliveryRun.count({ where: scope })).toBe(mode === "success" ? 1 : 0);
        expect(await tx.projectCurrentSnapshotManifest.count({ where: scope })).toBe(mode === "success" ? 1 : 0);
        expect(await tx.snapshotBuildInputPart.findMany({ where: scope })).toEqual([]);
        expect(await tx.snapshotPublicationBinding.findMany({ where: scope })).toEqual([]);
      }, "operations-executor");
      succeed.mockRestore(); trustSet.revokedKeyIds.length = 0;
      if (mode === "project") await runInPrincipalDatabaseTransaction(admin, (tx) => tx.project.update({ where: { id: scope.projectId }, data: { serviceState: "ACTIVE" } }));
      const result = mode === "success" ? await execute(lease) : await execute(replacement ?? lease);
      expect(result).toMatchObject({ action: "SNAPSHOT_PUBLISH", buildInputId: stage.buildInputId, publishSequence: stage.publishSequence, manifestSha256: stage.manifestSha256 });
      let currentSequence = stage.publishSequence;
      if (mode === "success") {
        // Actual newer stage/publication: an older operational replay must not move current backwards.
        const newerCapture = await captureSnapshotInput(setup.principal, { ...scope, schemaMinor: 0, idempotencyKey: "synthetic-ops-publish-newer" });
        vi.stubEnv("SYNTHETIC_STAGE_KEY", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
        const newerStage = await createSnapshotStagedBuildServer({ ...scope, storage, trustSet, keyId: "synthetic-stage-key",
          privateKeyRef: defineSecretRef("SYNTHETIC_STAGE_KEY") })(setup.principal, {
            idempotencyKeyHash: newerCapture.idempotencyKeyHash, requestHash: newerCapture.requestHash });
        vi.stubEnv("SYNTHETIC_STAGE_KEY", "");
        const finishNewer = await createSelectedSnapshotPublicationServer({ ...scope, storage, getTrust: () => trustSet })(setup.principal, { buildInputId: newerStage.buildInputId });
        await observer(scope, finishNewer); currentSequence = newerStage.publishSequence;
      }
      const beforeReplayGets = gets; const beforeReplayResolve = resolvePublication.mock.calls.length;
      await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        await tx.project.update({ where: { id: scope.projectId }, data: { serviceState: "SUSPENDED" } });
        await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } });
      });
      trustSet.revokedKeyIds.push("synthetic-stage-key"); resolvePublication.mockImplementation(() => { throw new Error("SYNTHETIC_CONFIG_MUST_NOT_BE_READ"); });
      if (!replacement) { now = new Date("1996-01-01T00:06:00Z"); replacement = await reliability.claim("synthetic-publish-replay", 300_000, [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_PUBLISH]); }
      if (!replacement) throw new Error("SYNTHETIC_REPLACEMENT_MISSING");
      expect(await execute(replacement)).toEqual(result);
      expect(gets).toBe(beforeReplayGets); expect(resolvePublication).toHaveBeenCalledTimes(beforeReplayResolve); expect(puts).toBe(mode === "success" ? 28 : 14);
      await reliability.complete(replacement);
      await observer(scope, async (tx) => {
        expect(await tx.deliveryRun.count({ where: scope })).toBe(mode === "success" ? 2 : 1); expect(await tx.projectCurrentSnapshotManifest.count({ where: scope })).toBe(1);
        expect((await tx.projectCurrentSnapshotManifest.findFirstOrThrow({ where: scope })).publishSequence).toBe(currentSequence);
        expect((await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } })).result).toEqual(result);
      }, "operations-executor");
    } finally { succeed.mockRestore(); send.mockRestore(); client.destroy(); vi.unstubAllEnvs(); }
  }, 60_000);
  it.each(["success", "trust", "project", "source", "catalog", "media", "freeze", "cancel", "rollback", "wrong-purpose"])(
    "selected staged publication final cut: %s", async (mode) => {
      const setup = await fixture(mode === "media"); const { scope } = setup;
      const controller = new AbortController(); const keys = generateKeyPairSync("ed25519");
      vi.stubEnv("SYNTHETIC_STAGE_KEY", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
      const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
      const objects = new Map<string, Uint8Array>(); let puts = 0; let gets = 0; let heads = 0;
      const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
        expect(cuts.active).toBe(0);
        if (command instanceof HeadObjectCommand) {
          heads++; return { ContentLength: 100, ContentType: "image/jpeg", LastModified: new Date(0) } as never;
        }
        if (command instanceof PutObjectCommand) {
          puts++; objects.set(command.input.Key!, Uint8Array.from(command.input.Body as Uint8Array));
          return { ETag: "synthetic-selected" } as never;
        }
        if (command instanceof GetObjectCommand) {
          gets++; const bytes = objects.get(command.input.Key!); if (!bytes) throw new Error("SYNTHETIC_MISSING_OBJECT");
          return { ContentLength: bytes.length, ContentType: "application/octet-stream", LastModified: new Date(0),
            Body: { destroy() {}, async *[Symbol.asyncIterator]() { yield bytes; } } } as never;
        }
        throw new Error("SYNTHETIC_UNEXPECTED_IO");
      });
      const storage = new S3ObjectStorage({ bucket: "synthetic-selected", client });
      const trustSet = { currentKeyId: "synthetic-stage-key", nextKeyId: null, revokedKeyIds: [] as string[],
        publicKeys: { "synthetic-stage-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } };
      const actualPublish = PrismaSnapshotDeliveryRepository.prototype.publishCurrentAndCreateRun;
      const publish = vi.spyOn(PrismaSnapshotDeliveryRepository.prototype, "publishCurrentAndCreateRun").mockImplementation(async function (this: PrismaSnapshotDeliveryRepository, input) {
        const run = await actualPublish.call(this, input); if (mode === "rollback") controller.abort(); return run;
      });
      try {
        const stage = await createSnapshotStagedBuildServer({ ...scope, storage, trustSet, keyId: "synthetic-stage-key",
          privateKeyRef: defineSecretRef("SYNTHETIC_STAGE_KEY") })(setup.principal, setup.lookup);
        const lookup = { buildInputId: stage.buildInputId }; const buildHeads = heads;
        expect(await inspectSelectedSnapshotRunServer(setup.principal, lookup)).toBeNull();
        vi.stubEnv("SYNTHETIC_STAGE_KEY", "");
        const finish = await createSelectedSnapshotPublicationServer({ ...scope, storage, getTrust: () => trustSet })(setup.principal, lookup, controller.signal);
        expect(gets).toBe(14); expect(puts).toBe(14); expect(heads).toBe(buildHeads);
        const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-selected-final", correlationId: randomUUID() };
        await runInPrincipalDatabaseTransaction(admin, async (tx) => {
          if (mode === "project") await tx.project.update({ where: { id: scope.projectId }, data: { serviceState: "SUSPENDED" } });
          if (mode === "source") await tx.source.create({ data: { ...scope, sourceKey: "synthetic-selected-stale", name: "Synthetic selected stale",
            adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
            datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" } } });
          if (mode === "catalog") await tx.projectCatalogSubscriptionCity.deleteMany({ where: scope });
          if (mode === "media") await tx.mediaAsset.update({ where: { id: setup.mediaId! }, data: { rightsBasis: "OWNED", license: null } });
          if (mode === "freeze") await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } });
        });
        if (mode === "trust") trustSet.revokedKeyIds.push("synthetic-stage-key");
        if (mode === "cancel") controller.abort();
        const pending = observer(scope, finish, mode === "wrong-purpose" ? "operations-executor" : "snapshot-publication");
        if (mode === "success") {
          const run = await pending;
          expect(run).toMatchObject({ publishSequence: stage.publishSequence, manifestSha256: stage.manifestSha256, publishedAt: setup.receipt.capturedAt });
          // Same prepared closure is config-free on committed replay, including revoked trust and cancellation.
          trustSet.revokedKeyIds.push("synthetic-stage-key"); controller.abort();
          expect(await observer(scope, finish)).toEqual(run);
          expect(await inspectSelectedSnapshotRunServer(setup.principal, lookup)).toEqual(run);
        } else {
          const errors: Record<string, string> = { trust: "SNAPSHOT_ARTIFACT_REVOKED_KEY_ID", project: "SNAPSHOT_PUBLICATION_PROJECT_BLOCKED",
            source: "SNAPSHOT_PUBLICATION_SOURCE_STALE", catalog: "SNAPSHOT_PUBLICATION_CATALOG_STALE", media: "SNAPSHOT_PUBLICATION_MEDIA_STALE",
            freeze: "SNAPSHOT_PUBLICATION_JOBS_FROZEN", cancel: "SNAPSHOT_PUBLICATION_CANCELLED", rollback: "SNAPSHOT_PUBLICATION_CANCELLED",
            "wrong-purpose": "SNAPSHOT_INPUT_ACCESS_DENIED" };
          await expect(pending).rejects.toThrow(errors[mode]);
        }
        await observer(scope, async (tx) => {
          expect(await tx.deliveryRun.count({ where: scope })).toBe(mode === "success" ? 1 : 0);
          expect(await tx.projectCurrentSnapshotManifest.count({ where: scope })).toBe(mode === "success" ? 1 : 0);
          expect(await tx.snapshotArtifactStageReceipt.count({ where: scope })).toBe(1);
          expect(await tx.snapshotPublicationBinding.count({ where: scope })).toBe(1);
        });
        expect(gets).toBe(14); expect(puts).toBe(14); expect(heads).toBe(buildHeads);
        expect(publish).toHaveBeenCalledTimes(mode === "success" || mode === "rollback" ? 1 : 0);
      } finally { publish.mockRestore(); send.mockRestore(); client.destroy(); vi.unstubAllEnvs(); }
    }, 60_000);
  it("reads actual persisted staged artifacts using public trust only, without reassembly or publication", async () => {
    const setup = await fixture(true); const keys = generateKeyPairSync("ed25519");
    vi.stubEnv("SYNTHETIC_STAGE_KEY", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    const objects = new Map<string, Uint8Array>(); let puts = 0; let gets = 0; let heads = 0;
    const destroyed = vi.fn(); const wholeBody = vi.fn();
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      expect(cuts.active).toBe(0);
      if (command instanceof HeadObjectCommand) {
        heads++; return { ContentLength: 100, ContentType: "image/jpeg", LastModified: new Date(0) } as never;
      }
      if (command instanceof PutObjectCommand) {
        puts++; expect(command.input.Body).toBeInstanceOf(Uint8Array);
        objects.set(command.input.Key!, Uint8Array.from(command.input.Body as Uint8Array));
        return { ETag: "synthetic-stage" } as never;
      }
      if (command instanceof GetObjectCommand) {
        gets++; expect(command.input.Key).toMatch(new RegExp(`^snapshots/${setup.scope.projectId}/[a-f0-9]{64}$`, "u"));
        const bytes = objects.get(command.input.Key!);
        if (!bytes) throw Object.assign(new Error(), { name: "NoSuchKey" });
        return { ContentLength: bytes.length, ContentType: "application/octet-stream", LastModified: new Date(0),
          Body: { destroy: destroyed, transformToByteArray: wholeBody, async *[Symbol.asyncIterator]() { yield bytes; } } } as never;
      }
      throw new Error("SYNTHETIC_UNEXPECTED_IO");
    });
    const storage = new S3ObjectStorage({ bucket: "synthetic-stage", client });
    const trustSet = { currentKeyId: "synthetic-stage-key", nextKeyId: null, revokedKeyIds: [] as string[],
      publicKeys: { "synthetic-stage-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } };
    try {
      const stage = await createSnapshotStagedBuildServer({ ...setup.scope, storage, keyId: "synthetic-stage-key",
        privateKeyRef: defineSecretRef("SYNTHETIC_STAGE_KEY"), trustSet })(setup.principal, setup.lookup);
      expect(puts).toBe(14); const buildHeads = heads;
      const binding = await observer(setup.scope, (tx) => tx.snapshotPublicationBinding.findUniqueOrThrow({ where: {
        organizationId_projectId_buildInputId: { ...setup.scope, buildInputId: stage.buildInputId },
      } }));
      const selectedLookup = { buildInputId: stage.buildInputId };
      expect(await inspectSelectedSnapshotStageServer(setup.principal, selectedLookup)).toMatchObject({
        input: { id: setup.receipt.id, inputHash: setup.receipt.inputHash }, stage, binding, run: null, current: null,
      });
      const captured = await loadSelectedSnapshotCaptureServer(setup.principal, selectedLookup);
      expect(captured.receipt).toEqual(setup.receipt); expect(captured.stage).toEqual(stage); expect(captured.binding).toEqual(binding);
      await expect(inspectSelectedSnapshotStageServer(setup.principal, { buildInputId: "missing-stage" })).resolves.toBeNull();
      await expect(loadSelectedSnapshotCaptureServer(setup.principal, { buildInputId: "missing-stage" })).rejects.toThrow("SNAPSHOT_STAGE_NOT_FOUND");
      const foreign = createProjectJobPrincipal({ ...setup.scope, projectId: setup.foreignId, jobName: "snapshot-input" });
      await expect(inspectSelectedSnapshotStageServer(foreign, selectedLookup)).resolves.toBeNull();
      await expect(loadSelectedSnapshotCaptureServer(foreign, selectedLookup)).rejects.toThrow("SNAPSHOT_STAGE_NOT_FOUND");
      const wrongPurpose = createProjectJobPrincipal({ ...setup.scope, jobName: "operations-executor" });
      await expect(inspectSelectedSnapshotStageServer(wrongPurpose, selectedLookup)).rejects.toThrow("SNAPSHOT_INPUT_ACCESS_DENIED");
      await expect(loadSelectedSnapshotCaptureServer(wrongPurpose, selectedLookup)).rejects.toThrow("SNAPSHOT_INPUT_ACCESS_DENIED");
      await observer(setup.scope, async (tx) => {
        expect(await tx.snapshotPublicationBinding.findMany({ where: setup.scope })).toEqual([]);
        expect(await tx.snapshotBuildInputPart.findMany({ where: setup.scope })).toEqual([]);
      }, "operations-executor");
      vi.stubEnv("SYNTHETIC_STAGE_KEY", ""); // Verification has no private signing capability.
      const selected = { projectId: setup.scope.projectId, storage, trustSet, lastGood: null,
        binding: { projectId: binding.projectId, publishSequence: binding.publishSequence, keyId: binding.keyId,
          manifestSha256: binding.manifestSha256, manifestCanonical: binding.manifestCanonical } };
      const result = await readStagedSnapshotArtifacts(selected);
      expect(result.manifest.publishSequence).toBe(stage.publishSequence);
      expect(result.datasets.agents).toHaveLength(1); expect(result.datasets.media).toHaveLength(1);
      const admission = prepareSelectedSnapshotAdmission(captured.receipt, result);
      expect(admission.projectAnchors.agents).toHaveLength(1);
      expect(admission.mediaAnchors.attachments).toHaveLength(1);
      expect(admission.mediaAnchors.attachments[0]?.asset.id).toBe(setup.mediaId);
      expect(admission.requiresProjectContact).toBe(false);
      // Pure preparation negatives alter already decoded values only. These are
      // attribution tests, not claims that a changed value retains its signature.
      const alteredSequence = { ...result, manifest: { ...result.manifest, publishSequence: result.manifest.publishSequence + 1 } };
      expect(() => prepareSelectedSnapshotAdmission(captured.receipt, alteredSequence)).toThrow("SNAPSHOT_SELECTED_ADMISSION_INVALID");
      expect(() => prepareSelectedSnapshotAdmission(captured.receipt, { ...result,
        manifest: { ...result.manifest, sourceRevisions: ["uncaptured-revision"] } })).toThrow("SNAPSHOT_SELECTED_ADMISSION_INVALID");
      expect(() => prepareSelectedSnapshotAdmission(captured.receipt, { ...result,
        datasets: { ...result.datasets, agents: [] } })).toThrow("SNAPSHOT_SELECTED_ADMISSION_INVALID");
      const decodedAgent = result.datasets.agents[0] as { uid: string; media: readonly unknown[] };
      const decodedMedia = result.datasets.media[0] as { entityType: string; entityUid: string; media: { ref: string; kind: string; position: number } };
      expect(() => prepareSelectedSnapshotAdmission(captured.receipt, { ...result,
        datasets: { ...result.datasets, agents: [{ ...decodedAgent, fullName: "Changed public Agent" }] } }))
        .toThrow("SNAPSHOT_SELECTED_ADMISSION_INVALID");
      expect(() => prepareSelectedSnapshotAdmission(captured.receipt, { ...result,
        datasets: { ...result.datasets, media: [{ ...decodedMedia, entityUid: createUlid() }] } }))
        .toThrow("SNAPSHOT_SELECTED_ADMISSION_INVALID");
      expect(() => prepareSelectedSnapshotAdmission(captured.receipt, { ...result,
        datasets: { ...result.datasets, media: [{ ...decodedMedia, media: { ...decodedMedia.media, width: 100 } }] } }))
        .toThrow("SNAPSHOT_SELECTED_ADMISSION_INVALID");
      expect(() => prepareSelectedSnapshotAdmission(captured.receipt, { ...result,
        datasets: { ...result.datasets, "project/contacts": [{ phone: "Synthetic unbound contact" }] } }))
        .toThrow("SNAPSHOT_SELECTED_ADMISSION_INVALID");
      const omittedMedia = { ...result, datasets: { ...result.datasets, media: [], agents: [{ ...decodedAgent, media: [] }] } };
      expect(prepareSelectedSnapshotAdmission(captured.receipt, omittedMedia).mediaAnchors.attachments).toEqual([]);
      const originalAdmission = structuredClone(admission);
      const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-historical-admission", correlationId: randomUUID() };
      await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        await tx.agent.update({ where: { uid: decodedAgent.uid }, data: { fullName: "Synthetic newer public name", version: { increment: 1 } } });
        await tx.projectCatalogSubscription.update({ where: { organizationId_projectId: setup.scope }, data: { version: { increment: 1 } } });
      });
      await observer(setup.scope, async (tx) => {
        await lockSnapshotPublication(tx, setup.scope);
        await expect(createSnapshotPublicationProjectReader(tx)(setup.scope, admission.projectAnchors))
          .rejects.toThrow("SNAPSHOT_PUBLICATION_PROJECT_STALE");
        await admitHistoricalSnapshotRollback(tx, setup.scope, admission);
      });
      // Actual persisted capture -> signed/bounded GET -> private attribution ->
      // fresh permission-only admission. This seam does NOT publish a rollback.
      expect(admission).toEqual(originalAdmission);
      expect(result.datasets.agents[0]).toMatchObject({ fullName: "Synthetic public Agent" });
      await runInPrincipalDatabaseTransaction(admin, (tx) => tx.mediaAsset.update({ where: { id: setup.mediaId! }, data: { rightsBasis: "OWNED", license: null } }));
      await expect(observer(setup.scope, async (tx) => {
        await lockSnapshotPublication(tx, setup.scope); await admitHistoricalSnapshotRollback(tx, setup.scope, admission);
      })).rejects.toThrow("SNAPSHOT_PUBLICATION_MEDIA_STALE");
      expect(gets).toBe(14); expect(puts).toBe(14); expect(heads).toBe(buildHeads);
      expect(wholeBody).not.toHaveBeenCalled(); expect(destroyed).toHaveBeenCalledTimes(14);
      trustSet.revokedKeyIds.push("synthetic-stage-key");
      await expect(readStagedSnapshotArtifacts(selected)).rejects.toThrow("SNAPSHOT_ARTIFACT_REVOKED_KEY_ID");
      expect(gets).toBe(15); expect(puts).toBe(14); expect(heads).toBe(buildHeads);
      await observer(setup.scope, async (tx) => {
        expect(await tx.snapshotBuildInput.count({ where: setup.scope })).toBe(1);
        expect(await tx.snapshotArtifactStageReceipt.count({ where: setup.scope })).toBe(1);
        expect(await tx.snapshotPublicationBinding.count({ where: setup.scope })).toBe(1);
        expect(await tx.projectCurrentSnapshotManifest.count({ where: setup.scope })).toBe(0);
        expect(await tx.deliveryRun.count({ where: setup.scope })).toBe(0);
      });
    } finally { send.mockRestore(); client.destroy(); vi.unstubAllEnvs(); }
  }, 60_000);
  it("selected-stage replay ignores newer current, freeze, suspension and missing private capture capability", async () => {
    const setup = await fixture(); const keys = generateKeyPairSync("ed25519");
    vi.stubEnv("SYNTHETIC_STAGE_KEY", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      expect(cuts.active).toBe(0); expect(command).toBeInstanceOf(PutObjectCommand);
      return { ETag: "synthetic-stage" } as never;
    });
    const bound = { ...setup.scope, storage: new S3ObjectStorage({ bucket: "synthetic-stage", client }), keyId: "synthetic-stage-key",
      privateKeyRef: defineSecretRef("SYNTHETIC_STAGE_KEY"), trustSet: { currentKeyId: "synthetic-stage-key", nextKeyId: null,
        revokedKeyIds: [], publicKeys: { "synthetic-stage-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } } };
    let privateRead: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const old = await createSnapshotStagedBuildServer(bound)(setup.principal, setup.lookup);
      const oldRun = await observer(setup.scope, (tx) => new PrismaSnapshotDeliveryRepository(tx).publishCurrentAndCreateRun({
        ...setup.scope, publishSequence: old.publishSequence, manifestSha256: old.manifestSha256,
        manifestKey: createProjectSnapshotKey(setup.scope.projectId, old.manifestSha256), publishedAt: setup.receipt.capturedAt,
      })); // Test-controlled committed publication, not an operational PUBLISH proof.
      const newerCapture = await captureSnapshotInput(setup.principal, { ...setup.scope, idempotencyKey: "synthetic-newer-selected-stage", schemaMinor: 0 });
      const newer = await createSnapshotStagedBuildServer(bound)(setup.principal, {
        idempotencyKeyHash: newerCapture.idempotencyKeyHash, requestHash: newerCapture.requestHash,
      });
      const newerRun = await observer(setup.scope, (tx) => new PrismaSnapshotDeliveryRepository(tx).publishCurrentAndCreateRun({
        ...setup.scope, publishSequence: newer.publishSequence, manifestSha256: newer.manifestSha256,
        manifestKey: createProjectSnapshotKey(setup.scope.projectId, newer.manifestSha256), publishedAt: newerCapture.capturedAt,
      }));
      expect(send).toHaveBeenCalledTimes(28);
      vi.stubEnv("SYNTHETIC_STAGE_KEY", "");
      await runInPrincipalDatabaseTransaction({ kind: "platform-admin", userId: "synthetic-selected-replay", correlationId: randomUUID() }, async (tx) => {
        await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } });
        await tx.project.update({ where: { id: setup.scope.projectId }, data: { serviceState: "SUSPENDED" } });
      });
      privateRead = vi.spyOn(PrismaSnapshotInputRepository.prototype, "find").mockRejectedValue(new Error("SYNTHETIC_CAPTURE_READ_FORBIDDEN"));
      const selected = await inspectSelectedSnapshotStageServer(setup.principal, { buildInputId: old.buildInputId });
      expect(selected?.stage).toEqual(old); expect(selected?.run).toEqual(oldRun);
      expect(selected?.current).toMatchObject({ publishSequence: newer.publishSequence, manifestSha256: newer.manifestSha256 });
      expect(privateRead).not.toHaveBeenCalled(); expect(send).toHaveBeenCalledTimes(28);
      await observer(setup.scope, async (tx) => {
        expect(await tx.snapshotBuildInput.count({ where: setup.scope })).toBe(2);
        expect(await tx.snapshotArtifactStageReceipt.count({ where: setup.scope })).toBe(2);
        expect(await tx.deliveryRun.count({ where: setup.scope })).toBe(2);
        expect(await new PrismaSnapshotDeliveryRepository(tx).getCurrentManifest(setup.scope.organizationId, setup.scope.projectId))
          .toMatchObject({ publishSequence: newerRun.publishSequence, manifestSha256: newerRun.manifestSha256 });
      });
    } finally { privateRead?.mockRestore(); send.mockRestore(); client.destroy(); vi.unstubAllEnvs(); }
  }, 60_000);
  it("does not substitute an interrupted binding-only stage or an unbound capture", async () => {
    const setup = await fixture();
    const lookup = { buildInputId: setup.receipt.id };
    await expect(inspectSelectedSnapshotStageServer(setup.principal, lookup)).resolves.toBeNull();
    await expect(loadSelectedSnapshotCaptureServer(setup.principal, lookup)).rejects.toThrow("SNAPSHOT_STAGE_NOT_FOUND");
    const keys = generateKeyPairSync("ed25519");
    vi.stubEnv("SYNTHETIC_STAGE_KEY", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    const send = vi.spyOn(client, "send").mockRejectedValue(new Error("SYNTHETIC_PARTIAL_STAGE"));
    try {
      await expect(createSnapshotStagedBuildServer({ ...setup.scope, storage: new S3ObjectStorage({ bucket: "synthetic-stage", client }),
        keyId: "synthetic-stage-key", privateKeyRef: defineSecretRef("SYNTHETIC_STAGE_KEY"),
        trustSet: { currentKeyId: "synthetic-stage-key", nextKeyId: null, revokedKeyIds: [], publicKeys: {
          "synthetic-stage-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } },
      })(setup.principal, setup.lookup)).rejects.toThrow("SYNTHETIC_PARTIAL_STAGE");
      expect(await observer(setup.scope, (tx) => tx.snapshotPublicationBinding.count({ where: setup.scope }))).toBe(1);
      await expect(inspectSelectedSnapshotStageServer(setup.principal, lookup)).resolves.toBeNull();
      await expect(loadSelectedSnapshotCaptureServer(setup.principal, lookup)).rejects.toThrow("SNAPSHOT_STAGE_NOT_FOUND");
      expect(await observer(setup.scope, (tx) => tx.snapshotArtifactStageReceipt.count({ where: setup.scope }))).toBe(0);
    } finally { send.mockRestore(); client.destroy(); vi.unstubAllEnvs(); }
  }, 60_000);
  it.each(["success", "domain-commit-before-result", "takeover-during-put", "wrong-schema-minor"])("fences request-owned operational BUILD after %s", async (mode) => {
    const setup = await fixture(); const keys = generateKeyPairSync("ed25519");
    const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-ops-build", correlationId: randomUUID() };
    const accepted = await requestOperationalAction(admin, { ...setup.scope, action: "SNAPSHOT_BUILD",
      sourceId: "", sourceRevisionId: "", reason: "", idempotencyKey: randomUUID() });
    const eventId = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const row = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } });
      if (!row.outboxEventId) throw new Error("SYNTHETIC_INTENT_MISSING");
      await tx.outboxEvent.update({ where: { id: row.outboxEventId }, data: { availableAt: new Date("1997-01-01T00:00:00Z") } });
      return row.outboxEventId;
    });
    let now = new Date("1997-01-01T00:00:01Z");
    const reliability = new ReliabilityService(new PrismaReliabilityRepository(), () => now);
    const lease = await reliability.claim(`synthetic-ops-build-${randomUUID()}`, 300_000, [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD]);
    if (!lease || lease.outboxEventId !== eventId) throw new Error("SYNTHETIC_LEASE_MISSING");
    let replacement: typeof lease | null = null;
    vi.stubEnv("SYNTHETIC_STAGE_KEY", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      expect(cuts.active).toBe(0); expect(command).toBeInstanceOf(PutObjectCommand);
      if (mode === "takeover-during-put" && command instanceof PutObjectCommand && command.input.ContentType === "application/json") {
        now = new Date("1997-01-01T00:06:00Z");
        replacement = await reliability.claim("synthetic-ops-build-takeover", 300_000, [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD]);
        expect(replacement?.outboxEventId).toBe(eventId); expect(replacement?.attempt).toBe(2);
      }
      return { ETag: "synthetic-stage" } as never;
    });
    const resolveStage = vi.fn(() => ({ ...setup.scope, storage: new S3ObjectStorage({ bucket: "synthetic-stage", client }),
      keyId: "synthetic-stage-key", privateKeyRef: defineSecretRef("SYNTHETIC_STAGE_KEY"),
      trustSet: { currentKeyId: "synthetic-stage-key", nextKeyId: null, revokedKeyIds: [],
        publicKeys: { "synthetic-stage-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } } }));
    const execute = createOperationalSnapshotBuildExecutor({ resolveStage });
    const completion = mode === "domain-commit-before-result" ? vi.spyOn(OperationalActionLifecycleRepository.prototype, "succeedStagedSnapshot")
      .mockRejectedValueOnce(new Error("SYNTHETIC_RESULT_CRASH")) : null;
    try {
      if (mode === "wrong-schema-minor") {
        await observer(setup.scope, (tx) => new OperationalActionLifecycleRepository(tx).begin(lease), "operations-executor");
        const wrongRequest = { ...operationalSnapshotBuildRequest(setup.scope, accepted.requestId).request, schemaMinor: 1 };
        await captureSnapshotInput(setup.principal, wrongRequest);
        const wrong = await createSnapshotStagedBuildServer(resolveStage())(setup.principal, snapshotInputRequestHashes(wrongRequest));
        await expect(observer(setup.scope, (tx) => tx.operationalActionRequest.update({ where: { id: accepted.requestId },
          data: { status: "SUCCEEDED", finishedAt: new Date(), result: { action: "SNAPSHOT_BUILD", buildInputId: wrong.buildInputId,
            inputHash: wrong.inputHash, publishSequence: wrong.publishSequence, manifestSha256: wrong.manifestSha256 } },
        }), "operations-executor")).rejects.toThrow("OPERATIONS_CONTROL_RESULT_INVALID");
        await expect(execute(lease)).rejects.toThrow("SNAPSHOT_INPUT_IDEMPOTENCY_CONFLICT");
        expect(send).toHaveBeenCalledTimes(14);
        await runInPrincipalDatabaseTransaction(admin, async (tx) => {
          expect((await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } })).status).toBe("RUNNING");
          expect(await tx.projectCurrentSnapshotManifest.count({ where: setup.scope })).toBe(0);
          expect(await tx.deliveryRun.count({ where: setup.scope })).toBe(0);
        });
        await reliability.fail(lease, "SYNTHETIC_WRONG_MINOR", false, 1);
        await settleTerminalOperationalRequests([{ id: eventId, organizationId: setup.scope.organizationId, payload: lease.payload }]);
        return;
      }
      const initial = execute(lease);
      if (mode === "success") await expect(initial).resolves.toMatchObject({ action: "SNAPSHOT_BUILD", publishSequence: 2 });
      else await expect(initial).rejects.toThrow(mode === "takeover-during-put" ? "OUTBOX_OPERATION_LEASE_LOST" : "SYNTHETIC_RESULT_CRASH");
      completion?.mockRestore();
      expect(send).toHaveBeenCalledTimes(14); expect(resolveStage).toHaveBeenCalledTimes(1);
      if (mode === "domain-commit-before-result") {
        // The receipt exists, but direct SQL cannot substitute another input or hash.
        await expect(observer(setup.scope, (tx) => tx.operationalActionRequest.update({
          where: { id: accepted.requestId }, data: { status: "SUCCEEDED", finishedAt: new Date(),
            result: { action: "SNAPSHOT_BUILD", buildInputId: setup.receipt.id, inputHash: setup.receipt.inputHash,
              publishSequence: setup.receipt.publishSequence, manifestSha256: "e".repeat(64) } },
        }), "operations-executor")).rejects.toThrow("OPERATIONS_CONTROL_RESULT_INVALID");
      }
      await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        const row = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } });
        expect(row.status).toBe(mode === "success" ? "SUCCEEDED" : "RUNNING");
        expect(await tx.snapshotBuildInput.count({ where: setup.scope })).toBe(2);
        expect(await tx.projectCurrentSnapshotManifest.count({ where: setup.scope })).toBe(0);
        expect(await tx.deliveryRun.count({ where: setup.scope })).toBe(0);
        await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } });
        await tx.project.update({ where: { id: setup.scope.projectId }, data: { serviceState: "SUSPENDED" } });
      });
      vi.stubEnv("SYNTHETIC_STAGE_KEY", ""); resolveStage.mockImplementation(() => { throw new Error("SYNTHETIC_CONFIG_MUST_NOT_BE_READ"); });
      if (!replacement) {
        now = new Date("1997-01-01T00:06:00Z");
        replacement = await reliability.claim("synthetic-ops-build-recovery", 300_000, [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD]);
      }
      if (!replacement) throw new Error("SYNTHETIC_REPLACEMENT_MISSING");
      const replay = await execute(replacement);
      expect(replay).toMatchObject({ action: "SNAPSHOT_BUILD", publishSequence: 2 });
      expect(send).toHaveBeenCalledTimes(14); expect(resolveStage).toHaveBeenCalledTimes(1);
      await reliability.complete(replacement);
      await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        expect((await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } })).status).toBe("SUCCEEDED");
        expect(await tx.snapshotBuildInput.count({ where: setup.scope })).toBe(2);
        expect(await tx.projectCurrentSnapshotManifest.count({ where: setup.scope })).toBe(0);
        expect(await tx.deliveryRun.count({ where: setup.scope })).toBe(0);
      });
      const { lookup } = operationalSnapshotBuildRequest(setup.scope, accepted.requestId);
      expect(await inspectStagedSnapshotServer(setup.principal, lookup)).toMatchObject({ publishSequence: 2 });
    } finally { completion?.mockRestore(); send.mockRestore(); client.destroy(); vi.unstubAllEnvs(); }
  });
  it("recovers a concurrently committed stage after cancellation following the initial replay miss", async () => {
    const setup = await fixture(); const keys = generateKeyPairSync("ed25519"); const controller = new AbortController();
    vi.stubEnv("SYNTHETIC_STAGE_KEY", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      expect(cuts.active).toBe(0); expect(command).toBeInstanceOf(PutObjectCommand);
      return { ETag: "synthetic-stage" } as never;
    });
    const build = createSnapshotStagedBuildServer({ ...setup.scope, storage: new S3ObjectStorage({ bucket: "synthetic-stage", client }),
      keyId: "synthetic-stage-key", privateKeyRef: defineSecretRef("SYNTHETIC_STAGE_KEY"),
      trustSet: { currentKeyId: "synthetic-stage-key", nextKeyId: null, revokedKeyIds: [],
        publicKeys: { "synthetic-stage-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } } });
    let committed: Awaited<ReturnType<typeof build>> | undefined;
    cuts.afterInitialStageReplay = async () => {
      committed = await build(setup.principal, setup.lookup);
      controller.abort("Synthetic private cancellation reason");
    };
    try {
      const replay = await build(createProjectJobPrincipal({ ...setup.scope, jobName: "snapshot-input",
        correlationId: "synthetic-stage-replay-race" }), setup.lookup, controller.signal);
      expect(committed).toBeDefined(); expect(replay).toEqual(committed); expect(send).toHaveBeenCalledTimes(14);
      await observer(setup.scope, async (tx) => {
        expect(await tx.snapshotArtifactStageReceipt.count()).toBe(1);
        expect(await tx.projectCurrentSnapshotManifest.count()).toBe(0); expect(await tx.deliveryRun.count()).toBe(0);
      });
    } finally { cuts.afterInitialStageReplay = null; send.mockRestore(); client.destroy(); vi.unstubAllEnvs(); }
  });
  it("records BUILD only after settled artifacts/manifest, replays without configuration and never writes current", async () => {
    const setup = await fixture(); const keys = generateKeyPairSync("ed25519");
    vi.stubEnv("SYNTHETIC_STAGE_KEY", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    let manifests = 0;
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      expect(cuts.active).toBe(0); expect(command).toBeInstanceOf(PutObjectCommand);
      await observer(setup.scope, (tx) => tx.snapshotArtifactStageReceipt.count().then((count) => expect(count).toBe(0)));
      if (command instanceof PutObjectCommand && command.input.ContentType === "application/json") manifests++;
      return { ETag: "synthetic-stage" } as never;
    });
    const bound = { ...setup.scope, storage: new S3ObjectStorage({ bucket: "synthetic-stage", client }), keyId: "synthetic-stage-key",
      privateKeyRef: defineSecretRef("SYNTHETIC_STAGE_KEY"), trustSet: { currentKeyId: "synthetic-stage-key", nextKeyId: null,
        revokedKeyIds: [], publicKeys: { "synthetic-stage-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } } };
    try {
      expect(await inspectStagedSnapshotServer(setup.principal, setup.lookup)).toBeNull();
      const receipt = await createSnapshotStagedBuildServer(bound)(setup.principal, setup.lookup);
      expect(send).toHaveBeenCalledTimes(14); expect(manifests).toBe(1);
      expect(receipt).toMatchObject({ ...setup.scope, buildInputId: setup.receipt.id, inputHash: setup.receipt.inputHash,
        publishSequence: setup.receipt.publishSequence, idempotencyKeyHash: setup.lookup.idempotencyKeyHash });
      await observer(setup.scope, async (tx) => {
        expect(await tx.snapshotArtifactStageReceipt.count()).toBe(1);
        expect(await tx.projectCurrentSnapshotManifest.count()).toBe(0); expect(await tx.deliveryRun.count()).toBe(0);
      });
      const pins = { organizationId: receipt.organizationId, projectId: receipt.projectId, buildInputId: receipt.buildInputId,
        inputHash: receipt.inputHash, idempotencyKeyHash: receipt.idempotencyKeyHash, requestHash: receipt.requestHash,
        publishSequence: receipt.publishSequence, manifestSha256: receipt.manifestSha256 };
      await expect(observer(setup.scope, (tx) => tx.snapshotArtifactStageReceipt.create({
        data: { ...pins, manifestSha256: "e".repeat(64) },
      }))).rejects.toThrow("SNAPSHOT_STAGE_RECEIPT_INVALID"); // Guard rejects before duplicate-key checks.
      await expect(observer(setup.scope, (tx) => tx.snapshotArtifactStageReceipt.create({
        data: pins,
      }), "snapshot-input")).rejects.toThrow("SNAPSHOT_STAGE_SCOPE_DENIED"); // Scope guard, not duplicate-key rejection.
      await expect(observer(setup.scope, (tx) => tx.$executeRaw`UPDATE "SnapshotArtifactStageReceipt"
        SET "manifestSha256" = ${"e".repeat(64)} WHERE "buildInputId" = ${receipt.buildInputId}`)).rejects.toThrow();
      const immutableAdmin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-stage-immutable", correlationId: randomUUID() };
      await expect(runInPrincipalDatabaseTransaction(immutableAdmin, (tx) => tx.$executeRaw`
        UPDATE "SnapshotArtifactStageReceipt" SET "manifestSha256" = ${"e".repeat(64)}
        WHERE "buildInputId" = ${receipt.buildInputId}`)).rejects.toThrow("SNAPSHOT_STAGE_RECEIPT_IMMUTABLE"); // Privileged rewrite is guarded too.
      vi.stubEnv("SYNTHETIC_STAGE_KEY", "");
      const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-stage-replay", correlationId: randomUUID() };
      await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } });
        await tx.project.update({ where: { id: setup.scope.projectId }, data: { serviceState: "SUSPENDED" } });
      });
      const replay = await createSnapshotStagedBuildServer({ ...bound, keyId: "synthetic-rotated-unavailable",
        trustSet: { ...bound.trustSet, revokedKeyIds: ["synthetic-stage-key"] } })(setup.principal, setup.lookup);
      expect(replay).toEqual(receipt); expect(send).toHaveBeenCalledTimes(14);
      await expect(inspectStagedSnapshotServer(createProjectJobPrincipal({ ...setup.scope, projectId: setup.foreignId,
        jobName: "snapshot-input" }), setup.lookup)).resolves.toBeNull();
      await observer(setup.scope, async (tx) => {
        expect(await tx.projectCurrentSnapshotManifest.count()).toBe(0); expect(await tx.deliveryRun.count()).toBe(0);
      });
    } finally { send.mockRestore(); client.destroy(); vi.unstubAllEnvs(); }
  });

  it.each(["manifest-failure", "cancel", "project-blocked", "freeze"])("does not record a staged BUILD after %s", async (mode) => {
    const setup = await fixture(); const keys = generateKeyPairSync("ed25519"); const controller = new AbortController();
    vi.stubEnv("SYNTHETIC_STAGE_KEY", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    let manifestStarted = false;
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      expect(cuts.active).toBe(0); expect(command).toBeInstanceOf(PutObjectCommand);
      if (command instanceof PutObjectCommand && command.input.ContentType === "application/json") {
        manifestStarted = true;
        if (mode === "manifest-failure") throw new Error("SYNTHETIC_STAGE_MANIFEST_FAILURE");
        if (mode === "cancel") controller.abort("Synthetic private cancellation reason");
        const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-stage-stale", correlationId: randomUUID() };
        if (mode === "project-blocked") await runInPrincipalDatabaseTransaction(admin, (tx) =>
          tx.project.update({ where: { id: setup.scope.projectId }, data: { serviceState: "SUSPENDED" } }));
        if (mode === "freeze") await runInPrincipalDatabaseTransaction(admin, (tx) =>
          tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } }));
      }
      return { ETag: "synthetic-stage" } as never;
    });
    try {
      await expect(createSnapshotStagedBuildServer({ ...setup.scope, storage: new S3ObjectStorage({ bucket: "synthetic-stage", client }),
        keyId: "synthetic-stage-key", privateKeyRef: defineSecretRef("SYNTHETIC_STAGE_KEY"),
        trustSet: { currentKeyId: "synthetic-stage-key", nextKeyId: null, revokedKeyIds: [],
          publicKeys: { "synthetic-stage-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } },
      })(setup.principal, setup.lookup, controller.signal)).rejects.toThrow();
      expect(manifestStarted).toBe(true); expect(send).toHaveBeenCalledTimes(14);
      await observer(setup.scope, async (tx) => {
        expect(await tx.snapshotPublicationBinding.count()).toBe(1); expect(await tx.snapshotArtifactStageReceipt.count()).toBe(0);
        expect(await tx.projectCurrentSnapshotManifest.count()).toBe(0); expect(await tx.deliveryRun.count()).toBe(0);
      });
      expect(await inspectStagedSnapshotServer(setup.principal, setup.lookup)).toBeNull();
    } finally { controller.abort(); send.mockRestore(); client.destroy(); vi.unstubAllEnvs(); }
  });
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
