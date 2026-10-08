import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createUlid } from "@ams-data-hub/data-contracts";
import { snapshotManifestV1Schema } from "@ams-data-hub/snapshot-verifier";
import { expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({ xml: "", webCorrelation: "" }));
vi.mock("../src/platform/http/safe-outbound.ts", async (original) => ({
  ...await original<typeof import("../src/platform/http/safe-outbound.ts")>(),
  safeOutboundStream: async () => {
    const bytes = new TextEncoder().encode(wire.xml);
    return { status: 200, contentType: "application/xml", contentLength: bytes.length,
      finalUrl: new URL("https://synthetic.example.test/restore.xml"),
      body: (async function* () { yield bytes; })(), close() {} };
  },
}));
vi.mock("../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../src/platform/database/transaction.ts")>();
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = (context, execute, options) =>
    actual.runInAuthorizedDatabaseTransaction(context, async (tx) => {
      // Fixture provision/fingerprints explicitly use the isolated owner;
      // actual business operations below use their intended runtime identities.
      if (["project-job", "system-job"].includes(context.principalKind) || context.correlationId === "synthetic-restore-control"
        || context.correlationId === wire.webCorrelation) {
        if (["project-job", "system-job"].includes(context.principalKind))
          await tx.$executeRaw`SET LOCAL ROLE ams_data_hub_worker`;
        else await tx.$executeRaw`SET LOCAL ROLE ams_data_hub_web`;
        expect(await tx.$queryRaw`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)
          .toEqual([{ rolsuper: false, rolbypassrls: false }]);
      }
      return execute(tx);
    }, options);
  return { ...actual, runInAuthorizedDatabaseTransaction: authorized,
    runInPrincipalDatabaseTransaction: (principal, execute) => authorized(actual.createDatabaseAuthorizationContext(principal), execute) } satisfies typeof actual;
});
import { readTestDatabaseTarget } from "./verify-test-database-env.mjs";
import { runInPrincipalDatabaseTransaction } from "../src/platform/database/transaction.ts";
import { closePrismaContext } from "../src/platform/database/prisma/client.ts";
import type { PlatformAdminPrincipal } from "../src/platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../src/platform/authorization/principal-factories.ts";
import { sourceRegistryCommands, createSourceExecutionServer } from "../src/modules/ingestion-core/server.ts";
import { projectUrlRegistryCommands } from "../src/modules/project-state/server.ts";
import { captureSnapshotInput, createSnapshotStagedBuildServer, createSnapshotPublicationServer } from "../src/modules/snapshot-delivery/server.ts";
import { freezeMutatingJobs, reconcileAfterRestore, unfreezeMutatingJobs } from "../src/modules/platform-operations/server.ts";
import { PrismaDataSafetyRepository } from "../src/modules/platform-operations/infrastructure/prisma-data-safety-repository.ts";
import { S3ObjectStorage } from "../src/platform/storage/timeweb-s3-object-storage.ts";
import { defineSecretRef } from "../src/platform/security/secret-ref.ts";
import { runRawArtifactRetentionCommand } from "../src/infrastructure/raw-artifact-retention-runtime.ts";
import { requestOperationalAction, createOperationalSnapshotRollbackExecutor } from "../src/modules/operations-control/server.ts";
import { OPERATIONAL_ACTION_TOPICS } from "../src/modules/operations-control/contracts.ts";
import { ReliabilityService } from "../src/modules/platform-operations/application/reliability-service.ts";
import { PrismaReliabilityRepository } from "../src/modules/platform-operations/infrastructure/prisma-reliability-repository.ts";
import type { Prisma } from "../src/generated/prisma/client.ts";

const phase = process.env.DATA_SAFETY_DRILL_PHASE;
const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });
const expected = phase === "prepare" ? "ams_data_hub_test" : "ams_data_hub_restore_test";
if (!["prepare", "restore"].includes(phase ?? "") || target.database !== expected || target.port !== 5435)
  throw new Error("DATA_SAFETY_DRILL_TARGET_DENIED");
const evidencePath = path.resolve(".local/evidence/data-safety-restored-state.json");
const baselinePath = path.resolve(".local/evidence/data-safety-source-state.json");
const fixture: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-restore-admin", correlationId: "synthetic-restore-fixture" };
const control: PlatformAdminPrincipal = { ...fixture, correlationId: "synthetic-restore-control" };
const business: PlatformAdminPrincipal = { ...fixture, correlationId: randomUUID() };
wire.webCorrelation = business.correlationId;
const zeroes = { uidConflicts: 0, publicUrlIdConflicts: 0, publishSequenceConflicts: 0 };
const tables = ["InventoryIdentity", "Source", "SourceRevision", "SourceRevisionRecord", "PublicUrlIdReservation", "ProjectUrlEntry",
  "ProjectSnapshotSequence", "SnapshotBuildInput", "SnapshotBuildInputPart", "SnapshotPublicationBinding", "SnapshotArtifactStageReceipt",
  "DeliveryRun", "ProjectCurrentSnapshotManifest", "DataSafetyState", "AuditEvent", "RawArtifactPutAttempt", "RawArtifactDeletion",
  "SnapshotRollbackReservation", "SnapshotRollbackBinding", "OperationalActionRequest", "OutboxEvent", "JobRun"] as const;
async function fingerprints() {
  return runInPrincipalDatabaseTransaction(fixture, async (tx) => {
    const result: Record<string, { rows: number; sha256: string }> = {};
    for (const table of tables) {
      // Closed server-owned table inventory; no caller identifier interpolation.
      const rows = await tx.$queryRawUnsafe<{ payload: unknown }[]>(`SELECT to_jsonb(r) AS payload FROM public."${table}" r ORDER BY to_jsonb(r)::text`);
      result[table] = { rows: rows.length, sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
    }
    return result;
  });
}
async function scope() {
  return runInPrincipalDatabaseTransaction(fixture, async (tx) => {
    const organization = await tx.organization.findUniqueOrThrow({ where: { slug: "synthetic-restore-proof" } });
    const project = await tx.project.findUniqueOrThrow({ where: { organizationId_slug: {
      organizationId: organization.id, slug: "synthetic-restore-proof",
    } } });
    return { organizationId: project.organizationId, projectId: project.id };
  });
}
async function recoveredLinks(own: { organizationId: string; projectId: string }) {
  return runInPrincipalDatabaseTransaction(fixture, async (tx) => {
    const identity = await tx.inventoryIdentity.findFirstOrThrow({ where: { ...own, status: "ACTIVE" } });
    const entry = await tx.projectUrlEntry.findFirstOrThrow({ where: own, include: { reservation: true } });
    expect(entry.entityUid).toBe(identity.uid);
    expect(entry.reservation).toMatchObject({ ...own, subjectType: "INVENTORY" });
    expect(entry.reservation.subjectUid).not.toBe(identity.uid);
    const put = await tx.rawArtifactPutAttempt.findFirstOrThrow({ where: { ...own, status: "STORED" } });
    const good = await tx.sourceRevision.findUniqueOrThrow({ where: { id: put.revisionId } });
    expect(good).toMatchObject({ status: "GOOD", rawArtifactHash: put.rawArtifactHash, rawStorageKey: put.storageKey, rawByteCount: put.byteCount });
    expect(put.storedAt!.getTime()).toBeGreaterThanOrEqual(put.createdAt.getTime());
    const deletion = await tx.rawArtifactDeletion.findFirstOrThrow({ where: { ...own, status: "DELETED" } });
    expect(deletion.rawArtifactHash).not.toBe(put.rawArtifactHash);
    const audit = await tx.auditEvent.findUniqueOrThrow({ where: { id: `raw-delete:${deletion.id}` } });
    expect(audit).toMatchObject({ organizationId: own.organizationId, action: "source.raw-artifact.deleted", entityId: deletion.id,
      afterMarker: { status: "DELETED", projectId: own.projectId, currentKeyRemoved: true } });
    const current = await tx.projectCurrentSnapshotManifest.findUniqueOrThrow({ where: { organizationId_projectId: own } });
    const run = await tx.deliveryRun.findUniqueOrThrow({ where: { organizationId_projectId_publishSequence: { ...own, publishSequence: current.publishSequence } } });
    const rollback = await tx.snapshotRollbackBinding.findFirstOrThrow({ where: { ...own, publishSequence: current.publishSequence } });
    const reservation = await tx.snapshotRollbackReservation.findUniqueOrThrow({ where: { requestId: rollback.requestId } });
    const request = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: rollback.requestId } });
    expect(request.status).toBe("SUCCEEDED"); expect(current.publishSequence).toBeGreaterThan(reservation.sourcePublishSequence);
    expect(run).toMatchObject({ manifestSha256: current.manifestSha256, manifestKey: current.manifestKey, publishedAt: current.publishedAt });
    expect(rollback).toMatchObject({ manifestSha256: current.manifestSha256, publishSequence: reservation.publishSequence });
    return { uid: identity.uid, publicUrlId: entry.reservation.publicUrlId, originalSubjectUid: entry.reservation.subjectUid,
      putRevisionId: put.revisionId, deletionId: deletion.id, rollbackRequestId: rollback.requestId,
      sourcePublishSequence: reservation.sourcePublishSequence, currentPublishSequence: current.publishSequence, deliveryRunId: run.id };
  });
}
it(`actual isolated ${phase} cut with nonempty GOOD/UID/URL/signed-publication state`, async () => {
  try {
    await runInPrincipalDatabaseTransaction(fixture, async (tx) => {
      expect(await tx.$queryRaw`SELECT current_database() AS database,(current_setting('server_version_num')::int/10000) AS major`)
        .toEqual([{ database: expected, major: 18 }]);
    });
    if (phase === "prepare") {
      const own = await runInPrincipalDatabaseTransaction(fixture, async (tx) => {
        const org = await tx.organization.create({ data: { name: "Synthetic restore", slug: "synthetic-restore-proof" } });
        const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic restore", slug: "synthetic-restore-proof" } });
        const own = { organizationId: org.id, projectId: project.id };
        await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
          update: { jobsFrozen: false, unfrozenAt: new Date() } });
        await tx.projectCatalogSubscription.create({ data: { ...own, mode: "CURATED", cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
        await tx.projectPublicContact.create({ data: { ...own, phone: "+70000000077", messengers: [] } });
        return own;
      });
      vi.stubEnv("SYNTHETIC_RESTORE_FEED", "https://synthetic.example.test/restore.xml");
      const source = await sourceRegistryCommands.createSource(business, { ...own, sourceKey: "synthetic-restore", name: "Synthetic restore",
        endpointCredentialRef: "SYNTHETIC_RESTORE_FEED", adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "joywork-domclick-v1", profileVersion: "1.0.0",
        datasetType: "MIXED_REALTY", transportType: "HTTPS_XML", sharingPolicy: "PROJECT_ONLY", schedulePolicy: { mode: "MANUAL_ONLY" },
        safetyPolicyId: "", expectedNamespace: "", expectedProducer: "" });
      await sourceRegistryCommands.setSourceEnabled(business, { ...own, sourceId: source.sourceId, version: source.version, enabled: true });
      wire.xml = '<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06"><offer internal-id="synthetic-one"><category>квартира</category><type>продажа</type><price><value>1000</value><currency>RUB</currency></price><location><address>Синтетический город</address></location></offer></realty-feed>';
      const objects = new Map<string, Uint8Array>();
      const legacyBytes = Buffer.from("Synthetic old legacy raw restore fixture");
      const legacyHash = createHash("sha256").update(legacyBytes).digest("hex");
      const legacyKey = `source-artifacts/${legacyHash}`;
      objects.set(legacyKey, legacyBytes);
      const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
        if (command instanceof DeleteObjectCommand) {
          expect(command.input.Bucket).toBe("synthetic-restore"); expect(command.input.Key).toBe(legacyKey);
          objects.delete(legacyKey); return { $metadata: { httpStatusCode: 204, attempts: 1 } } as never;
        }
        if (command instanceof PutObjectCommand) {
          const body = command.input.Body;
          if (body instanceof Uint8Array) objects.set(command.input.Key!, Uint8Array.from(body));
          else { const parts: Uint8Array[] = []; for await (const part of body as AsyncIterable<Uint8Array>) parts.push(part); objects.set(command.input.Key!, Buffer.concat(parts)); }
          return {} as never;
        }
        const key = (command instanceof GetObjectCommand || command instanceof HeadObjectCommand) ? command.input.Key! : "";
        const bytes = objects.get(key); if (!bytes) throw new Error("SYNTHETIC_RESTORE_OBJECT_MISSING");
        if (command instanceof HeadObjectCommand) return { ContentLength: bytes.length } as never;
        return { ContentLength: bytes.length, ContentType: "application/octet-stream", LastModified: new Date(0),
          Body: { destroy() {}, async *[Symbol.asyncIterator]() { yield bytes; } } } as never;
      });
      const client = new S3Client({ region: "synthetic", credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" } });
      try {
        const storage = new S3ObjectStorage({ client, bucket: "synthetic-restore" });
        expect(await createSourceExecutionServer(storage).run({ ...own, sourceId: source.sourceId })).toMatchObject({ state: "GOOD", sequence: 1 });
        const identity = await runInPrincipalDatabaseTransaction(fixture, (tx) => tx.inventoryIdentity.findFirstOrThrow({ where: own }));
        await projectUrlRegistryCommands.replaceProjectUrlPolicy(business, { ...own, version: 0, policyKey: "synthetic-restore-v1",
          pathTemplates: [{ entityType: "INVENTORY", template: "/inventory/{slug}" }], reservedNamespaces: ["api", "admin"] });
        const originalUid = createUlid();
        const entry = await projectUrlRegistryCommands.createProjectUrlEntry(business, { ...own, entityType: "INVENTORY", entityUid: originalUid,
          slug: "synthetic-one", canonicalPath: "/inventory/synthetic-one" });
        const relinked = await projectUrlRegistryCommands.relinkProjectUrlEntry(business, { ...own,
          urlEntryId: entry.urlEntryId, version: entry.version, entityType: "INVENTORY", entityUid: identity.uid });
        expect(relinked.publicUrlId).toBe(entry.publicUrlId);
        await projectUrlRegistryCommands.publishProjectUrlEntry(business, { ...own, urlEntryId: entry.urlEntryId, version: relinked.version });
        const principal = createProjectJobPrincipal({ ...own, jobName: "snapshot-input" });
        const input = await captureSnapshotInput(principal, { ...own, idempotencyKey: randomUUID(), schemaMinor: 1 });
        const keys = generateKeyPairSync("ed25519"); vi.stubEnv("SYNTHETIC_RESTORE_SIGNING", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
        const bound = { ...own, storage, keyId: "synthetic-restore", privateKeyRef: defineSecretRef("SYNTHETIC_RESTORE_SIGNING"),
          trustSet: { currentKeyId: "synthetic-restore", nextKeyId: null, revokedKeyIds: [], publicKeys: { "synthetic-restore": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } } };
        const lookup = { idempotencyKeyHash: input.idempotencyKeyHash, requestHash: input.requestHash };
        await createSnapshotStagedBuildServer(bound)(principal, lookup);
        await createSnapshotPublicationServer(bound)(principal, lookup);
        const accepted = await requestOperationalAction(business, { ...own, action: "SNAPSHOT_ROLLBACK",
          sourcePublishSequence: input.publishSequence, sourceId: "", sourceRevisionId: "", reason: "", idempotencyKey: randomUUID() });
        const eventId = await runInPrincipalDatabaseTransaction(fixture, async (tx) =>
          (await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } })).outboxEventId);
        const reliability = new ReliabilityService(new PrismaReliabilityRepository());
        const lease = await reliability.claim(`synthetic-restore-${randomUUID()}`, 300_000, [OPERATIONAL_ACTION_TOPICS.SNAPSHOT_ROLLBACK]);
        if (!lease || lease.outboxEventId !== eventId) throw new Error("SYNTHETIC_RESTORE_LEASE_MISSING");
        const rolledBack = await createOperationalSnapshotRollbackExecutor({ resolveRollback: () => ({ ...own, storage,
          getTrust: () => bound.trustSet, getSigning: () => ({ keyId: bound.keyId, privateKeyRef: bound.privateKeyRef }) }) })(lease);
        expect(rolledBack).toMatchObject({ action: "SNAPSHOT_ROLLBACK", sourcePublishSequence: input.publishSequence,
          publishSequence: input.publishSequence + 1 });
        await reliability.complete(lease);
        const bindings = await runInPrincipalDatabaseTransaction(fixture, async (tx) => ({
          source: await tx.snapshotPublicationBinding.findFirstOrThrow({ where: own }),
          rollback: await tx.snapshotRollbackBinding.findFirstOrThrow({ where: own }),
          request: await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } }),
        }));
        const originalFiles = snapshotManifestV1Schema.parse(JSON.parse(bindings.source.manifestCanonical)).files;
        expect(originalFiles).toHaveLength(13);
        expect(snapshotManifestV1Schema.parse(JSON.parse(bindings.rollback.manifestCanonical)).files).toEqual(originalFiles);
        expect(bindings.request.status).toBe("SUCCEEDED");
        // Explicit legacy setup; successful PUT journal comes only from actual
        // Source execution above, successful deletion only from actual command.
        await runInPrincipalDatabaseTransaction(fixture, async (tx) => {
          const good = await tx.sourceRevision.findFirstOrThrow({ where: { ...own, sourceId: source.sourceId, status: "GOOD" } });
          const old = await tx.sourceRevision.create({ data: { ...own, sourceId: source.sourceId, sourceVersion: good.sourceVersion,
            adapterKey: good.adapterKey, adapterVersion: good.adapterVersion, profileKey: good.profileKey, profileVersion: good.profileVersion,
            safetyPolicy: good.safetyPolicy as Prisma.InputJsonObject, startedAt: new Date("2001-01-01T00:00:00Z") } });
          await tx.sourceRevision.update({ where: { id: old.id }, data: { status: "FAILED", completedAt: old.startedAt,
            rawArtifactHash: legacyHash, rawStorageKey: legacyKey, rawByteCount: legacyBytes.byteLength } });
        });
        vi.stubEnv("PROJECT_STORAGE_BINDINGS", JSON.stringify([{ ...own, bucketRef: "SYNTHETIC_RESTORE_BUCKET",
          endpointRef: "SYNTHETIC_RESTORE_ENDPOINT", regionRef: "SYNTHETIC_RESTORE_REGION",
          accessKeyIdRef: "SYNTHETIC_RESTORE_ACCESS", secretAccessKeyRef: "SYNTHETIC_RESTORE_SECRET" }]));
        vi.stubEnv("SYNTHETIC_RESTORE_BUCKET", "synthetic-restore"); vi.stubEnv("SYNTHETIC_RESTORE_ENDPOINT", "https://synthetic.invalid");
        vi.stubEnv("SYNTHETIC_RESTORE_REGION", "ru-1"); vi.stubEnv("SYNTHETIC_RESTORE_ACCESS", "synthetic-restore");
        vi.stubEnv("SYNTHETIC_RESTORE_SECRET", "synthetic-restore");
        expect(await runRawArtifactRetentionCommand([own.organizationId, own.projectId], new AbortController().signal))
          .toMatchObject({ deleted: 1, unknown: 0 }); expect(objects.has(legacyKey)).toBe(false);
      } finally { send.mockRestore(); client.destroy(); }
      await freezeMutatingJobs(control, { reason: "Synthetic nonempty restore proof" });
      const before = await fingerprints();
      for (const table of tables) expect(before[table].rows).toBeGreaterThan(0);
      await writeFile(baselinePath, JSON.stringify({ fingerprints: before, links: await recoveredLinks(own) }), "utf8");
    } else {
      const before = JSON.parse(await readFile(baselinePath, "utf8"));
      expect(await fingerprints()).toEqual(before.fingerprints);
      const own = await scope();
      expect(await recoveredLinks(own)).toEqual(before.links);
      const state = await runInPrincipalDatabaseTransaction(control, (tx) => new PrismaDataSafetyRepository(tx).read());
      expect(state).toMatchObject({ jobsFrozen: true, frozenAt: expect.any(Date), reconciledAt: null });
      await expect(unfreezeMutatingJobs(control, {})).rejects.toThrow("DATA_SAFETY_RECONCILE_REQUIRED");
      const report = await runInPrincipalDatabaseTransaction(control, async (tx) => {
        await new PrismaDataSafetyRepository(tx).lockControl();
        return new PrismaDataSafetyRepository(tx).inspectConsistency();
      });
      expect(report).toEqual(zeroes);
      expect(await reconcileAfterRestore(control, zeroes)).toMatchObject({ jobsFrozen: true, reconciledAt: expect.any(Date) });
      const run = await runInPrincipalDatabaseTransaction(fixture, async (tx) => {
        const current = await tx.projectCurrentSnapshotManifest.findUniqueOrThrow({ where: { organizationId_projectId: own } });
        return tx.deliveryRun.findUniqueOrThrow({ where: { organizationId_projectId_publishSequence: { ...own, publishSequence: current.publishSequence } } });
      });
      const auditCount = () => runInPrincipalDatabaseTransaction(fixture, (tx) => tx.auditEvent.count({ where: { correlationId: control.correlationId } }));
      const auditBefore = await auditCount();
      await runInPrincipalDatabaseTransaction(fixture, (tx) => tx.deliveryRun.update({ where: { id: run.id }, data: { publishedAt: new Date(run.publishedAt.getTime() + 1) } }));
      await expect(unfreezeMutatingJobs(control, {})).rejects.toThrow("DATA_SAFETY_RECONCILE_FAILED");
      await expect(reconcileAfterRestore(control, zeroes)).rejects.toThrow("DATA_SAFETY_RECONCILE_FAILED");
      expect(await auditCount()).toBe(auditBefore);
      await runInPrincipalDatabaseTransaction(fixture, (tx) => tx.deliveryRun.update({ where: { id: run.id }, data: { publishedAt: run.publishedAt } }));
      expect(await unfreezeMutatingJobs(control, {})).toMatchObject({ jobsFrozen: false });
      await writeFile(evidencePath, JSON.stringify({ fingerprintsEqual: true, nonemptyTables: tables.length,
        jobsFrozenAfterRestore: true, actualNobypassCommands: true, reconcile: report, staleMarkerDenied: true,
        noFalseSuccessAudit: true, unfreezeAfterReconcile: true, rawJournalsRestored: true, publicUrlRelinkPreserved: true,
        rollbackCurrentLinkagePreserved: true, productionTouched: false }), "utf8");
    }
  } finally { vi.unstubAllEnvs(); await closePrismaContext(); }
});
