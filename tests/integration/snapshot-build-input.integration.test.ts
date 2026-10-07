import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createSnapshotVerifier } from "@ams-data-hub/snapshot-verifier";
import { z } from "zod";
import { canonicalJson, createUlid, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../../src/generated/prisma/client.ts";
import { captureSnapshotInput, createSnapshotCandidateAssemblyServer, createSnapshotSignedBuildServer, createSnapshotMediaProjectionServer, PrismaSnapshotInputRepository, runInSnapshotInputTransaction } from "../../src/modules/snapshot-delivery/server.ts";
import { defineSecretRef } from "../../src/platform/security/secret-ref.ts";
import {
  SNAPSHOT_INPUT_PART_KINDS, SnapshotInputPartsBuilder, snapshotInputHash,
  snapshotInputRequestHashes, snapshotInputRequestSchema,
  projectSnapshotCatalog,
  projectSnapshotProjectState,
  projectSnapshotInventory,
  composeSnapshot, SNAPSHOT_DATASET_KINDS,
  type SnapshotInventoryProjectionInput,
  validateSnapshotInput,
} from "../../src/modules/snapshot-delivery/index.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction,
  type DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { createCatalogSnapshotFactReader } from "../../src/modules/shared-catalog/server.ts";
import { createSourceSnapshotFactReader, createSnapshotGoodFactResolver, createSnapshotPublicationSourceReader, normalizedContentHash,
  type SnapshotGoodFactPin } from "../../src/modules/ingestion-core/server.ts";
import { createProjectStateSnapshotFactReader, createSnapshotPublicationProjectReader } from "../../src/modules/project-state/server.ts";
import { prepareSnapshotPublicationProjectAnchors } from "../../src/modules/project-state/index.ts";
import { snapshotRequiresProjectContact } from "../../src/modules/snapshot-delivery/application/snapshot-project-contact.ts";
import * as transactionRuntime from "../../src/platform/database/transaction.ts";
import { getPrismaPool } from "../../src/platform/database/prisma/client.ts";
import { createMediaSnapshotFactReader } from "../../src/modules/media-assets/server.ts";
import { createMediaKey } from "../../src/platform/storage/object-storage.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import * as mediaFacade from "../../src/modules/media-assets/server.ts";
import * as sourceFacade from "../../src/modules/ingestion-core/server.ts";
import * as projectStateFacade from "../../src/modules/project-state/server.ts";
import { analyzeImportSafety, BOOTSTRAP_SOURCE_SAFETY_POLICY, prepareSnapshotPublicationSourceAnchors } from "../../src/modules/ingestion-core/index.ts";
import { lockSnapshotPublication } from "../../src/modules/snapshot-delivery/infrastructure/snapshot-publication-lock.ts";

// Explicit fixture policy permits the deliberate large historical/head count
// changes used below; production policy/approval predicates are unchanged.
function syntheticSafety(recordCount: number, previousGoodRecordCount: number | null = null) {
  const policy = { ...BOOTSTRAP_SOURCE_SAFETY_POLICY, maxDropPercent: 100, requireManualApprovalAboveDrop: false };
  return { safetyPolicy: policy, safetyAnalysis: JSON.parse(JSON.stringify(analyzeImportSafety({
    recordCount, previousGoodRecordCount, invalidRecordCount: 0, issues: [],
  }, policy))) as Prisma.InputJsonObject };
}

const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-input-admin", correlationId: "synthetic-input" };
async function setup() {
  const suffix = randomUUID().slice(0, 8);
  return runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const organization = await tx.organization.create({ data: { name: "Synthetic snapshot capture", slug: `input-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: organization.id, name: "Synthetic input", slug: `input-${suffix}` } });
    const foreignProject = await tx.project.create({ data: { organizationId: organization.id, name: "Foreign input", slug: `input-b-${suffix}` } });
    await tx.dataSafetyState.upsert({ where: { id: "global" },
      create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() }, update: { jobsFrozen: false, unfrozenAt: new Date() } });
    return { organizationId: organization.id, projectId: project.id, foreignProjectId: foreignProject.id };
  });
}
function worker<T>(scope: { organizationId: string; projectId: string }, execute: (tx: DatabaseTransaction) => Promise<T>) {
  return runInAuthorizedDatabaseTransaction({ principalKind: "project-job", actorId: "snapshot-input",
    organizationId: scope.organizationId, projectIds: [scope.projectId], correlationId: randomUUID() }, async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
    const roles = await tx.$queryRawUnsafe<{ rolbypassrls: boolean; rolsuper: boolean }[]>(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user");
    expect(roles).toEqual([{ rolbypassrls: false, rolsuper: false }]);
    return execute(tx);
  }, { isolationLevel: "RepeatableRead", timeout: 30_000 });
}
async function captureWithWorkerRole(scope: { organizationId: string; projectId: string }, idempotencyKey: string, profile = false) {
  const metrics = new Map<string, { calls: number; elapsedMs: number }>();
  async function measure<T>(label: string, execute: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try { return await execute(); } finally {
      const previous = metrics.get(label) ?? { calls: 0, elapsedMs: 0 };
      metrics.set(label, { calls: previous.calls + 1, elapsedMs: previous.elapsedMs + performance.now() - start });
    }
  }
  const originalMedia = mediaFacade.createMediaSnapshotFactReader;
  const mediaTrace = profile ? vi.spyOn(mediaFacade, "createMediaSnapshotFactReader").mockImplementation((...args) => {
    const reader = originalMedia(...args);
    return { ...reader, captureInventoryPage: (...values) => measure("inventory-media", () => reader.captureInventoryPage(...values)),
      captureAgents: (...values) => measure("agent-media", () => reader.captureAgents(...values)),
      captureShared: (...values) => measure("shared-media", () => reader.captureShared(...values)) };
  }) : null;
  const originalSource = sourceFacade.createSourceSnapshotFactReader;
  const originalProjectState = projectStateFacade.createProjectStateSnapshotFactReader;
  const projectStateTrace = profile ? vi.spyOn(projectStateFacade, "createProjectStateSnapshotFactReader").mockImplementation((...args) => {
    const reader = originalProjectState(...args);
    return { capture: (...values) => measure("project-state", () => reader.capture(...values)) };
  }) : null;
  const sourceTrace = profile ? vi.spyOn(sourceFacade, "createSourceSnapshotFactReader").mockImplementation((...args) => {
    const reader = originalSource(...args);
    return { capture: (...values) => measure("source-with-media", () => reader.capture(...values)) };
  }) : null;
  const originalSave = PrismaSnapshotInputRepository.prototype.save;
  const saveTrace = profile ? vi.spyOn(PrismaSnapshotInputRepository.prototype, "save").mockImplementation(
    function (this: PrismaSnapshotInputRepository, value) { return measure("save", () => originalSave.call(this, value)); }) : null;
  const original = transactionRuntime.runInAuthorizedDatabaseTransaction;
  const role = vi.spyOn(transactionRuntime, "runInAuthorizedDatabaseTransaction").mockImplementation(
    async (context, execute, options) => {
      const invoke = () => original(context, async (tx) => {
      if (context.actorId === "snapshot-input") {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]);
      }
      return execute(tx);
      }, options);
      return profile ? measure(options?.isolationLevel === "RepeatableRead" ? "outer-transaction" : "admission", invoke) : invoke();
    });
  try { return await captureSnapshotInput(createProjectJobPrincipal({ ...scope, jobName: "snapshot-input" }),
    { ...scope, idempotencyKey, schemaMinor: 0 }); }
  finally {
    role.mockRestore(); mediaTrace?.mockRestore(); sourceTrace?.mockRestore(); projectStateTrace?.mockRestore(); saveTrace?.mockRestore();
    if (profile) process.stdout.write(`snapshot_capture_phases=${JSON.stringify([...metrics].map(([phase, value]) => ({
      phase, calls: value.calls, elapsedMs: Math.round(value.elapsedMs),
    })))}\n`);
  }
}
function parts() {
  const builder = new SnapshotInputPartsBuilder();
  for (const kind of SNAPSHOT_INPUT_PART_KINDS) builder.add(kind, kind === "catalog" ? [{ uid: "synthetic", version: 1 }] : []);
  return builder.finish();
}

describe("snapshot input persistence foundation with NOBYPASS PostgreSQL worker", () => {
  it.each(["forged", "oversized"])("rejects a GOOD label with %s immutable safety analysis before saving a receipt", async (mode) => {
    const scope = await setup();
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      await tx.projectCatalogSubscription.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        mode: "CURATED", cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
      const source = await tx.source.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        sourceKey: "synthetic-forged-approval", name: "Synthetic approval", adapterKey: "yrl-realty-2010",
        adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
        datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" } } });
      const target = { organizationId: scope.organizationId, projectId: scope.projectId, sourceId: source.id };
      const safety = syntheticSafety(1);
      const revision = await tx.sourceRevision.create({ data: { ...target, sourceVersion: source.version,
        adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey,
        profileVersion: source.profileVersion, ...safety, recordCount: 1,
        safetyAnalysis: mode === "oversized" ? { ...safety.safetyAnalysis, review: { reason: "x".repeat(8192) } }
          : { ...safety.safetyAnalysis, disposition: "REJECTED" } } });
      await tx.sourceRevisionRecord.create({ data: { ...target, revisionId: revision.id,
        externalId: "synthetic-approval", orderKey: "73796e746865746963", inventoryUid: createUlid(),
        recordHash: "b".repeat(64), payload: { schemaVersion: 1, draft: { externalId: "synthetic-approval" }, fields: {} } } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence: 1,
        rawStorageKey: "private-synthetic/forged-approval", rawArtifactHash: "a".repeat(64), rawByteCount: 1,
        normalizedContentHash: "b".repeat(64), completedAt: new Date() } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
      await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: revision.id } });
    });
    await expect(captureWithWorkerRole({ organizationId: scope.organizationId, projectId: scope.projectId }, "synthetic-forged-approval"))
      .rejects.toThrow("SNAPSHOT_INPUT_SOURCE_APPROVAL_INVALID");
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      expect(await tx.snapshotBuildInput.count({ where: { organizationId: scope.organizationId, projectId: scope.projectId } })).toBe(0);
    });
  });
  it("runs the complete command and replays its immutable input after live facts change", async () => {
    const scope = await setup();
    const developerUid = createUlid(); const developmentUid = createUlid(); const agentUid = createUlid();
    const fixture = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      await tx.projectCatalogSubscription.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        mode: "ALL_SHARED", cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
      await tx.developer.create({ data: { uid: developerUid, name: "D".repeat(200), normalizedName: "d".repeat(200),
        aliases: { create: { value: "A".repeat(200), normalizedValue: "a".repeat(200) } } } });
      await tx.development.create({ data: { uid: developmentUid, developerUid, cityUid: "01M41T6Q04BADHXSERJHZFXKCH",
        name: "N".repeat(200), normalizedName: "n".repeat(200), latitude: "55.1234567", longitude: "37.1234567",
        aliases: { create: { value: "B".repeat(200), normalizedValue: "b".repeat(200) } } } });
      await tx.projectPublicContact.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId, phone: "+70000000001", messengers: [] } });
      const asset = await tx.mediaAsset.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        sha256: "a".repeat(64), storageKey: createMediaKey("a".repeat(64)), byteSize: 100, contentType: "image/jpeg",
        originalFileName: "synthetic-private-filename", rightsBasis: "OWNED", source: "synthetic-private-source", uploadedBy: "synthetic" } });
      await tx.agent.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId, uid: agentUid,
        slug: "synthetic-capture-agent", fullName: "Synthetic consented agent", showOnSite: true,
        consentConfirmedAt: new Date(), consentConfirmedBy: "synthetic-private-actor", consentBasis: "synthetic-private-basis", photoMediaId: asset.id } });
      const source = await tx.source.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        sourceKey: "synthetic-command", name: "Synthetic command", adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0",
        profileKey: "vladis-vt24-v1", profileVersion: "1.0.0", datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" } } });
      const where = { organizationId: scope.organizationId, projectId: scope.projectId, sourceId: source.id };
      const inventoryUid = createUlid(); const image = "https://private.example.invalid/captured.jpg";
      const draft = { externalId: "captured", sourceFormat: "YRL_2010", propertyType: "APARTMENT", transactionType: "SALE",
        title: "Synthetic public inventory", address: "Synthetic City, house 9", areaM2: 60, currency: "RUB", price: 12345,
        imageUrls: [image, image], contactPhones: ["synthetic-private-phone"], provenance: {} };
      const fields = { text: "", attributes: {}, children: { "|rooms": [{ text: "2", attributes: {}, children: {} }] } };
      const recordHash = normalizedContentHash({ draft: { ...draft, provenance: undefined }, fields });
      const revision = await tx.sourceRevision.create({ data: { ...where, sourceVersion: source.version,
        adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey,
        profileVersion: source.profileVersion, ...syntheticSafety(1), recordCount: 1 } });
      await tx.sourceRevisionRecord.create({ data: { ...where, revisionId: revision.id, externalId: "captured",
        inventoryUid, recordHash, orderKey: "6361707475726564",
        payload: { schemaVersion: 1, draft, fields, rawRecord: { private: true } } } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence: 1,
        rawStorageKey: "synthetic-private-raw", rawArtifactHash: "c".repeat(64), rawByteCount: 1,
        normalizedContentHash: recordHash, completedAt: new Date() } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
      await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: revision.id } });
      await tx.inventoryIdentity.create({ data: { ...where, uid: inventoryUid, externalOfferId: "captured", normalizedHash: recordHash,
        sourceHash: "c".repeat(64), status: "ACTIVE", firstSeenAt: new Date(), lastSeenAt: new Date() } });
      await tx.mediaSource.create({ data: { ...where, sourceRevisionId: revision.id, entityType: "INVENTORY", entityUid: inventoryUid,
        kind: "LISTING_IMAGE", position: 999, sourceUrl: image, canonicalSourceUrl: image, status: "MIRRORED", assetId: asset.id,
        firstSeenAt: new Date(), lastAttemptAt: new Date(), mirroredAt: new Date() } });
      const sharedImage = "https://private.example.invalid/shared.jpg";
      await tx.sharedMediaAsset.create({ data: { ...where, developmentUid, kind: "DEVELOPMENT_IMAGE", position: 0,
        externalId: "synthetic-shared", sourceUrl: sharedImage, canonicalSourceUrl: sharedImage, rightsBasis: "OWNED", observedAt: new Date() } });
      await tx.mediaSource.create({ data: { ...where, sourceRevisionId: revision.id, entityType: "DEVELOPMENT", entityUid: developmentUid,
        kind: "DEVELOPMENT_IMAGE", position: 0, sourceUrl: sharedImage, canonicalSourceUrl: sharedImage, status: "MIRRORED", assetId: asset.id,
        firstSeenAt: new Date(), lastAttemptAt: new Date(), mirroredAt: new Date() } });
      await tx.priceObservation.create({ data: { ...where, developmentUid, externalId: "synthetic-price", observedAt: new Date(), amount: "12345.67", currency: "RUB", basis: "TOTAL" } });
      const projectScope = { organizationId: scope.organizationId, projectId: scope.projectId };
      const inventoryReservation = await tx.publicUrlIdReservation.create({ data: { ...projectScope,
        subjectType: "INVENTORY", subjectUid: inventoryUid, publicUrlId: "2345678901234567" } });
      await tx.projectUrlEntry.create({ data: { ...projectScope, entityType: "INVENTORY", entityUid: inventoryUid,
        reservationId: inventoryReservation.id, slug: "synthetic-captured", canonicalPath: "/inventory/synthetic-captured" } });
      const reservation = await tx.publicUrlIdReservation.create({ data: { ...projectScope,
        subjectType: "AGENT", subjectUid: agentUid, publicUrlId: "1234567890123456" } });
      const entry = await tx.projectUrlEntry.create({ data: { ...projectScope, entityType: "AGENT", entityUid: agentUid,
        reservationId: reservation.id, slug: "synthetic-capture-agent", canonicalPath: "/agents/synthetic-capture-agent",
        publishedAt: new Date() } });
      await tx.projectRedirect.create({ data: { ...projectScope, urlEntryId: entry.id, fromPath: "/agents/old",
        toPath: "/agents/synthetic-capture-agent", code: 301, reason: "SLUG_CHANGE" } });
      await tx.projectUrlTombstone.create({ data: { ...projectScope, reservationId: reservation.id,
        entityType: "AGENT", entityUid: agentUid, canonicalPath: "/agents/retired", reason: "RETIRE" } });
      await tx.entityEditorial.create({ data: { ...projectScope, entityType: "AGENT", entityUid: agentUid,
        shortDescription: "Synthetic public editorial", description: "Captured public copy", faq: [],
        presentationNotes: "synthetic-private-notes", mediaOrder: [] } });
      await tx.entityMediaOrderPolicy.create({ data: { ...projectScope, entityType: "AGENT", entityUid: agentUid,
        sourceMediaOrder: [], isImageOrderChangeAllowed: false } });
      await tx.inventoryLifecycleEvent.createMany({ data: [
        { ...projectScope, inventoryUid, type: "INACTIVATED", occurredAt: new Date("2026-01-01T00:00:00.000Z") },
        { ...projectScope, inventoryUid, type: "REACTIVATED", occurredAt: new Date("2026-02-01T00:00:00.000Z") },
      ] });
      return { assetId: asset.id, inventoryUid, sourceId: source.id, revisionId: revision.id };
    });
    const original = transactionRuntime.runInAuthorizedDatabaseTransaction;
    let workerTransactions = 0;
    let transactionOpen = false;
    const role = vi.spyOn(transactionRuntime, "runInAuthorizedDatabaseTransaction").mockImplementation(
      async (context, execute, options) => original(context, async (tx) => {
        if (context.actorId === "snapshot-input") {
          await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
          expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
            .toEqual([{ rolbypassrls: false, rolsuper: false }]);
          workerTransactions++;
        }
        transactionOpen = true;
        try { return await execute(tx); } finally { transactionOpen = false; }
      }, options));
    const principal = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input" });
    const request = { organizationId: scope.organizationId, projectId: scope.projectId, idempotencyKey: "synthetic-complete", schemaMinor: 0 };
    try {
      const first = await captureSnapshotInput(principal, request);
      const pinned = structuredClone(first);
      const publicCatalog = projectSnapshotCatalog(first);
      const publicProjectState = projectSnapshotProjectState(first);
      const head = vi.fn(async (key: string) => {
        expect(transactionOpen).toBe(false);
        return { key, sha256: "a".repeat(64), contentType: "image/jpeg", contentLength: 100, etag: null, lastModifiedAt: new Date(0) };
      });
      const projectMedia = createSnapshotMediaProjectionServer({ organizationId: scope.organizationId, projectId: scope.projectId, storage: { head } });
      const publicMedia = await projectMedia(first);
      expect(head).toHaveBeenCalledOnce();
      const assemble = createSnapshotCandidateAssemblyServer({ organizationId: scope.organizationId, projectId: scope.projectId, storage: { head } });
      const lookup = { idempotencyKeyHash: first.idempotencyKeyHash, requestHash: first.requestHash };
      const assembled = await assemble(principal, lookup);
      expect(assembled.datasets).toHaveLength(13);
      expect(new Set(assembled.datasets.map((dataset) => dataset.kind))).toEqual(new Set(SNAPSHOT_DATASET_KINDS));
      expect(assembled.datasets.find((dataset) => dataset.kind === "inventory")!.records[0]!.value).toMatchObject({
        uid: fixture.inventoryUid, facts: { rooms: { state: "VALUE", value: 2 } },
        media: [{ ref: "a".repeat(64), kind: "IMAGE", position: 0 }, { ref: "a".repeat(64), kind: "IMAGE", position: 1 }] });
      const compose = (datasets: typeof assembled.datasets) => composeSnapshot({ schemaMinor: first.schemaMinor,
        projectId: first.projectId, publishSequence: first.publishSequence, generatedAt: first.capturedAt.toISOString(),
        publishedAt: first.capturedAt.toISOString(), catalogRevision: first.catalogRevision,
        sourceRevisions: [...new Set(first.parts.filter((part) => part.kind === "inventory").flatMap((part) => part.payload)
          .flatMap((row) => row && typeof row === "object" && !Array.isArray(row) && typeof row.factRevisionId === "string" ? [row.factRevisionId] : []))],
        keyId: "synthetic-unsigned-key", requiresProjectContact: assembled.requiresProjectContact, datasets });
      const composition = compose(assembled.datasets);
      expect(composition.files.map((file) => file.manifest.kind)).toEqual(SNAPSHOT_DATASET_KINDS);
      const keys = generateKeyPairSync("ed25519");
      const trustSet = { currentKeyId: "synthetic-complete-signing-key", nextKeyId: null, revokedKeyIds: [],
        publicKeys: { "synthetic-complete-signing-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } };
      const signedBuild = createSnapshotSignedBuildServer({ organizationId: scope.organizationId, projectId: scope.projectId,
        storage: { head }, keyId: trustSet.currentKeyId, privateKeyRef: defineSecretRef("SYNTHETIC_COMPLETE_SIGNING_KEY"), trustSet });
      async function buildSigned() {
        const previous = process.env.SYNTHETIC_COMPLETE_SIGNING_KEY;
        process.env.SYNTHETIC_COMPLETE_SIGNING_KEY = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
        try { return await signedBuild(principal, lookup); }
        finally {
          if (previous === undefined) delete process.env.SYNTHETIC_COMPLETE_SIGNING_KEY;
          else process.env.SYNTHETIC_COMPLETE_SIGNING_KEY = previous;
        }
      }
      const signed = await buildSigned();
      expect(signed.manifest.sourceRevisions).toEqual([fixture.revisionId]);
      expect(signed.receiptId).toBe(first.id); expect(signed.inputHash).toBe(first.inputHash);
      const expectedValues = Object.fromEntries(assembled.datasets.map((dataset) => [dataset.kind,
        [...dataset.records].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map((record) => record.value)]));
      const jsonArray = z.array(z.json());
      const portable = createSnapshotVerifier({
        datasetSchemas: { geo: jsonArray, developers: jsonArray, developments: jsonArray, buildings: jsonArray,
          prices: jsonArray, media: jsonArray, inventory: jsonArray, agents: jsonArray, "project/contacts": jsonArray,
          editorial: jsonArray, urls: jsonArray, redirects: jsonArray, lifecycle: jsonArray },
        // Fixture policy requires the exact reference-checked public graph, not an always-true callback.
        validateReferences: (datasets) => SNAPSHOT_DATASET_KINDS.every((kind) =>
          canonicalJson(datasets[kind] as CanonicalJsonValue) === canonicalJson(expectedValues[kind] as CanonicalJsonValue)),
      });
      const portableInput = { manifest: signed.manifest,
        files: Object.fromEntries(signed.composition.files.map((file) => [file.manifest.key, file.body])),
        trustSet, expectedProjectId: scope.projectId, supportedSchemaMajor: 1, lastGood: null };
      expect(portable(portableInput)).toMatchObject({ accepted: true, nextState: { publishSequence: first.publishSequence } });
      const corrupt = Uint8Array.from(signed.composition.files[0]!.body); corrupt[corrupt.length - 1] ^= 1;
      expect(portable({ ...portableInput, files: { ...portableInput.files, [signed.composition.files[0]!.manifest.key]: corrupt } }))
        .toMatchObject({ accepted: false, reason: "FILE_HASH_MISMATCH", nextState: null });
      expect(JSON.stringify(assembled.datasets)).not.toMatch(/synthetic-private|storageKey|sourceId|normalizedHash|rawRecord|contactPhones/u);
      await expect(assemble(createProjectJobPrincipal({ organizationId: scope.organizationId,
        projectId: scope.foreignProjectId, jobName: "snapshot-input" }), lookup)).rejects.toThrow("SNAPSHOT_INPUT_ACCESS_DENIED");
      expect(publicMedia.dataset.records.map((record) => record.key).sort()).toEqual([
        `AGENT/${agentUid}/0`, `DEVELOPMENT/${developmentUid}/0`, `INVENTORY/${fixture.inventoryUid}/0`, `INVENTORY/${fixture.inventoryUid}/1`,
      ].sort());
      expect(publicMedia.diagnostics).toEqual([]);
      expect(projectSnapshotProjectState(first, publicMedia.agentMedia)[0]!.records[0]!.value).toMatchObject({
        uid: agentUid, media: [{ ref: "a".repeat(64), kind: "IMAGE", position: 0 }] });
      expect(JSON.stringify(publicMedia.dataset)).not.toMatch(/private|storageKey|sourceId|relationId|assetId/u);
      expect(publicProjectState.map((dataset) => dataset.records.length)).toEqual([1, 1, 1, 4, 1, 4]);
      expect(publicProjectState[0]!.records[0]!.value).toMatchObject({ uid: agentUid, fullName: "Synthetic consented agent", media: [] });
      expect(publicProjectState[1]!.records[0]!.value).toMatchObject({ phone: "+70000000001" });
      expect(publicProjectState[2]!.records[0]!.value).toMatchObject({ description: "Captured public copy" });
      expect(publicProjectState[4]!.records[0]!.references).toEqual([{ kind: "urls", key: "entry:1234567890123456" }]);
      expect(JSON.stringify(publicProjectState)).not.toMatch(/synthetic-private|"consent[^"]*":|photoMediaId|feedPhotoMediaId|presentationNotes|rawRecord/u);
      expect(publicCatalog.find((dataset) => dataset.kind === "developers")!.records)
        .toContainEqual(expect.objectContaining({ value: expect.objectContaining({ uid: developerUid,
          name: "D".repeat(200), aliases: ["A".repeat(200)] }) }));
      expect(publicCatalog.find((dataset) => dataset.kind === "developments")!.records)
        .toContainEqual(expect.objectContaining({ value: expect.objectContaining({ uid: developmentUid,
          name: "N".repeat(200), latitude: "55.1234567", longitude: "37.1234567" }) }));
      expect(publicCatalog.find((dataset) => dataset.kind === "prices")!.records[0]!.value)
        .toMatchObject({ amount: "12345.67" });
      expect(first.publishSequence).toBe(1);
      expect([...new Set(first.parts.map((part) => part.kind))]).toEqual([...SNAPSHOT_INPUT_PART_KINDS]);
      expect(first.catalogRevision).toMatch(/^[a-f0-9]{64}$/u);
      const values = (kind: typeof SNAPSHOT_INPUT_PART_KINDS[number], receipt = first) => receipt.parts.filter((part) => part.kind === kind).flatMap((part) => part.payload);
      expect(values("inventory")).toContainEqual(expect.objectContaining({ uid: fixture.inventoryUid }));
      expect(values("prices")).toContainEqual(expect.objectContaining({ amount: "12345.67" }));
      expect(values("agents")).toContainEqual(expect.objectContaining({ uid: agentUid }));
      expect(values("media").filter((row) => typeof row === "object" && row && "inventoryUid" in row)).toHaveLength(2);
      expect(JSON.stringify(first.parts)).not.toMatch(/https:|synthetic-private|rawRecord|contactPhones|originalFileName|consentBasis|consentConfirmedBy/u);
      await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        await tx.source.update({ where: { id: fixture.sourceId }, data: { enabled: false, profileKey: "default-v1", version: { increment: 1 } } });
        await tx.development.update({ where: { uid: developmentUid }, data: { name: "Changed development", normalizedName: "changed development", version: { increment: 1 } } });
        await tx.projectPublicContact.update({ where: { organizationId_projectId: { organizationId: scope.organizationId,
          projectId: scope.projectId } }, data: { phone: "+70000000002", version: { increment: 1 } } });
        await tx.agent.update({ where: { uid: agentUid }, data: { consentConfirmedAt: null, version: { increment: 1 } } });
        await tx.mediaAsset.update({ where: { id: fixture.assetId }, data: { storageKey: "synthetic-wrong-object-key" } });
        await tx.entityEditorial.updateMany({ where: { organizationId: scope.organizationId, projectId: scope.projectId },
          data: { description: "Changed live editorial", version: { increment: 1 } } });
        await tx.projectUrlEntry.updateMany({ where: { organizationId: scope.organizationId, projectId: scope.projectId, entityType: "AGENT" },
          data: { slug: "changed", canonicalPath: "/agents/changed", version: { increment: 1 } } });
        await tx.projectCatalogSubscription.delete({ where: { organizationId_projectId: { organizationId: scope.organizationId, projectId: scope.projectId } } });
      });
      // Caller mutation cannot change the persisted parts returned by replay.
      first.parts[0]!.payload.length = 0;
      const replay = await captureSnapshotInput(principal, request);
      expect(replay).toEqual(pinned);
      expect(projectSnapshotCatalog(replay)).toEqual(publicCatalog);
      expect(projectSnapshotProjectState(replay)).toEqual(publicProjectState);
      expect(await projectMedia(replay)).toEqual(publicMedia);
      expect(await assemble(principal, lookup)).toEqual(assembled);
      expect(compose((await assemble(principal, lookup)).datasets)).toEqual(composition);
      expect(await buildSigned()).toEqual(signed);
      expect(head).toHaveBeenCalledTimes(7);
      await expect(captureSnapshotInput(principal, { ...request, schemaMinor: 1 })).rejects.toThrow("SNAPSHOT_INPUT_IDEMPOTENCY_CONFLICT");
      await expect(captureSnapshotInput(principal, { ...request, idempotencyKey: "synthetic-rollback" })).rejects.toThrow("SHARED_CATALOG_SUBSCRIPTION_NOT_FOUND");
      await worker(scope, async (tx) => {
        expect(await tx.snapshotBuildInput.count()).toBe(1);
        expect((await tx.projectSnapshotSequence.findFirstOrThrow()).lastReservedSequence).toBe(1);
      });
      await runInPrincipalDatabaseTransaction(admin, (tx) => tx.projectCatalogSubscription.create({ data: {
        organizationId: scope.organizationId, projectId: scope.projectId, mode: "CURATED", version: 2,
        cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } }, selections: { create: { developmentUid, decision: "INCLUDE" } } } }));
      const second = await captureSnapshotInput(principal, { ...request, idempotencyKey: "synthetic-second" });
      expect(second.publishSequence).toBe(2);
      expect(second.catalogRevision).not.toBe(pinned.catalogRevision);
      expect(values("agents", second)).toEqual([]);
      expect(values("contacts", second)).toContainEqual(expect.objectContaining({ phone: "+70000000002", version: 2 }));
      expect(second.inputHash).not.toBe(pinned.inputHash);
      const nextProjectState = projectSnapshotProjectState(second);
      expect(nextProjectState[0]!.records).toEqual([]);
      expect(nextProjectState[2]!.records).toEqual([]);
      expect(nextProjectState[1]!.records[0]!.value).toMatchObject({ phone: "+70000000002" });
      await expect(captureSnapshotInput(principal, { ...request, projectId: scope.foreignProjectId })).rejects.toThrow("SNAPSHOT_INPUT_ACCESS_DENIED");
      await runInPrincipalDatabaseTransaction(admin, (tx) => tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } }));
      await expect(captureSnapshotInput(principal, request)).rejects.toThrow("SNAPSHOT_INPUT_JOBS_FROZEN");
      await runInPrincipalDatabaseTransaction(admin, (tx) => tx.dataSafetyState.update({ where: { id: "global" },
        data: { jobsFrozen: false, unfrozenAt: new Date() } }));
      const concurrent = await Promise.all([1, 2].map(() => captureSnapshotInput(principal,
        { ...request, idempotencyKey: "synthetic-concurrent" })));
      expect(concurrent[0]).toEqual(concurrent[1]);
      expect(concurrent[0]!.publishSequence).toBe(3);
      await worker(scope, async (tx) => {
        expect(await tx.snapshotBuildInput.count()).toBe(3);
        expect((await tx.projectSnapshotSequence.findFirstOrThrow()).lastReservedSequence).toBe(3);
      });
      expect(workerTransactions).toBeGreaterThanOrEqual(10);
    } finally { role.mockRestore(); }
  }, 60_000);

  it("selects captured subscriptions without letting confirmed inventory links override exclusions", async () => {
    const scope = await setup();
    const target = { organizationId: scope.organizationId, projectId: scope.projectId };
    const cityA = createUlid(); const cityB = createUlid(); const developerUid = createUlid();
    const developments = [createUlid(), createUlid(), createUlid()];
    const buildings = [createUlid(), createUlid(), createUlid()];
    const inventoryUids = [createUlid(), createUlid()];
    const fixture = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      await tx.projectPublicContact.create({ data: { ...target, phone: "+70000000077", messengers: [] } });
      const regionUid = (await tx.city.findUniqueOrThrow({ where: { uid: "01M41T6Q04BADHXSERJHZFXKCH" } })).regionUid;
      await tx.city.createMany({ data: [cityA, cityB].map((uid) => ({ uid, regionUid, name: `City ${uid}`, normalizedName: uid.toLowerCase() })) });
      await tx.developer.create({ data: { uid: developerUid, name: "Synthetic selection developer", normalizedName: developerUid.toLowerCase() } });
      for (const [index, uid] of developments.entries()) await tx.development.create({ data: {
        uid, developerUid, cityUid: index === 2 ? cityB : cityA, name: `Development ${index}`, normalizedName: uid.toLowerCase(),
      } });
      const inactiveDeveloper = createUlid();
      await tx.developer.create({ data: { uid: inactiveDeveloper, name: "Inactive synthetic developer",
        normalizedName: inactiveDeveloper.toLowerCase(), lifecycle: "INACTIVE" } });
      for (const [index, uid] of [createUlid(), createUlid()].entries()) await tx.development.create({ data: {
        uid, developerUid: index === 0 ? inactiveDeveloper : developerUid, cityUid: cityA,
        name: `Unpublishable ${index}`, normalizedName: uid.toLowerCase(), mergedIntoUid: index === 1 ? developments[0]! : null,
      } });
      for (const [index, uid] of buildings.entries()) await tx.building.create({ data: { uid,
        developmentUid: developments[0]!, label: `Building ${index}`, normalizedLabel: uid.toLowerCase(),
        lifecycle: index === 1 ? "INACTIVE" : "ACTIVE", mergedIntoUid: index === 2 ? buildings[0]! : null } });
      await tx.projectCatalogSubscription.create({ data: { ...target, mode: "ALL_SHARED",
        cities: { create: { cityUid: cityA } }, selections: { create: [
          { developmentUid: developments[1]!, decision: "EXCLUDE" }, { developmentUid: developments[2]!, decision: "INCLUDE" },
        ] } } });
      const source = await tx.source.create({ data: { ...target, sourceKey: "synthetic-selection", name: "Synthetic selection",
        adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
        datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" } } });
      const where = { ...target, sourceId: source.id };
      const revision = await tx.sourceRevision.create({ data: { ...where, sourceVersion: source.version,
        adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey,
        profileVersion: source.profileVersion, ...syntheticSafety(2), recordCount: 2 } });
      const fields = { text: "", attributes: {}, children: { "|rooms": [{ text: "2", attributes: {}, children: {} }] } };
      for (const [index, uid] of inventoryUids.entries()) {
        const externalId = `selection-${index}`;
        const draft = { externalId, sourceFormat: "YRL_2010", propertyType: "APARTMENT", transactionType: "SALE",
          title: "Synthetic retained inventory", address: "Synthetic City, house 9", imageUrls: [], contactPhones: [], provenance: {} };
        const hash = normalizedContentHash({ draft: { ...draft, provenance: undefined }, fields });
        await tx.sourceRevisionRecord.create({ data: { ...where, revisionId: revision.id, externalId, inventoryUid: uid,
          recordHash: hash, orderKey: Buffer.from(externalId).toString("hex"), payload: { schemaVersion: 1, draft, fields } } });
        await tx.inventoryIdentity.create({ data: { ...where, uid, externalOfferId: externalId, normalizedHash: hash,
          sourceHash: "c".repeat(64), status: "ACTIVE", firstSeenAt: new Date(), lastSeenAt: new Date() } });
        await tx.listingDevelopmentLink.create({ data: { ...target, inventoryUid: uid, developmentUid: developments[index + 1]!,
          candidateReason: "synthetic-confirmed", status: "CONFIRMED", confirmedBy: "synthetic-admin",
          confirmedAt: new Date(), sourceRevisionId: revision.id } });
        const reservation = await tx.publicUrlIdReservation.create({ data: { ...target, subjectType: "INVENTORY",
          subjectUid: uid, publicUrlId: `${index + 4}000000000000000` } });
        await tx.projectUrlEntry.create({ data: { ...target, entityType: "INVENTORY", entityUid: uid,
          reservationId: reservation.id, slug: externalId, canonicalPath: `/inventory/${externalId}` } });
      }
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence: 1,
        rawStorageKey: "synthetic-selection", rawArtifactHash: "c".repeat(64), rawByteCount: 1,
        normalizedContentHash: "d".repeat(64), completedAt: new Date() } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
      await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: revision.id } });
      for (const [index, developmentUid] of developments.entries()) {
        const sha256 = String(index + 1).repeat(64); const image = `https://private.example.invalid/selection-${index}.png`;
        const asset = await tx.mediaAsset.create({ data: { ...target, sha256, storageKey: createMediaKey(sha256),
          byteSize: 1, contentType: "image/png", originalFileName: "synthetic-private.png",
          rightsBasis: "OWNED", source: "synthetic-private", uploadedBy: "synthetic" } });
        await tx.sharedMediaAsset.create({ data: { ...where, developmentUid, position: 0, externalId: `selection-${index}`,
          sourceUrl: image, canonicalSourceUrl: image, rightsBasis: "OWNED", observedAt: new Date() } });
        await tx.mediaSource.create({ data: { ...where, sourceRevisionId: revision.id, entityType: "DEVELOPMENT", entityUid: developmentUid,
          kind: "DEVELOPMENT_IMAGE", position: 0, sourceUrl: image, canonicalSourceUrl: image, status: "MIRRORED", assetId: asset.id,
          firstSeenAt: new Date(), lastAttemptAt: new Date(), mirroredAt: new Date() } });
        await tx.priceObservation.create({ data: { ...where, developmentUid, externalId: `selection-${index}`,
          observedAt: new Date(), amount: "100", currency: "RUB", basis: "TOTAL" } });
        await tx.entityEditorial.create({ data: { ...target, entityType: "DEVELOPMENT", entityUid: developmentUid,
          description: `Public selection ${index}`, faq: [], mediaOrder: [] } });
      }
      const reservation = await tx.publicUrlIdReservation.create({ data: { ...target, subjectType: "DEVELOPMENT",
        subjectUid: developments[1]!, publicUrlId: "6000000000000000" } });
      const entry = await tx.projectUrlEntry.create({ data: { ...target, entityType: "DEVELOPMENT", entityUid: developments[1]!,
        reservationId: reservation.id, slug: "excluded-history", canonicalPath: "/developments/excluded-history" } });
      await tx.projectRedirect.create({ data: { ...target, urlEntryId: entry.id, fromPath: "/developments/old-excluded",
        toPath: "/developments/excluded-history", code: 301, reason: "SLUG_CHANGE" } });
      await tx.projectUrlTombstone.create({ data: { ...target, reservationId: reservation.id, entityType: "DEVELOPMENT",
        entityUid: developments[1]!, canonicalPath: "/developments/retired-excluded", reason: "RETIRE" } });
      for (const buildingUid of buildings.slice(1)) await tx.priceObservation.create({ data: { ...where,
        developmentUid: developments[0]!, buildingUid, externalId: buildingUid, observedAt: new Date(),
        amount: "200", currency: "RUB", basis: "TOTAL" } });
      return source.id;
    });
    const all = await captureWithWorkerRole(target, "selection-all");
    await runInPrincipalDatabaseTransaction(admin, (tx) => tx.projectCatalogSubscription.update({
      where: { organizationId_projectId: target }, data: { mode: "CURATED", version: { increment: 1 } } }));
    const curated = await captureWithWorkerRole(target, "selection-curated");
    const pinned = structuredClone([all, curated]);
    const original = transactionRuntime.runInAuthorizedDatabaseTransaction;
    let transactionOpen = false;
    const role = vi.spyOn(transactionRuntime, "runInAuthorizedDatabaseTransaction").mockImplementation((context, execute, options) =>
      original(context, async (tx) => {
        if (context.actorId === "snapshot-input") {
          await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
          expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
            .toEqual([{ rolbypassrls: false, rolsuper: false }]);
        }
        transactionOpen = true; try { return await execute(tx); } finally { transactionOpen = false; }
      }, options));
    const head = vi.fn(async (key: string) => {
      expect(transactionOpen).toBe(false);
      const sha256 = ["1", "3"].map((value) => value.repeat(64)).find((value) => createMediaKey(value) === key);
      expect(sha256).toBeDefined();
      return { key, sha256: sha256!, contentType: "image/png", contentLength: 1, etag: null, lastModifiedAt: new Date(0) };
    });
    try {
      const assemble = createSnapshotCandidateAssemblyServer({ ...target, storage: { head } });
      const principal = createProjectJobPrincipal({ ...target, jobName: "snapshot-input" });
      const lookup = (receipt: typeof all) => ({ idempotencyKeyHash: receipt.idempotencyKeyHash, requestHash: receipt.requestHash });
      const first = await assemble(principal, lookup(all)); const second = await assemble(principal, lookup(curated));
      for (const [result, expected] of [[first, developments[0]!], [second, developments[2]!]] as const) {
        expect(result.datasets).toHaveLength(13);
        const records = (kind: typeof SNAPSHOT_DATASET_KINDS[number]) => result.datasets.find((dataset) => dataset.kind === kind)!.records;
        expect(records("developments").map((record) => record.key)).toEqual([expected]);
        expect(records("buildings").map((record) => record.key)).toEqual(expected === developments[0] ? [buildings[0]] : []);
        expect(records("inventory").map((record) => record.key).sort()).toEqual([...inventoryUids].sort());
        expect(records("prices")).toHaveLength(1); expect(records("editorial")).toHaveLength(1);
        expect(records("media")).toHaveLength(1); expect(records("redirects")).toHaveLength(1);
        expect(JSON.stringify(records("urls"))).toContain("excluded-history");
        expect(JSON.stringify(records("lifecycle"))).toContain("retired-excluded");
      }
      expect(head.mock.calls.map(([key]) => key)).toEqual([createMediaKey("1".repeat(64)), createMediaKey("3".repeat(64))]);
      await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        await tx.source.update({ where: { id: fixture }, data: { enabled: false, profileKey: "default-v1", version: { increment: 1 } } });
        await tx.development.updateMany({ where: { uid: { in: developments } }, data: { lifecycle: "INACTIVE", version: { increment: 1 } } });
        await tx.listingDevelopmentLink.updateMany({ where: target, data: { status: "REJECTED" } });
        await tx.projectCatalogSubscription.delete({ where: { organizationId_projectId: target } });
      });
      expect(await assemble(principal, lookup(all))).toEqual(first);
      expect(await assemble(principal, lookup(curated))).toEqual(second);
      expect([all, curated]).toEqual(pinned);
      const before = head.mock.calls.length;
      await expect(assemble(createProjectJobPrincipal({ organizationId: scope.organizationId,
        projectId: scope.foreignProjectId, jobName: "snapshot-input" }), lookup(all))).rejects.toThrow("SNAPSHOT_INPUT_ACCESS_DENIED");
      expect(head).toHaveBeenCalledTimes(before);
    } finally { role.mockRestore(); }
  }, 60_000);

  it("assembles historical GOOD public facts in bounded pages after producer-off without loading a live profile", async () => {
    const scope = await setup(); const uids = Array.from({ length: 201 }, () => createUlid());
    const fields = { text: "", attributes: {}, children: { "|rooms": [{ text: "2", attributes: {}, children: {} }] } };
    const draft = (externalId: string) => ({ externalId, sourceFormat: "YRL_2010", propertyType: "APARTMENT", transactionType: "SALE",
      title: "Synthetic historical public inventory", address: "Synthetic City, house 9", imageUrls: [], contactPhones: [], provenance: {} });
    const hashes = uids.map((_, index) => normalizedContentHash({ draft: { ...draft(`kept-${index}`), provenance: undefined }, fields }));
    const sourceId = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      await tx.projectPublicContact.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        phone: "+70000000077", messengers: [] } });
      await tx.projectCatalogSubscription.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        mode: "ALL_SHARED", cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
      const source = await tx.source.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        sourceKey: "synthetic-paged-good", name: "Synthetic historical source", adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0",
        profileKey: "vladis-vt24-v1", profileVersion: "1.0.0", datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" } } });
      const where = { organizationId: scope.organizationId, projectId: scope.projectId, sourceId: source.id };
      let previousRevisionId: string | null = null; let previousRecordCount: number | null = null;
      const revision = async (sequence: number, historical: boolean) => {
        const row = await tx.sourceRevision.create({ data: { ...where, sourceVersion: source.version,
          adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey,
          profileVersion: source.profileVersion, baseLastGoodRevisionId: previousRevisionId,
          ...syntheticSafety(historical ? 201 : 1, previousRecordCount), recordCount: historical ? 201 : 1 } });
        await tx.sourceRevisionRecord.createMany({ data: historical ? uids.map((uid, index) => ({ ...where, revisionId: row.id,
          externalId: `kept-${index}`, inventoryUid: uid, recordHash: hashes[index]!, orderKey: Buffer.from(`kept-${index}`).toString("hex"),
          payload: { schemaVersion: 1, draft: draft(`kept-${index}`), fields } })) : [{ ...where, revisionId: row.id,
          externalId: "new-only", inventoryUid: createUlid(), recordHash: normalizedContentHash({ draft: { ...draft("new-only"), provenance: undefined }, fields }),
          orderKey: "6e65772d6f6e6c79", payload: { schemaVersion: 1, draft: draft("new-only"), fields } }] });
        await tx.sourceRevision.update({ where: { id: row.id }, data: { status: "STAGED", sequence,
          rawStorageKey: `synthetic-private/${sequence}`, rawArtifactHash: "a".repeat(64), rawByteCount: 1,
          normalizedContentHash: "b".repeat(64), completedAt: new Date() } });
        await tx.sourceRevision.update({ where: { id: row.id }, data: { status: "GOOD" } });
        previousRevisionId = row.id; previousRecordCount = historical ? 201 : 1;
        return row.id;
      };
      await revision(1, true); const head = await revision(2, false);
      await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: head } });
      await tx.inventoryIdentity.createMany({ data: uids.map((uid, index) => ({ ...where, uid, externalOfferId: `kept-${index}`,
        normalizedHash: hashes[index]!, sourceHash: "c".repeat(64), status: "ACTIVE", firstSeenAt: new Date(), lastSeenAt: new Date(),
        missingGoodRuns: 1, missingSince: new Date() })) });
      const projectScope = { organizationId: scope.organizationId, projectId: scope.projectId };
      await tx.publicUrlIdReservation.createMany({ data: uids.map((uid, index) => ({ ...projectScope, subjectType: "INVENTORY",
        subjectUid: uid, publicUrlId: `3${String(index).padStart(15, "0")}` })) });
      const reservations = await tx.publicUrlIdReservation.findMany({ where: { ...projectScope, subjectType: "INVENTORY" } });
      await tx.projectUrlEntry.createMany({ data: reservations.map((reservation) => ({ ...projectScope, entityType: "INVENTORY",
        entityUid: reservation.subjectUid, reservationId: reservation.id, slug: `synthetic-${reservation.publicUrlId}`,
        canonicalPath: `/inventory/synthetic-${reservation.publicUrlId}` })) });
      return source.id;
    });
    const captured = await captureWithWorkerRole({ organizationId: scope.organizationId,
      projectId: scope.projectId }, "synthetic-paged-assembly");
    const pins = captured.parts.filter((part) => part.kind === "inventory").flatMap((part) => part.payload);
    expect(pins).toHaveLength(201);
    expect(pins.every((pin) => pin && typeof pin === "object" && !Array.isArray(pin)
      && pin.factRevisionSequence === 1 && pin.approvedHeadSequence === 2)).toBe(true);
    const principal = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input" });
    const originalTransaction = transactionRuntime.runInAuthorizedDatabaseTransaction;
    const role = vi.spyOn(transactionRuntime, "runInAuthorizedDatabaseTransaction").mockImplementation((context, execute, options) =>
      originalTransaction(context, async (tx) => {
        if (context.actorId === "snapshot-input") {
          await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
          expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
            .toEqual([{ rolbypassrls: false, rolsuper: false }]);
        }
        return execute(tx);
      }, options));
    const sizes: number[] = []; const originalResolver = sourceFacade.createSnapshotGoodFactResolver;
    const resolver = vi.spyOn(sourceFacade, "createSnapshotGoodFactResolver").mockImplementation((tx) => {
      const resolve = originalResolver(tx);
      return (target, page, profiles) => { sizes.push(page.length); return resolve(target, page, profiles); };
    });
    const head = vi.fn();
    try {
      const assemble = createSnapshotCandidateAssemblyServer({ organizationId: scope.organizationId, projectId: scope.projectId, storage: { head } });
      const lookup = { idempotencyKeyHash: captured.idempotencyKeyHash, requestHash: captured.requestHash };
      const first = await assemble(principal, lookup);
      expect(sizes).toEqual([200, 1]); expect(first.datasets).toHaveLength(13);
      const inventory = first.datasets.find((dataset) => dataset.kind === "inventory")!.records;
      expect(inventory).toHaveLength(201);
      expect(inventory.every((record) => typeof record.value === "object" && record.value !== null
        && !Array.isArray(record.value) && record.value.title === "Synthetic historical public inventory")).toBe(true);
      await runInPrincipalDatabaseTransaction(admin, (tx) => tx.source.update({ where: { id: sourceId },
        data: { enabled: false, profileKey: "default-v1", version: { increment: 1 } } }));
      expect(await assemble(principal, lookup)).toEqual(first);
      expect(sizes).toEqual([200, 1, 200, 1]); expect(head).not.toHaveBeenCalled();
    } finally { role.mockRestore(); resolver.mockRestore(); }
  }, 60_000);

  it("captures 4100 inventory pins with page-bounded SQL inside the actual worker timeout", async () => {
    const scope = await setup();
    const identities = Array.from({ length: 4100 }, (_, index) => ({ uid: createUlid(), externalId: `synthetic-page-${index}` }));
    // Fixture construction has its own bounded allowance; the worker assertion
    // below still exercises the unchanged real 30-second capture contract.
    const fixture = await runInAuthorizedDatabaseTransaction(transactionRuntime.createDatabaseAuthorizationContext(admin), async (tx) => {
      const source = await tx.source.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        sourceKey: "synthetic-page", name: "Synthetic page", adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0",
        profileKey: "default-v1", profileVersion: "1.0.0", datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" } } });
      const where = { organizationId: scope.organizationId, projectId: scope.projectId, sourceId: source.id };
      const revision = await tx.sourceRevision.create({ data: { ...where, sourceVersion: source.version,
        adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey,
        profileVersion: source.profileVersion, ...syntheticSafety(identities.length), recordCount: identities.length } });
      for (let offset = 0; offset < identities.length; offset += 200) {
        const page = identities.slice(offset, offset + 200);
        await tx.sourceRevisionRecord.createMany({ data: page.map((identity) => ({ ...where, revisionId: revision.id,
          externalId: identity.externalId, inventoryUid: identity.uid, recordHash: "b".repeat(64),
          orderKey: Buffer.from(identity.externalId).toString("hex"), payload: { schemaVersion: 1, draft: { imageUrls: [] } } })) });
        await tx.inventoryIdentity.createMany({ data: page.map((identity) => ({ ...where, uid: identity.uid,
          externalOfferId: identity.externalId, normalizedHash: "b".repeat(64), sourceHash: "c".repeat(64),
          status: "ACTIVE", firstSeenAt: new Date(), lastSeenAt: new Date() })) });
      }
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence: 1,
        rawStorageKey: "synthetic-page", rawArtifactHash: "a".repeat(64), rawByteCount: 1,
        normalizedContentHash: "b".repeat(64), completedAt: new Date() } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
      await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: revision.id } });
      return { sourceId: source.id };
    }, { timeout: 30_000 });
    await worker(scope, async (tx) => {
      const probe = identities[0]!;
      const plans = await tx.$queryRaw<{ "QUERY PLAN": unknown }[]>(Prisma.sql`
        EXPLAIN (FORMAT JSON)
        SELECT "revisionId" FROM "SourceRevisionRecord"
        WHERE "organizationId" = ${scope.organizationId} AND "projectId" = ${scope.projectId}
          AND "sourceId" = ${fixture.sourceId} AND "inventoryUid" = ${probe.uid}
          AND "externalId" = ${probe.externalId} AND "recordHash" = ${"b".repeat(64)}
      `);
      expect(JSON.stringify(plans)).toContain("SourceRevisionRecord_inventory_fact_idx");
      const queries = vi.spyOn(tx, "$queryRaw");
      const relations = vi.spyOn(tx.mediaSource, "findMany");
      try {
        const sink = vi.fn(); const reader = createMediaSnapshotFactReader(tx, sink);
        const startedAt = performance.now();
        let capturedIdentities = 0;
        await createSourceSnapshotFactReader(tx).capture(scope, () => undefined, async (page) => {
          capturedIdentities += page.length;
          await reader.captureInventoryPage(scope, page.map((row) => {
            if (!row.factRevisionId || !row.factRevisionSequence || !row.approvedHeadId || !row.approvedHeadSequence) {
              throw new Error("SYNTHETIC_PAGE_PIN_MISSING");
            }
            return { sourceId: row.sourceId, inventoryUid: row.uid, externalOfferId: row.externalOfferId,
              normalizedHash: row.normalizedHash, factRevisionId: row.factRevisionId,
              approvedHeadId: row.approvedHeadId, factRevisionSequence: row.factRevisionSequence,
              approvedHeadSequence: row.approvedHeadSequence };
          }));
        });
        reader.finishCapture();
        const elapsedMs = Math.round(performance.now() - startedAt);
        expect(elapsedMs).toBeLessThan(30_000);
        expect(capturedIdentities).toBe(4100);
        // One additional SQL byte guard for the cached head/fact approval.
        expect(queries).toHaveBeenCalledTimes(65);
        expect(relations).not.toHaveBeenCalled();
        expect(sink).toHaveBeenCalledExactlyOnceWith("media", []);
        console.info(`snapshot_source_media_page_capacity=PASS inventories=4100 raw_queries=65 elapsed_ms=${elapsedMs}`);
      } finally { queries.mockRestore(); relations.mockRestore(); }
    });
    const images = ["https://private.example.invalid/a.jpg", "https://private.example.invalid/b.jpg"];
    await runInAuthorizedDatabaseTransaction(transactionRuntime.createDatabaseAuthorizationContext(admin), async (tx) => {
      const where = { organizationId: scope.organizationId, projectId: scope.projectId, sourceId: fixture.sourceId };
      const source = await tx.source.findUniqueOrThrow({ where: { id: fixture.sourceId } });
      await tx.projectCatalogSubscription.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        mode: "CURATED", cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
      // Real captured fallback is required for this all-unbound graph; never forge
      // requiresContact=false merely to exercise a publication reader.
      await tx.projectPublicContact.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        phone: "+70000000000", messengers: [] } });
      const asset = await tx.mediaAsset.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        sha256: "a".repeat(64), storageKey: createMediaKey("a".repeat(64)), contentType: "image/jpeg", byteSize: 100,
        originalFileName: "synthetic-private-filename", source: "synthetic-private-source", rightsBasis: "OWNED", uploadedBy: "synthetic" } });
      const revision = await tx.sourceRevision.create({ data: { ...where, sourceVersion: source.version,
        adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey,
        profileVersion: source.profileVersion, baseLastGoodRevisionId: source.lastGoodRevisionId,
        ...syntheticSafety(identities.length, identities.length), recordCount: identities.length } });
      for (let offset = 0; offset < identities.length; offset += 200) {
        const page = identities.slice(offset, offset + 200);
        await tx.sourceRevisionRecord.createMany({ data: page.map((identity) => ({ ...where, revisionId: revision.id,
          externalId: identity.externalId, inventoryUid: identity.uid, recordHash: "b".repeat(64),
          orderKey: Buffer.from(identity.externalId).toString("hex"), payload: { schemaVersion: 1, draft: { imageUrls: images } } })) });
        await tx.mediaSource.createMany({ data: page.flatMap((identity) => images.map((sourceUrl, position) => ({ ...where,
          sourceRevisionId: revision.id, entityType: "INVENTORY", entityUid: identity.uid, kind: "LISTING_IMAGE" as const,
          position, sourceUrl, canonicalSourceUrl: sourceUrl, status: "MIRRORED" as const, assetId: asset.id,
          firstSeenAt: new Date(), lastAttemptAt: new Date(), mirroredAt: new Date() }))) });
      }
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence: 2,
        rawStorageKey: "synthetic-page-images", rawArtifactHash: "d".repeat(64), rawByteCount: 1,
        normalizedContentHash: "b".repeat(64), completedAt: new Date() } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
      await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: revision.id } });
    }, { timeout: 30_000 });
    const exactScope = { organizationId: scope.organizationId, projectId: scope.projectId };
    const startedAt = performance.now();
    const receipt = await captureWithWorkerRole(exactScope, "synthetic-full-capacity", true);
    expect(performance.now() - startedAt).toBeLessThan(30_000);
    expect(receipt.publishSequence).toBe(1);
    expect(receipt.parts.filter((part) => part.kind === "inventory").flatMap((part) => part.payload)).toHaveLength(4100);
    expect(receipt.parts.filter((part) => part.kind === "media").flatMap((part) => part.payload)).toHaveLength(8200);
    expect([...new Set(receipt.parts.map((part) => part.kind))]).toEqual([...SNAPSHOT_INPUT_PART_KINDS]);
    expect(await captureWithWorkerRole(exactScope, "synthetic-full-capacity")).toEqual(receipt);
    const parts = validateSnapshotInput(receipt);
    const anchors = prepareSnapshotPublicationSourceAnchors({ sources: parts.filter((part) => part.kind === "sources").flatMap((part) => part.payload),
      inventory: parts.filter((part) => part.kind === "inventory").flatMap((part) => part.payload) });
    const projectAnchors = prepareSnapshotPublicationProjectAnchors({ project: parts.filter((part) => part.kind === "project").flatMap((part) => part.payload),
      contacts: parts.filter((part) => part.kind === "contacts").flatMap((part) => part.payload), agents: [], links: [],
      publishedAgentUids: new Set(), publishedBindings: new Map(),
      requiresContact: snapshotRequiresProjectContact(identities.map((row) => row.uid), new Map()) });
    expect(projectAnchors).toMatchObject({ requiresContact: true, contactVersion: 1 });
    const freshStarted = performance.now();
    await runInAuthorizedDatabaseTransaction({ principalKind: "project-job", actorId: "snapshot-publication",
      organizationId: exactScope.organizationId, projectIds: [exactScope.projectId], correlationId: randomUUID() }, async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
      expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user"))
        .toEqual([{ rolbypassrls: false, rolsuper: false }]);
      await lockSnapshotPublication(tx, exactScope);
      await createSnapshotPublicationProjectReader(tx)(exactScope, projectAnchors);
      await createSnapshotPublicationSourceReader(tx)(exactScope, anchors);
    }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
    const freshElapsed = Math.round(performance.now() - freshStarted);
    expect(freshElapsed).toBeLessThan(5000);
    console.info(`snapshot_source_fresh_capacity=PASS inventories=4100 page_size=200 elapsed_ms=${freshElapsed}`);
  }, 120_000);

  it("pins scoped shared observation mirrors without requiring an XML revision for manual imports", async () => {
    const scope = await setup();
    const uid = createUlid(); const excludedUid = createUlid();
    const fixture = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const developerUid = createUlid();
      await tx.developer.create({ data: { uid: developerUid, name: developerUid, normalizedName: developerUid.toLowerCase() } });
      for (const developmentUid of [uid, excludedUid]) await tx.development.create({ data: { uid: developmentUid,
        developerUid, cityUid: "01M41T6Q04BADHXSERJHZFXKCH", name: developmentUid, normalizedName: developmentUid.toLowerCase() } });
      const source = await tx.source.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        sourceKey: "synthetic-shared", name: "Synthetic shared", adapterKey: "manual", adapterVersion: "1",
        profileKey: "manual", profileVersion: "1", datasetType: "NEW_BUILD", schedulePolicy: { mode: "MANUAL_ONLY" } } });
      const ownAsset = await tx.mediaAsset.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        sha256: "a".repeat(64), storageKey: createMediaKey("a".repeat(64)), byteSize: 100, contentType: "image/jpeg",
        originalFileName: "synthetic-private-filename", rightsBasis: "OWNED", source: "synthetic-private", uploadedBy: "synthetic" } });
      const foreignAsset = await tx.mediaAsset.create({ data: { organizationId: scope.organizationId, projectId: scope.foreignProjectId,
        sha256: "b".repeat(64), storageKey: createMediaKey("b".repeat(64)), byteSize: 100, contentType: "image/jpeg",
        originalFileName: "synthetic-private-filename", rightsBasis: "OWNED", source: "synthetic-private", uploadedBy: "synthetic" } });
      let retainedRelationId = "";
      for (let index = 0; index < 5; index++) {
        const canonicalSourceUrl = `https://private.example.invalid/${index}.jpg`;
        await tx.sharedMediaAsset.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
          sourceId: source.id, developmentUid: index === 4 ? excludedUid : uid, externalId: `synthetic-${index}`,
          position: index, sourceUrl: canonicalSourceUrl, canonicalSourceUrl, observedAt: new Date(),
          rightsBasis: index === 3 ? "LICENSED" : "OWNED", attribution: index === 3 ? "synthetic-private-attribution" : null } });
        if (index === 2 || index === 4) continue;
        const relation = await tx.mediaSource.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
          sourceId: source.id, sourceRevisionId: "manual-approved-observation", entityType: "DEVELOPMENT", entityUid: uid,
          kind: "DEVELOPMENT_IMAGE", position: 999, sourceUrl: canonicalSourceUrl, canonicalSourceUrl,
          status: "WARNING", assetId: index === 1 ? foreignAsset.id : ownAsset.id, firstSeenAt: new Date(),
          lastAttemptAt: new Date(), mirroredAt: index === 3 ? null : new Date() } });
        if (index === 0) retainedRelationId = relation.id;
      }
      return { ownAssetId: ownAsset.id, foreignAssetId: foreignAsset.id, retainedRelationId };
    });
    async function capture(tx: DatabaseTransaction) {
      const rows: CanonicalJsonValue[] = [];
      const reader = createMediaSnapshotFactReader(tx, (_kind, page) => rows.push(...page));
      await reader.captureShared(scope, [uid]); reader.finishCapture(); return rows;
    }
    const pinned = await worker(scope, async (tx) => {
      const before = await capture(tx);
      expect(before).toHaveLength(4);
      expect(before).toContainEqual(expect.objectContaining({ position: 0, provenance: "SHARED_OBSERVATION_MIRROR",
        mirrorStatus: "WARNING", asset: expect.objectContaining({ id: fixture.ownAssetId }) }));
      for (const position of [1, 2, 3]) expect(before).toContainEqual(expect.objectContaining({ position, omission: "MEDIA_MIRROR_UNAVAILABLE" }));
      expect(JSON.stringify(before)).not.toMatch(/https:|synthetic-private|canonicalSourceUrl|license":|attribution":/u);
      await runInPrincipalDatabaseTransaction(admin, (other) => other.mediaSource.update({ where: { id: fixture.retainedRelationId },
        data: { assetId: fixture.foreignAssetId } }));
      expect(await capture(tx)).toEqual(before);
      await expect(createMediaSnapshotFactReader(tx, () => undefined).captureShared(scope, Array.from({ length: 5001 }, () => uid)))
        .rejects.toThrow("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
      return before;
    });
    expect((await worker(scope, capture)).every((row) => typeof row === "object" && row && "omission" in row)).toBe(true);
    expect(pinned).toContainEqual(expect.objectContaining({ asset: expect.objectContaining({ id: fixture.ownAssetId }) }));
  });

  it("pins consent-gated agent photo assignments and scoped asset facts in one cut", async () => {
    const scope = await setup();
    const publicUid = createUlid();
    const fixture = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      async function asset(projectId: string, sha256: string, license: string | null) {
        return tx.mediaAsset.create({ data: { organizationId: scope.organizationId, projectId, sha256,
          storageKey: createMediaKey(sha256), contentType: "image/jpeg", byteSize: 100,
          originalFileName: "synthetic-private-filename", source: "https://private.example.invalid/photo",
          rightsBasis: "LICENSED", license, uploadedBy: "synthetic-private-actor" } });
      }
      const own = await asset(scope.projectId, "a".repeat(64), "synthetic-private-license");
      const invalid = await asset(scope.projectId, "b".repeat(64), "synthetic");
      await tx.mediaAsset.update({ where: { id: invalid.id }, data: { storageKey: "synthetic-wrong-object-key" } });
      const foreign = await asset(scope.foreignProjectId, "c".repeat(64), "synthetic");
      async function agent(uid: string, data: Partial<Prisma.AgentUncheckedCreateInput>) {
        return tx.agent.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
          uid, slug: `synthetic-${uid}`, fullName: "synthetic-private-name", status: "ACTIVE", showOnSite: true,
          consentConfirmedAt: new Date(), consentConfirmedBy: "synthetic-private-actor",
          consentBasis: "synthetic-private-basis", photoMediaId: own.id, ...data } });
      }
      await agent(publicUid, { feedPhotoMediaId: own.id });
      await agent(createUlid(), { consentConfirmedAt: null });
      await agent(createUlid(), { showOnSite: false });
      await agent(createUlid(), { status: "DEPARTED" });
      await agent(createUlid(), { status: "HIDDEN" });
      const foreignUid = createUlid(); const invalidUid = createUlid();
      await agent(foreignUid, { photoMediaId: foreign.id });
      await agent(invalidUid, { photoMediaId: invalid.id });
      await agent(createUlid(), { projectId: scope.foreignProjectId });
      return { ownId: own.id, foreignUid, invalidUid };
    });
    async function capture(tx: DatabaseTransaction) {
      const rows: CanonicalJsonValue[] = [];
      const reader = createMediaSnapshotFactReader(tx, (_kind, page) => rows.push(...page));
      await reader.captureAgents(scope); reader.finishCapture(); return rows;
    }
    const pinned = await worker(scope, async (tx) => {
      const before = await capture(tx);
      expect(before).toHaveLength(4);
      for (const slot of ["photoMediaId", "feedPhotoMediaId"]) expect(before).toContainEqual(expect.objectContaining({
        kind: "AGENT_PHOTO", agentUid: publicUid, slot, asset: expect.objectContaining({ id: fixture.ownId }) }));
      for (const agentUid of [fixture.foreignUid, fixture.invalidUid]) expect(before).toContainEqual(
        expect.objectContaining({ agentUid, omission: "MEDIA_ASSET_UNAVAILABLE" }));
      expect(JSON.stringify(before)).not.toMatch(/https:|synthetic-private|fullName|consentBasis|consentConfirmedBy|license":/u);
      await runInPrincipalDatabaseTransaction(admin, (other) => other.agent.update({ where: { uid: publicUid },
        data: { consentConfirmedAt: null, version: { increment: 1 } } }));
      expect(await capture(tx)).toEqual(before);
      return before;
    });
    expect(await worker(scope, capture)).toHaveLength(2);
    expect(pinned).toHaveLength(4);
  });

  it("pins historical GOOD media assets and producer positions without foreign/future relations or remirror substitution", async () => {
    const scope = await setup();
    const uid = createUlid();
    const urls = ["a", "b", "a", "c", "d", "e"].map((name) => `https://example.invalid/private/${name}.jpg`);
    const fixture = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const source = await tx.source.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        sourceKey: "synthetic-media-input", name: "Synthetic media input", adapterKey: "yrl-realty-2010",
        adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
        datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" } } });
      const where = { organizationId: scope.organizationId, projectId: scope.projectId, sourceId: source.id };
      let previousRevisionId: string | null = null;
      async function good(sequence: number, externalId: string, inventoryUid: string, imageUrls: string[]) {
        const revision = await tx.sourceRevision.create({ data: { ...where, sourceVersion: source.version,
          adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey,
          profileVersion: source.profileVersion, baseLastGoodRevisionId: previousRevisionId,
          ...syntheticSafety(1, previousRevisionId ? 1 : null), recordCount: 1 } });
        await tx.sourceRevisionRecord.create({ data: { ...where, revisionId: revision.id, externalId, inventoryUid,
          orderKey: Buffer.from(externalId).toString("hex"), recordHash: "b".repeat(64),
          payload: { schemaVersion: 1, draft: { imageUrls, contactPhones: ["synthetic-private-phone"] }, rawRecord: { private: true } } } });
        await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence,
          rawStorageKey: `synthetic-private/${sequence}`, rawArtifactHash: "a".repeat(64), rawByteCount: 1,
          normalizedContentHash: "b".repeat(64), completedAt: new Date() } });
        await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
        previousRevisionId = revision.id;
        return revision.id;
      }
      const historical = await good(1, "kept", uid, urls);
      const head = await good(2, "new-only", createUlid(), []);
      const future = await good(3, "kept", uid, [urls[4]!]);
      await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: head } });
      await tx.inventoryIdentity.create({ data: { ...where, uid, externalOfferId: "kept", status: "ACTIVE",
        normalizedHash: "b".repeat(64), sourceHash: "d".repeat(64), firstSeenAt: new Date(), lastSeenAt: new Date(),
        missingGoodRuns: 1, missingSince: new Date() } });
      async function asset(projectId: string, sha256: string) {
        return tx.mediaAsset.create({ data: { organizationId: scope.organizationId, projectId, sha256,
          storageKey: createMediaKey(sha256), contentType: "image/jpeg", byteSize: 100, originalFileName: "synthetic-private.jpg",
          rightsBasis: "LICENSED", source: "synthetic-private-producer", license: "synthetic-private-license", uploadedBy: "synthetic-admin" } });
      }
      const first = await asset(scope.projectId, "a".repeat(64));
      const retained = await asset(scope.projectId, "c".repeat(64));
      const foreign = await asset(scope.foreignProjectId, "f".repeat(64));
      const relations = await Promise.all([0, 1, 3, 4, 5].map((index) => tx.mediaSource.create({ data: {
        ...where, sourceRevisionId: index === 4 ? future : historical, entityType: "INVENTORY", entityUid: uid,
        kind: "LISTING_IMAGE", position: 999, sourceUrl: urls[index]!, canonicalSourceUrl: urls[index]!,
        status: index === 1 || index === 3 ? "WARNING" : "MIRRORED",
        assetId: index === 3 ? null : index === 5 ? foreign.id : index === 1 ? retained.id : first.id,
        firstSeenAt: new Date(), lastAttemptAt: new Date(), mirroredAt: index === 3 ? null : new Date(),
      } })));
      return { sourceId: source.id, historical, head, firstAssetId: first.id, retainedAssetId: retained.id, firstRelationId: relations[0]!.id };
    });
    const pin = { sourceId: fixture.sourceId, inventoryUid: uid, externalOfferId: "kept", normalizedHash: "b".repeat(64),
      factRevisionId: fixture.historical, factRevisionSequence: 1, approvedHeadId: fixture.head, approvedHeadSequence: 2 };
    async function capture(tx: DatabaseTransaction) {
      const rows: CanonicalJsonValue[] = [];
      const reader = createMediaSnapshotFactReader(tx, (_kind, page) => rows.push(...page));
      await reader.captureInventory(scope, pin);
      reader.finishCapture();
      return rows;
    }
    const captured = await worker(scope, async (tx) => {
      const before = await capture(tx);
      expect(before).toHaveLength(6);
      for (const position of [0, 2]) expect(before[position]).toMatchObject({ position, asset: { id: fixture.firstAssetId, sha256: "a".repeat(64) } });
      expect(before[1]).toMatchObject({ position: 1, mirrorStatus: "WARNING", asset: { id: fixture.retainedAssetId } });
      for (const position of [3, 4, 5]) expect(before[position]).toMatchObject({ position, omission: "MEDIA_MIRROR_UNAVAILABLE" });
      expect(JSON.stringify(before)).not.toMatch(/https:|sourceUrl|originalFileName|synthetic-private|contactPhones|rawRecord/u);
      await runInPrincipalDatabaseTransaction(admin, (other) => other.mediaSource.update({ where: { id: fixture.firstRelationId },
        data: { assetId: fixture.retainedAssetId, sourceRevisionId: fixture.head, position: 7 } }));
      expect(await capture(tx)).toEqual(before);
      await expect(createMediaSnapshotFactReader(tx, () => undefined).captureInventory(scope, { ...pin, normalizedHash: "e".repeat(64) }))
        .rejects.toThrow("SNAPSHOT_INPUT_MEDIA_PIN_INVALID");
      await expect(createMediaSnapshotFactReader(tx, () => undefined).captureInventory({ organizationId: scope.organizationId,
        projectId: scope.foreignProjectId }, pin)).rejects.toThrow("SNAPSHOT_INPUT_MEDIA_PIN_INVALID");
      await expect(createMediaSnapshotFactReader(tx, () => undefined).captureInventory(scope,
        { ...pin, approvedHeadId: fixture.historical, approvedHeadSequence: 1 })).rejects.toThrow("SNAPSHOT_INPUT_MEDIA_PIN_INVALID");
      return before;
    });
    expect(captured[0]).toMatchObject({ asset: { sha256: "a".repeat(64) } });
    const fresh = await worker(scope, capture);
    expect(fresh[0]).toMatchObject({ omission: "MEDIA_MIRROR_UNAVAILABLE" });
    expect(captured[0]).toMatchObject({ asset: { sha256: "a".repeat(64) } });
  });

  it("captures scoped project facts in one cut and omits unconsented agents and admin metadata", async () => {
    const scope = await setup();
    const publicUid = createUlid();
    const historicalRedirectDate = new Date("2026-09-01T00:00:00.000Z");
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      await tx.project.update({ where: { id: scope.projectId }, data: { notes: "synthetic-private-notes" } });
      await tx.projectPublicContact.create({ data: { organizationId: scope.organizationId,
        projectId: scope.projectId, phone: "+70000000001", messengers: [] } });
      await tx.publicUrlIdReservation.create({ data: { organizationId: scope.organizationId,
        projectId: scope.projectId, subjectType: "AGENT", subjectUid: publicUid, publicUrlId: "1234567890123456" } });
      const entrySubject = createUlid();
      const entryReservation = await tx.publicUrlIdReservation.create({ data: { organizationId: scope.organizationId,
        projectId: scope.projectId, subjectType: "AGENT", subjectUid: entrySubject, publicUrlId: "1234567890123457" } });
      const entry = await tx.projectUrlEntry.create({ data: { organizationId: scope.organizationId,
        projectId: scope.projectId, entityType: "AGENT", entityUid: entrySubject, reservationId: entryReservation.id,
        slug: "synthetic-entry", canonicalPath: "/agents/synthetic-entry" } });
      await tx.projectRedirect.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        urlEntryId: entry.id, fromPath: "/agents/old-synthetic-entry", toPath: entry.canonicalPath,
        reason: "SLUG_CHANGE", createdAt: historicalRedirectDate } });
      await tx.entityEditorial.create({ data: { organizationId: scope.organizationId,
        projectId: scope.projectId, entityType: "AGENT", entityUid: publicUid, faq: [],
        shortDescription: "Synthetic public description", presentationNotes: "synthetic-private-editorial-notes" } });
      await tx.agent.createMany({ data: [
        { organizationId: scope.organizationId, projectId: scope.projectId, uid: publicUid,
          slug: "public-synthetic", fullName: "Synthetic approved", showOnSite: true,
          consentConfirmedAt: new Date(), consentConfirmedBy: "synthetic-private-actor", consentBasis: "synthetic-private-basis" },
        { organizationId: scope.organizationId, projectId: scope.projectId, uid: createUlid(),
          slug: "no-consent", fullName: "synthetic-private-name", showOnSite: true },
        { organizationId: scope.organizationId, projectId: scope.foreignProjectId, uid: createUlid(),
          slug: "foreign", fullName: "synthetic-foreign-name", showOnSite: true, consentConfirmedAt: new Date() },
      ] });
    });
    async function capture(tx: DatabaseTransaction) {
      const rows = new Map<string, CanonicalJsonValue[]>();
      const revision = await createProjectStateSnapshotFactReader(tx).capture(scope,
        (kind, page) => rows.set(kind, [...(rows.get(kind) ?? []), ...page]));
      return { revision, rows };
    }
    await worker(scope, async (tx) => {
      const before = await capture(tx);
      expect(before.rows.get("agents")).toHaveLength(1);
      expect(before.rows.get("agents")![0]).toMatchObject({ uid: publicUid, fullName: "Synthetic approved" });
      expect(before.rows.get("contacts")![0]).toMatchObject({ phone: "+70000000001", version: 1 });
      expect(before.rows.size).toBe(11);
      expect(before.rows.get("urls")).toContainEqual(expect.objectContaining({ factType: "reservation",
        subjectUid: publicUid, publicUrlId: "1234567890123456" }));
      expect(before.rows.get("redirects")![0]).toMatchObject({ createdAt: historicalRedirectDate.toISOString() });
      expect(before.rows.get("editorial")![0]).toMatchObject({ shortDescription: "Synthetic public description" });
      const serialized = JSON.stringify([...before.rows]);
      for (const forbidden of ["synthetic-private-notes", "synthetic-private-actor", "synthetic-private-basis",
        "synthetic-private-name", "synthetic-foreign-name", "synthetic-private-editorial-notes",
        "presentationNotes", "consentConfirmedBy", "consentBasis"]) {
        expect(serialized).not.toContain(forbidden);
      }
      await runInPrincipalDatabaseTransaction(admin, async (other) => {
        await other.projectPublicContact.update({ where: { organizationId_projectId: {
          organizationId: scope.organizationId, projectId: scope.projectId } },
        data: { phone: "+70000000002", version: { increment: 1 } } });
        await other.agent.update({ where: { uid: publicUid }, data: { showOnSite: false, version: { increment: 1 } } });
      });
      expect(await capture(tx)).toEqual(before);
      await expect(createProjectStateSnapshotFactReader(tx).capture({ organizationId: scope.organizationId,
        projectId: scope.foreignProjectId }, () => undefined)).rejects.toThrow("SNAPSHOT_INPUT_PROJECT_MISSING");
    });
    const fresh = await worker(scope, capture);
    expect(fresh.rows.get("agents")).toEqual([]);
    expect(fresh.rows.get("contacts")![0]).toMatchObject({ phone: "+70000000002", version: 2 });
  });

  it("reserves above existing publication, saves immutable complete input, and replays identical receipt", async () => {
    const scope = await setup();
    await runInPrincipalDatabaseTransaction(admin, (tx) => tx.projectCurrentSnapshotManifest.create({ data: {
      organizationId: scope.organizationId, projectId: scope.projectId, publishSequence: 7,
      manifestKey: "synthetic-manifest", manifestSha256: "a".repeat(64), publishedAt: new Date(),
    } }));
    const request = snapshotInputRequestSchema.parse({
      organizationId: scope.organizationId, projectId: scope.projectId, idempotencyKey: "synthetic-capture" });
    const hashes = snapshotInputRequestHashes(request);
    const receipt = await worker(scope, async (tx) => {
      const repository = new PrismaSnapshotInputRepository(tx);
      await repository.lockProject(scope.organizationId, scope.projectId);
      expect(await repository.find(scope.organizationId, scope.projectId, hashes.idempotencyKeyHash, hashes.requestHash)).toBeNull();
      const publishSequence = await repository.reserveSequence(scope.organizationId, scope.projectId);
      expect(publishSequence).toBe(8);
      return repository.save({ organizationId: scope.organizationId, projectId: scope.projectId, ...hashes,
        inputSchemaVersion: 1, projectorVersion: "db-v1", schemaMinor: 0, publishSequence,
        projectStateRevision: 1, catalogRevision: snapshotInputHash([{ uid: "synthetic", version: 1 }]),
        capturedAt: new Date("2026-10-06T00:00:00.000Z"), parts: parts() });
    });
    await worker(scope, async (tx) => {
      const repository = new PrismaSnapshotInputRepository(tx);
      expect(await repository.find(scope.organizationId, scope.projectId, hashes.idempotencyKeyHash, hashes.requestHash)).toEqual(receipt);
      const sizeChecks = await tx.$queryRaw<{ valid: boolean }[]>`
        SELECT bool_and("payloadByteCount" = octet_length("payload"::text)
          AND "payloadRecordCount" = jsonb_array_length("payload")) AS valid
        FROM "SnapshotBuildInputPart" WHERE "buildInputId" = ${receipt.id}`;
      expect(sizeChecks).toEqual([{ valid: true }]);
      expect(await repository.find(scope.organizationId, scope.foreignProjectId, hashes.idempotencyKeyHash, hashes.requestHash)).toBeNull();
    });
    await expect(worker(scope, (tx) => new PrismaSnapshotInputRepository(tx).find(scope.organizationId,
      scope.projectId, hashes.idempotencyKeyHash, "b".repeat(64)))).rejects.toThrow("SNAPSHOT_INPUT_IDEMPOTENCY_CONFLICT");
    await expect(worker(scope, (tx) => tx.snapshotBuildInputPart.create({ data: {
      organizationId: scope.organizationId, projectId: scope.projectId, buildInputId: receipt.id,
      kind: "catalog", partIndex: 1, payloadHash: snapshotInputHash([]), payload: [],
    } }))).rejects.toThrow("SNAPSHOT_INPUT_CAPTURE_CLOSED");
    await expect(worker(scope, (tx) => tx.$executeRawUnsafe('UPDATE "SnapshotBuildInput" SET "schemaMinor" = 1'))).rejects.toThrow();
    await expect(worker(scope, (tx) => tx.projectSnapshotSequence.update({
      where: { organizationId_projectId: { organizationId: scope.organizationId, projectId: scope.projectId } },
      data: { lastReservedSequence: 1 },
    }))).rejects.toThrow("SNAPSHOT_SEQUENCE_NOT_INCREASING");
    await worker(scope, async (tx) => {
      const repository = new PrismaSnapshotInputRepository(tx);
      await repository.lockProject(scope.organizationId, scope.projectId);
      expect(await repository.reserveSequence(scope.organizationId, scope.projectId)).toBe(9);
    });
  });

  it("rolls back sequence and receipt when capture fails before commit", async () => {
    const scope = await setup();
    await expect(worker(scope, async (tx) => {
      const repository = new PrismaSnapshotInputRepository(tx);
      await repository.lockProject(scope.organizationId, scope.projectId);
      expect(await repository.reserveSequence(scope.organizationId, scope.projectId)).toBe(1);
      throw new Error("SYNTHETIC_CAPTURE_FAILURE");
    })).rejects.toThrow("SYNTHETIC_CAPTURE_FAILURE");
    await worker(scope, async (tx) => {
      expect(await tx.projectSnapshotSequence.count()).toBe(0);
      expect(await tx.snapshotBuildInput.count()).toBe(0);
      expect(await tx.snapshotBuildInputPart.count()).toBe(0);
    });
    await expect(worker(scope, (tx) => new PrismaSnapshotInputRepository(tx).reserveSequence(
      scope.organizationId, scope.foreignProjectId))).rejects.toThrow();
  });

  it("enforces complete sections at DB commit, not merely through the TypeScript builder", async () => {
    const scope = await setup();
    await expect(worker(scope, async (tx) => {
      const sequence = await new PrismaSnapshotInputRepository(tx).reserveSequence(scope.organizationId, scope.projectId);
      await tx.snapshotBuildInput.create({ data: {
        organizationId: scope.organizationId, projectId: scope.projectId,
        idempotencyKeyHash: "a".repeat(64), requestHash: "b".repeat(64), inputSchemaVersion: 1,
        projectorVersion: "db-v1", schemaMinor: 0, publishSequence: sequence, projectStateRevision: 1,
        catalogRevision: "c".repeat(64), inputHash: "d".repeat(64), capturedAt: new Date(),
      } });
    })).rejects.toThrow("SNAPSHOT_INPUT_INCOMPLETE");
    await worker(scope, async (tx) => {
      expect(await tx.snapshotBuildInput.count()).toBe(0);
      expect(await tx.projectSnapshotSequence.count()).toBe(0);
    });
  });

  it("rejects a late gap even after the header constraint was made immediate", async () => {
    const scope = await setup();
    await expect(worker(scope, async (tx) => {
      const repository = new PrismaSnapshotInputRepository(tx);
      const publishSequence = await repository.reserveSequence(scope.organizationId, scope.projectId);
      const receipt = await repository.save({ organizationId: scope.organizationId, projectId: scope.projectId,
        idempotencyKeyHash: "a".repeat(64), requestHash: "b".repeat(64), inputSchemaVersion: 1,
        projectorVersion: "db-v1", schemaMinor: 0, publishSequence, projectStateRevision: 1,
        catalogRevision: "c".repeat(64), capturedAt: new Date(), parts: parts() });
      await tx.$executeRawUnsafe('SET CONSTRAINTS "SnapshotBuildInput_complete" IMMEDIATE');
      await tx.snapshotBuildInputPart.create({ data: {
        organizationId: scope.organizationId, projectId: scope.projectId, buildInputId: receipt.id,
        kind: "catalog", partIndex: 99, payload: [], payloadHash: snapshotInputHash([]),
      } });
    })).rejects.toThrow("SNAPSHOT_INPUT_INCOMPLETE");
    await worker(scope, async (tx) => {
      expect(await tx.snapshotBuildInput.count()).toBe(0);
      expect(await tx.projectSnapshotSequence.count()).toBe(0);
    });
  });

  it("rejects forged generated sizes and late record overflow after an immediate header check", async () => {
    const scope = await setup();
    for (const attempt of ["forge", "overflow"] as const) {
      await expect(worker(scope, async (tx) => {
        const repository = new PrismaSnapshotInputRepository(tx);
        const publishSequence = await repository.reserveSequence(scope.organizationId, scope.projectId);
        const receipt = await repository.save({ organizationId: scope.organizationId, projectId: scope.projectId,
          idempotencyKeyHash: "a".repeat(64), requestHash: "b".repeat(64), inputSchemaVersion: 1,
          projectorVersion: "db-v1", schemaMinor: 0, publishSequence, projectStateRevision: 1,
          catalogRevision: "c".repeat(64), capturedAt: new Date(), parts: parts() });
        await tx.$executeRawUnsafe('SET CONSTRAINTS "SnapshotBuildInput_complete" IMMEDIATE');
        if (attempt === "forge") {
          await tx.snapshotBuildInputPart.create({ data: {
            organizationId: scope.organizationId, projectId: scope.projectId, buildInputId: receipt.id,
            kind: "catalog", partIndex: 1, payload: [], payloadHash: snapshotInputHash([]),
            payloadByteCount: 0, payloadRecordCount: 0,
          } });
        } else {
          const payload = Array.from({ length: 50001 }, () => null);
          await tx.snapshotBuildInputPart.create({ data: {
            organizationId: scope.organizationId, projectId: scope.projectId, buildInputId: receipt.id,
            kind: "catalog", partIndex: 1, payload, payloadHash: snapshotInputHash(payload),
          } });
        }
      })).rejects.toThrow(attempt === "forge" ? /428C9/ : "SNAPSHOT_INPUT_LIMIT_EXCEEDED");
      await worker(scope, async (tx) => {
        expect(await tx.snapshotBuildInput.count()).toBe(0);
        expect(await tx.snapshotBuildInputPart.count()).toBe(0);
        expect(await tx.projectSnapshotSequence.count()).toBe(0);
      });
    }
  });

  it("reads a bounded catalog closure in the caller's single cut, not another tenant subscription", async () => {
    const scope = await setup();
    const uid = createUlid();
    const developerUid = createUlid();
    const cityUid = "01M41T6Q04BADHXSERJHZFXKCH";
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const developerName = `Synthetic developer ${developerUid}`;
      await tx.developer.create({ data: { uid: developerUid, name: developerName, normalizedName: developerName.toLowerCase() } });
      await tx.development.create({ data: { uid, developerUid, cityUid, name: "Captured name", normalizedName: "captured name" } });
      await tx.projectCatalogSubscription.create({ data: {
        organizationId: scope.organizationId, projectId: scope.projectId, mode: "ALL_SHARED",
        cities: { create: { cityUid } },
      } });
    });
    await worker(scope, async (tx) => {
      const capture = async () => {
        const values: CanonicalJsonValue[] = [];
        await createCatalogSnapshotFactReader(tx).captureCandidates(scope, [], (_kind, rows) => { values.push(...rows); });
        return values;
      };
      const first = await capture();
      expect(first).toContainEqual(expect.objectContaining({ entityType: "development", uid, name: "Captured name" }));
      await runInPrincipalDatabaseTransaction(admin, (otherTx) => otherTx.development.update({ where: { uid }, data: {
        name: "Changed after cut", normalizedName: "changed after cut",
      } }));
      expect(await capture()).toEqual(first);
      await expect(createCatalogSnapshotFactReader(tx).captureCandidates({ organizationId: scope.organizationId,
        projectId: scope.foreignProjectId }, [], () => undefined)).rejects.toThrow("SHARED_CATALOG_SUBSCRIPTION_NOT_FOUND");
    });
    await worker(scope, async (tx) => {
      const values: CanonicalJsonValue[] = [];
      await createCatalogSnapshotFactReader(tx).captureCandidates(scope, [], (_kind, rows) => { values.push(...rows); });
      expect(values).toContainEqual(expect.objectContaining({ entityType: "development", uid, name: "Changed after cut" }));
    });
  });

  it("pins paged own-project price/media observations without importing foreign facts or producer URLs", async () => {
    const scope = await setup();
    const developmentUid = createUlid();
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const developerUid = createUlid();
      const name = `Synthetic observation developer ${developerUid}`;
      await tx.developer.create({ data: { uid: developerUid, name, normalizedName: name.toLowerCase() } });
      await tx.development.create({ data: { uid: developmentUid, developerUid,
        cityUid: "01M41T6Q04BADHXSERJHZFXKCH", name: "Observation cohort", normalizedName: "observation cohort" } });
      for (const projectId of [scope.projectId, scope.foreignProjectId]) {
        const source = await tx.source.create({ data: { organizationId: scope.organizationId, projectId,
          sourceKey: "synthetic-observations", name: "Synthetic observations", adapterKey: "yrl-realty-2010",
          adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
          datasetType: "NEW_BUILD", schedulePolicy: { mode: "MANUAL_ONLY" } } });
        await tx.priceObservation.createMany({ data: Array.from({ length: 202 }, (_, index) => ({
          organizationId: scope.organizationId, projectId, sourceId: source.id, developmentUid,
          externalId: `synthetic-${index}`, amount: "100.25", currency: "RUB", observedAt: new Date("2026-10-01T00:00:00Z"),
        })) });
        await tx.sharedMediaAsset.createMany({ data: Array.from({ length: 201 }, (_, position) => ({
          organizationId: scope.organizationId, projectId, sourceId: source.id, developmentUid,
          externalId: `synthetic-image-${position}`, position, sourceUrl: `https://example.invalid/private/${position}.jpg`,
          canonicalSourceUrl: `https://example.invalid/private/${position}.jpg`, rightsBasis: "LICENSED" as const,
          license: "synthetic-private-license", attribution: "synthetic-private-attribution", observedAt: new Date(),
        })) });
      }
    });
    await worker(scope, async (tx) => {
      const capture = async () => {
        const values = new Map<string, CanonicalJsonValue[]>();
        await createCatalogSnapshotFactReader(tx).captureObservations(scope, [developmentUid], (kind, rows) => {
          expect(rows.length).toBeLessThanOrEqual(200);
          values.set(kind, [...(values.get(kind) ?? []), ...rows]);
        });
        return values;
      };
      const before = await capture();
      expect(before.get("prices")).toHaveLength(202);
      expect(before.get("shared-media")).toHaveLength(201);
      expect(before.get("prices")![0]).toMatchObject({ amount: "100.25", currency: "RUB" });
      expect(before.get("shared-media")![0]).toMatchObject({ hasLicense: true, hasAttribution: true,
        canonicalUrlHash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
      expect(JSON.stringify([...before])).not.toMatch(/https:|sourceUrl|canonicalSourceUrl|synthetic-private-license|synthetic-private-attribution/u);
      expect(await tx.priceObservation.updateMany({ where: { developmentUid }, data: { amount: "1.00" } })).toMatchObject({ count: 0 });
      expect(await tx.sharedMediaAsset.updateMany({ where: { developmentUid }, data: { position: 999 } })).toMatchObject({ count: 0 });
      await runInPrincipalDatabaseTransaction(admin, (other) => other.priceObservation.updateMany({
        where: { organizationId: scope.organizationId, projectId: scope.projectId }, data: { amount: "200.50" } }));
      expect(await capture()).toEqual(before);
      const foreign: CanonicalJsonValue[] = [];
      await createCatalogSnapshotFactReader(tx).captureObservations({ organizationId: scope.organizationId,
        projectId: scope.foreignProjectId }, [developmentUid], (_kind, rows) => foreign.push(...rows));
      expect(foreign).toEqual([]);
      await expect(createCatalogSnapshotFactReader(tx).captureObservations(scope,
        Array.from({ length: 5001 }, () => developmentUid), () => undefined)).rejects.toThrow("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
    });
    await runInAuthorizedDatabaseTransaction({ principalKind: "project-job", actorId: "source-import",
      organizationId: scope.organizationId, projectIds: [scope.projectId], correlationId: randomUUID() }, async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
      expect(await tx.priceObservation.updateMany({ where: { developmentUid }, data: { amount: "300.75" } })).toMatchObject({ count: 202 });
    });
    await expect(worker(scope, async (tx) => {
      const existing = await tx.priceObservation.findFirstOrThrow({ where: { developmentUid },
        orderBy: { id: "asc" }, select: { sourceId: true, externalId: true, observedAt: true, basis: true } });
      const key = { organizationId: scope.organizationId, projectId: scope.projectId, ...existing };
      return tx.priceObservation.upsert({ where: { organizationId_projectId_sourceId_externalId_observedAt_basis: key },
        create: { ...key, developmentUid, amount: "999.00", currency: "RUB" }, update: { amount: "999.00" } });
    })).rejects.toThrow();
    await expect(worker(scope, (tx) => tx.priceObservation.deleteMany({ where: { developmentUid } }))).rejects.toThrow();
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      expect(await tx.priceObservation.count({ where: { organizationId: scope.organizationId, projectId: scope.projectId,
        developmentUid, amount: "300.75" } })).toBe(202);
    });
  });

  it("enforces read-only fact purpose independently of scope shape and legacy job representation", async () => {
    const scope = await setup();
    const asset = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      await tx.projectCurrentSnapshotManifest.create({ data: { organizationId: scope.organizationId,
        projectId: scope.projectId, publishSequence: 1, manifestKey: "synthetic-current", manifestSha256: "a".repeat(64), publishedAt: new Date() } });
      return tx.mediaAsset.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        sha256: "b".repeat(64), storageKey: "synthetic-private-media", contentType: "image/jpeg", byteSize: 100,
        originalFileName: "synthetic.jpg", rightsBasis: "OWNED", source: "synthetic", uploadedBy: "synthetic-admin" } });
    });
    for (const principalKind of ["project-job", "job"] as const) {
      for (const projectIds of [[scope.projectId], ["*"], [scope.projectId, scope.foreignProjectId], []]) {
        await runInAuthorizedDatabaseTransaction({ principalKind, actorId: "snapshot-input",
          organizationId: scope.organizationId, projectIds, correlationId: randomUUID() }, async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
          expect(await tx.$queryRawUnsafe<{ allowed: boolean }[]>("SELECT snapshot_fact_write_allowed() AS allowed"))
            .toEqual([{ allowed: false }]);
          expect(await tx.projectCurrentSnapshotManifest.updateMany({ data: { publishSequence: 999 } })).toMatchObject({ count: 0 });
        });
      }
    }
    await expect(worker(scope, (tx) => tx.mediaAsset.updateMany({ where: { id: asset.id }, data: { byteSize: 999 } })))
      .rejects.toThrow();
    const deniedAsset = { organizationId: scope.organizationId,
      projectId: scope.projectId, sha256: "c".repeat(64), storageKey: "synthetic-other-media", contentType: "image/jpeg",
      byteSize: 100, originalFileName: "synthetic.jpg", rightsBasis: "OWNED" as const, source: "synthetic", uploadedBy: "synthetic-admin" };
    await expect(worker(scope, (tx) => tx.mediaAsset.create({ data: deniedAsset }))).rejects.toThrow();
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      expect(await tx.mediaAsset.findUnique({ where: { id: asset.id }, select: { byteSize: true } })).toEqual({ byteSize: 100 });
      expect(await tx.mediaAsset.count({ where: { projectId: scope.projectId, sha256: deniedAsset.sha256 } })).toBe(0);
      // The exact same valid input succeeds for its legitimate administrative owner.
      expect(await tx.mediaAsset.create({ data: deniedAsset, select: { byteSize: true } })).toEqual({ byteSize: 100 });
    });
    await worker(scope, async (tx) => {
      const policies = await tx.$queryRawUnsafe<{ tablename: string; cmd: string; permissive: string }[]>(
        "SELECT tablename, cmd, permissive FROM pg_policies WHERE policyname LIKE '%_snapshot_fact_no_%'");
      for (const table of ["PriceObservation", "SharedMediaAsset", "DevelopmentExternalIdentity", "MediaSource", "MediaAsset",
        "InventoryIdentity", "InventoryLifecycleEvent", "ProjectCurrentSnapshotManifest", "DeliveryRun", "SourceRevisionRecord"]) {
        expect(policies.filter((policy) => policy.tablename === table)).toEqual(expect.arrayContaining(
          ["INSERT", "UPDATE", "DELETE"].map((cmd) => ({ tablename: table, cmd, permissive: "RESTRICTIVE" }))));
      }
    });
  });

  it("pins the historical GOOD fact still backing an ACTIVE grace identity, without raw payload or write rights", async () => {
    const scope = await setup();
    const uid = createUlid();
    const draft = { externalId: "kept", sourceFormat: "YRL_2010", propertyType: "APARTMENT", transactionType: "SALE",
      title: "Synthetic pinned historical title", address: "Synthetic City, house 9, 42",
      contactPhones: ["synthetic-private-only"], imageUrls: [], provenance: {} };
    const fields = { text: "", attributes: {}, children: { "|rooms": [{ text: 2, attributes: {}, children: {} }],
      "|location": [{ text: "", attributes: {}, children: { "|apartment": [{ text: "42", attributes: {}, children: {} }] } }] } };
    const historicalHash = normalizedContentHash({ draft: { ...draft, provenance: undefined }, fields });
    const fixtures = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const source = await tx.source.create({ data: {
        organizationId: scope.organizationId, projectId: scope.projectId, sourceKey: "synthetic-input",
        name: "Synthetic input source", adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0",
        profileKey: "vladis-vt24-v1", profileVersion: "1.0.0", datasetType: "RESALE",
        schedulePolicy: { mode: "MANUAL_ONLY" }, enabled: true,
      } });
      const target = { organizationId: scope.organizationId, projectId: scope.projectId, sourceId: source.id };
      let previousRevisionId: string | null = null;
      const good = async (sequence: number, externalId: string, inventoryUid: string, recordHash: string) => {
        const revision = await tx.sourceRevision.create({ data: { ...target, sourceVersion: source.version,
          adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey,
          profileVersion: source.profileVersion, baseLastGoodRevisionId: previousRevisionId,
          ...syntheticSafety(1, previousRevisionId ? 1 : null), recordCount: 1,
        } });
        await tx.sourceRevisionRecord.create({ data: { ...target, revisionId: revision.id,
          externalId, orderKey: Buffer.from(externalId).toString("hex"), inventoryUid, recordHash,
          payload: { schemaVersion: 1, draft: { ...draft, externalId }, rawRecord: { marker: "private" }, fields },
        } });
        await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED",
          rawStorageKey: `private-synthetic/${sequence}`, rawArtifactHash: "a".repeat(64), rawByteCount: 1,
          normalizedContentHash: recordHash, sequence, completedAt: new Date(),
        } });
        await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
        previousRevisionId = revision.id;
        return revision.id;
      };
      const historical = await good(1, "kept", uid, historicalHash);
      const head = await good(2, "new-only", createUlid(), "c".repeat(64));
      await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: head } });
      await tx.inventoryIdentity.create({ data: { ...target, uid, externalOfferId: "kept", status: "ACTIVE",
        sourceHash: "d".repeat(64), normalizedHash: historicalHash, firstSeenAt: new Date(), lastSeenAt: new Date(),
        missingGoodRuns: 1, missingSince: new Date(),
      } });
      const reservation = await tx.publicUrlIdReservation.create({ data: { organizationId: scope.organizationId,
        projectId: scope.projectId, subjectType: "INVENTORY", subjectUid: uid, publicUrlId: "1234567890123456" } });
      await tx.projectUrlEntry.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        entityType: "INVENTORY", entityUid: uid, reservationId: reservation.id, slug: "synthetic-kept", canonicalPath: "/inventory/synthetic-kept" } });
      await tx.sourceRevision.create({ data: { ...target, sourceVersion: source.version, adapterKey: source.adapterKey,
        adapterVersion: source.adapterVersion, profileKey: source.profileKey, profileVersion: source.profileVersion, safetyPolicy: {},
      } });
      return { sourceId: source.id, historical, head };
    });
    const captured = await worker(scope, async (tx) => {
      const inventory: CanonicalJsonValue[] = [];
      const sources: CanonicalJsonValue[] = [];
      await createSourceSnapshotFactReader(tx).capture(scope, (kind, rows) => {
        (kind === "inventory" ? inventory : sources).push(...rows);
      });
      expect(inventory).toHaveLength(1);
      expect(inventory[0]).toMatchObject({ uid, approvedHeadId: fixtures.head, approvedHeadSequence: 2,
        factRevisionId: fixtures.historical, factRevisionSequence: 1, factProfileIdentity: "vladis-vt24-v1@1.0.0",
        factApproval: { disposition: "SAFE", sourceId: fixtures.sourceId, revisionId: fixtures.historical,
          sequence: 1, baseRevisionId: null, previousGoodRecordCount: null } });
      expect(sources).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: "source",
        approvedHead: expect.objectContaining({ id: fixtures.head, approval: expect.objectContaining({
          disposition: "SAFE", sourceId: fixtures.sourceId, revisionId: fixtures.head, sequence: 2,
          baseRevisionId: fixtures.historical, previousGoodRecordCount: 1 }) }) })]));
      expect(sources.filter((value) => typeof value === "object" && value !== null && !Array.isArray(value)
        && value.entityType === "profile")).toHaveLength(1);
      expect(JSON.stringify({ inventory, sources })).not.toMatch(/rawRecord|contactPhones|rawStorageKey|synthetic-private-only/u);
      expect(await tx.sourceRevision.count()).toBe(2);
      expect(await tx.sourceRevision.updateMany({ where: { id: fixtures.head }, data: { failedStage: "DENIED" } })).toMatchObject({ count: 0 });
      const foreign: CanonicalJsonValue[] = [];
      await createSourceSnapshotFactReader(tx).capture({ organizationId: scope.organizationId, projectId: scope.foreignProjectId },
        (_kind, rows) => { foreign.push(...rows); });
      expect(foreign).toEqual([]);
      const profile = sources.find((value) => value !== null && typeof value === "object" && !Array.isArray(value) && value.entityType === "profile");
      const entry = await tx.projectUrlEntry.findFirstOrThrow({ where: { organizationId: scope.organizationId, projectId: scope.projectId,
        entityType: "INVENTORY", entityUid: uid }, select: { entityType: true, entityUid: true, reservation: { select: { publicUrlId: true } } } });
      return { identity: inventory[0] as unknown as SnapshotInventoryProjectionInput["identity"],
        profile: profile as unknown as SnapshotInventoryProjectionInput["profile"],
        url: { entityType: "INVENTORY" as const, entityUid: entry.entityUid, publicUrlId: entry.reservation.publicUrlId } };
    });
    const pin: SnapshotGoodFactPin = { uid, sourceId: fixtures.sourceId, externalOfferId: "kept", normalizedHash: historicalHash,
      factRevisionId: fixtures.historical, factRevisionSequence: 1, factProfileKey: "vladis-vt24-v1", factProfileVersion: "1.0.0" };
    const profiles = new Map([["vladis-vt24-v1@1.0.0", { identity: "vladis-vt24-v1@1.0.0", caseSensitiveTags: true, fieldMappings: [] }]]);
    const pinned = await worker(scope, (tx) => createSnapshotGoodFactResolver(tx)(scope, [pin], profiles));
    expect(pinned).toEqual([{ inventoryUid: uid, sourceId: fixtures.sourceId, externalOfferId: "kept", normalizedHash: historicalHash,
      factProfileIdentity: "vladis-vt24-v1@1.0.0", draft: { sourceFormat: "YRL_2010", propertyType: "APARTMENT", transactionType: "SALE",
      title: "Synthetic pinned historical title" }, fieldValues: { rooms: [2] }, addressPublic: "Synthetic City, house 9" }]);
    expect(pinned[0]!.draft).not.toHaveProperty("address");
    expect(pinned[0]!.fieldValues).not.toHaveProperty("location/apartment");
    const projectedInventory = projectSnapshotInventory(scope, [{ ...captured, fact: pinned[0]!, media: [] }]);
    expect(projectedInventory.records[0]!.value).toMatchObject({ uid, publicUrlId: "1234567890123456",
      address: { addressPublic: "Synthetic City, house 9" }, facts: { rooms: { state: "VALUE", value: 2 } }, locationPrecision: "STREET" });
    expect(JSON.stringify(projectedInventory)).not.toMatch(/synthetic-private-only|externalOfferId|normalizedHash|sourceId/u);
    expect(JSON.stringify(pinned)).not.toMatch(/contactPhones|rawRecord|provenance|synthetic-private-only|externalId/u);
    await expect(worker(scope, (tx) => createSnapshotGoodFactResolver(tx)({ organizationId: scope.organizationId,
      projectId: scope.foreignProjectId }, [pin], profiles))).rejects.toThrow("SNAPSHOT_GOOD_FACT_MISSING");
    await expect(worker(scope, (tx) => createSnapshotGoodFactResolver(tx)(scope,
      [{ ...pin, factRevisionSequence: 2 }], profiles))).rejects.toThrow("SNAPSHOT_GOOD_FACT_MISSING");
    await expect(worker(scope, (tx) => createSnapshotGoodFactResolver(tx)(scope,
      [{ ...pin, normalizedHash: "a".repeat(64) }], profiles))).rejects.toThrow("SNAPSHOT_GOOD_FACT_MISSING");
    await expect(worker(scope, (tx) => createSnapshotGoodFactResolver(tx)(scope,
      [{ ...pin, factProfileVersion: "foreign" }], profiles))).rejects.toThrow("SNAPSHOT_GOOD_FACT_MISSING");
    await runInPrincipalDatabaseTransaction(admin, (tx) => tx.source.update({ where: { id: fixtures.sourceId },
      data: { enabled: false, profileKey: "joywork-yandex-realty-v1" } }));
    const replayedFacts = await worker(scope, (tx) => createSnapshotGoodFactResolver(tx)(scope, [pin], profiles));
    expect(replayedFacts).toEqual(pinned);
    expect(projectSnapshotInventory(scope, [{ ...captured, fact: replayedFacts[0]!, media: [] }])).toEqual(projectedInventory);
    await runInPrincipalDatabaseTransaction(admin, (tx) => tx.inventoryIdentity.update({ where: { uid }, data: { normalizedHash: "e".repeat(64) } }));
    await expect(worker(scope, (tx) => createSourceSnapshotFactReader(tx).capture(scope, () => undefined)))
      .rejects.toThrow("SNAPSHOT_INPUT_INVENTORY_FACT_MISSING");
  });

  it("rejects malformed GOOD components in SQL without transferring their large siblings", async () => {
    const scope = await setup();
    const fixtures = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const source = await tx.source.create({ data: { organizationId: scope.organizationId, projectId: scope.projectId,
        sourceKey: "synthetic-malformed", name: "Synthetic malformed", adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0",
        profileKey: "synthetic-captured-only", profileVersion: "1", datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" } } });
      const target = { organizationId: scope.organizationId, projectId: scope.projectId, sourceId: source.id };
      const pins: SnapshotGoodFactPin[] = [];
      const goodFields = { text: "", attributes: {}, children: {} };
      const goodDraft = { externalId: "bad-4", sourceFormat: "YRL_2010", propertyType: "APARTMENT", transactionType: "SALE" };
      const payloads: Prisma.InputJsonObject[] = [
        { schemaVersion: 1, draft: { description: "x".repeat(200000) } },
        { schemaVersion: 1, draft: { description: "x".repeat(200000) }, fields: null },
        { schemaVersion: 1, fields: { text: "x".repeat(200000) } },
        { schemaVersion: 1, draft: null, fields: { text: "x".repeat(200000) } },
        { schemaVersion: 1, draft: goodDraft, fields: goodFields },
        { schemaVersion: 1, draft: { ...goodDraft, externalId: "bad-5" }, fields: goodFields },
        { schemaVersion: 1, draft: { ...goodDraft, externalId: "bad-6", address: "City user＠example.invalid" }, fields: goodFields },
        { schemaVersion: 1, draft: { ...goodDraft, externalId: "bad-7", address: "City, house 9, apt. 42 / 43" },
          fields: { ...goodFields, children: { "|location": [{ ...goodFields,
            children: { "|apartment": [{ ...goodFields, text: "42/43" }] } }] } } },
        { schemaVersion: 1, draft: { ...goodDraft, externalId: "bad-8", address: "City, house 9, aptA12 / B13" },
          fields: { ...goodFields, children: { "|location": [{ ...goodFields,
            children: { "|apartment": [{ ...goodFields, text: "A12/B13" }] } }] } } },
      ];
      for (const [index, payload] of payloads.entries()) {
        const revision = await tx.sourceRevision.create({ data: { ...target, sourceVersion: source.version,
          adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey,
          profileVersion: source.profileVersion, safetyPolicy: {}, recordCount: 1 } });
        const uid = createUlid(); const externalId = `bad-${index}`;
        const recordHash = index === 4 || index >= 6
          ? normalizedContentHash({ draft: payload.draft, fields: payload.fields }) : "a".repeat(64);
        await tx.sourceRevisionRecord.create({ data: { ...target, revisionId: revision.id, inventoryUid: uid,
          externalId, orderKey: Buffer.from(externalId).toString("hex"), recordHash, payload } });
        await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence: index + 1,
          rawStorageKey: `synthetic-private/${index}`, rawArtifactHash: "b".repeat(64), rawByteCount: 1,
          normalizedContentHash: recordHash, completedAt: new Date() } });
        await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
        pins.push({ uid, sourceId: source.id, externalOfferId: externalId, normalizedHash: recordHash,
          factRevisionId: revision.id, factRevisionSequence: index + 1, factProfileKey: source.profileKey, factProfileVersion: source.profileVersion });
      }
      return pins;
    });
    await worker(scope, async (tx) => {
      expect(await tx.sourceRevisionRecord.count()).toBe(9);
      const tracing = { $queryRaw: async (query: Prisma.Sql) => {
        const rows = await tx.$queryRaw<{ found: boolean; draft: unknown; fields: unknown }[]>(query);
        expect(rows).toHaveLength(4);
        expect(rows.every((row) => !row.found && row.draft === null && row.fields === null)).toBe(true);
        return rows;
      } } as unknown as DatabaseTransaction;
      await expect(createSnapshotGoodFactResolver(tracing)(scope, fixtures.slice(0, 4), new Map())).rejects.toThrow("SNAPSHOT_GOOD_FACT_MISSING");
      const profiles = new Map([["synthetic-captured-only@1", { identity: "synthetic-captured-only@1", caseSensitiveTags: true, fieldMappings: [] }]]);
      expect(await createSnapshotGoodFactResolver(tx)(scope, [fixtures[4]!], profiles)).toEqual([{
        inventoryUid: fixtures[4]!.uid, sourceId: fixtures[4]!.sourceId, externalOfferId: fixtures[4]!.externalOfferId,
        normalizedHash: fixtures[4]!.normalizedHash, factProfileIdentity: "synthetic-captured-only@1",
        draft: { sourceFormat: "YRL_2010", propertyType: "APARTMENT", transactionType: "SALE" }, fieldValues: {},
      }]);
      await expect(createSnapshotGoodFactResolver(tx)(scope, [fixtures[5]!], profiles)).rejects.toThrow("SNAPSHOT_GOOD_FACT_HASH_MISMATCH");
      await expect(createSnapshotGoodFactResolver(tx)(scope, [fixtures[6]!], profiles)).rejects.toThrow("SNAPSHOT_PUBLIC_ADDRESS_INVALID");
      const compound = await createSnapshotGoodFactResolver(tx)(scope, [fixtures[7]!], profiles);
      expect(compound[0]!.addressPublic).toBe("City, house 9");
      expect(compound[0]!.draft).not.toHaveProperty("address");
      expect(compound[0]!.fieldValues).not.toHaveProperty("location/apartment");
      expect((await createSnapshotGoodFactResolver(tx)(scope, [fixtures[8]!], profiles))[0]!.addressPublic).toBe("City, house 9");
    });
  });

  it("fresh admission denies a freeze committed while the outer RR cut waited on the safety lock", async () => {
    const scope = await setup();
    let releaseBlocker!: () => void;
    let signalLocked!: () => void;
    let signalCut!: () => void;
    const release = new Promise<void>((resolve) => { releaseBlocker = resolve; });
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const cut = new Promise<void>((resolve) => { signalCut = resolve; });
    const blocker = runInPrincipalDatabaseTransaction(admin, async (tx) => {
      await tx.$queryRaw(Prisma.sql`select pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text`);
      await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true, frozenAt: new Date() } });
      signalLocked();
      await release;
    });
    await locked;
    const original = transactionRuntime.runInAuthorizedDatabaseTransaction;
    let workerReads = 0;
    const spy = vi.spyOn(transactionRuntime, "runInAuthorizedDatabaseTransaction").mockImplementation((context, execute, options) =>
      original(context, async (tx) => {
        if (context.principalKind === "project-job" && context.actorId === "snapshot-input") {
          await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
          const roles = await tx.$queryRawUnsafe<{ rolbypassrls: boolean; rolsuper: boolean }[]>(
            "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user");
          expect(roles).toEqual([{ rolbypassrls: false, rolsuper: false }]);
          workerReads++;
          if (options?.isolationLevel === "RepeatableRead") {
            expect(await tx.dataSafetyState.findUnique({ where: { id: "global" }, select: { jobsFrozen: true } }))
              .toEqual({ jobsFrozen: false });
            signalCut();
          }
        }
        return execute(tx);
      }, options));
    let mutated = false;
    const outcome = expect(runInSnapshotInputTransaction({ kind: "project-job", jobName: "snapshot-input",
      organizationId: scope.organizationId, projectId: scope.projectId, correlationId: randomUUID() }, async (tx) => {
      mutated = true;
      return new PrismaSnapshotInputRepository(tx).reserveSequence(scope.organizationId, scope.projectId);
    })).rejects.toThrow("SNAPSHOT_INPUT_JOBS_FROZEN");
    try {
      await cut;
      releaseBlocker();
      await blocker;
      await outcome;
      expect(workerReads).toBe(2);
      expect(mutated).toBe(false);
    } finally {
      releaseBlocker();
      spy.mockRestore();
    }
    await worker(scope, async (tx) => {
      expect(await tx.projectSnapshotSequence.count()).toBe(0);
      expect(await tx.snapshotBuildInput.count()).toBe(0);
    });
    await expect(worker(scope, (tx) => tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: false } }))).rejects.toThrow();
    await worker(scope, async (tx) => {
      const privileges = await tx.$queryRawUnsafe<{ projectUpdate: boolean; safetyUpdate: boolean }[]>(
        `SELECT has_table_privilege(current_user, 'public."Project"', 'UPDATE') AS "projectUpdate",
          has_table_privilege(current_user, 'public."DataSafetyState"', 'UPDATE') AS "safetyUpdate"`);
      expect(privileges).toEqual([{ projectUpdate: false, safetyUpdate: false }]);
    });
    await expect(worker(scope, (tx) => tx.project.update({ where: { id: scope.projectId }, data: { status: "DISABLED" } }))).rejects.toThrow();
  });

  it("bounds admission pool contention and rolls back instead of deadlocking the capture", async () => {
    const scope = await setup();
    const pool = getPrismaPool();
    const maximum = pool.options.max ?? 10;
    expect(maximum).toBeGreaterThan(1);
    const borrowed = await Promise.all(Array.from({ length: maximum - 1 }, () => pool.connect()));
    const original = transactionRuntime.runInAuthorizedDatabaseTransaction;
    const spy = vi.spyOn(transactionRuntime, "runInAuthorizedDatabaseTransaction").mockImplementation((context, execute, options) =>
      original(context, async (tx) => {
        if (context.principalKind === "project-job" && context.actorId === "snapshot-input") {
          await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        }
        return execute(tx);
      }, options));
    let reached = false;
    const started = performance.now();
    try {
      await expect(runInSnapshotInputTransaction({ kind: "project-job", jobName: "snapshot-input",
        organizationId: scope.organizationId, projectId: scope.projectId, correlationId: randomUUID() }, async (tx) => {
        reached = true;
        return new PrismaSnapshotInputRepository(tx).reserveSequence(scope.organizationId, scope.projectId);
      })).rejects.toThrow();
      expect(performance.now() - started).toBeLessThan(10_000);
      expect(reached).toBe(false);
    } finally {
      spy.mockRestore();
      for (const client of borrowed) client.release();
    }
    await worker(scope, async (tx) => {
      expect(await tx.projectSnapshotSequence.count()).toBe(0);
      expect(await tx.snapshotBuildInput.count()).toBe(0);
    });
    expect(reached).toBe(false);
    expect(pool.waitingCount).toBe(0);
    expect(pool.idleCount).toBe(pool.totalCount);
  }, 15_000);
});
