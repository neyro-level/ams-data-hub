import { randomUUID } from "node:crypto";
import { createUlid, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../../src/generated/prisma/client.ts";
import { PrismaSnapshotInputRepository, runInSnapshotInputTransaction } from "../../src/modules/snapshot-delivery/server.ts";
import {
  SNAPSHOT_INPUT_PART_KINDS, SnapshotInputPartsBuilder, snapshotInputHash,
  snapshotInputRequestHashes, snapshotInputRequestSchema,
} from "../../src/modules/snapshot-delivery/index.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction,
  type DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { createCatalogSnapshotFactReader } from "../../src/modules/shared-catalog/server.ts";
import { createSourceSnapshotFactReader } from "../../src/modules/ingestion-core/server.ts";
import { createProjectStateSnapshotFactReader } from "../../src/modules/project-state/server.ts";
import * as transactionRuntime from "../../src/platform/database/transaction.ts";
import { getPrismaPool } from "../../src/platform/database/prisma/client.ts";
import { createMediaSnapshotFactReader } from "../../src/modules/media-assets/server.ts";
import { createMediaKey } from "../../src/platform/storage/object-storage.ts";

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
function parts() {
  const builder = new SnapshotInputPartsBuilder();
  for (const kind of SNAPSHOT_INPUT_PART_KINDS) builder.add(kind, kind === "catalog" ? [{ uid: "synthetic", version: 1 }] : []);
  return builder.finish();
}

describe("snapshot input persistence foundation with NOBYPASS PostgreSQL worker", () => {
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
      async function good(sequence: number, externalId: string, inventoryUid: string, imageUrls: string[]) {
        const revision = await tx.sourceRevision.create({ data: { ...where, sourceVersion: source.version,
          adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey,
          profileVersion: source.profileVersion, safetyPolicy: {}, recordCount: 1 } });
        await tx.sourceRevisionRecord.create({ data: { ...where, revisionId: revision.id, externalId, inventoryUid,
          orderKey: Buffer.from(externalId).toString("hex"), recordHash: "b".repeat(64),
          payload: { schemaVersion: 1, draft: { imageUrls, contactPhones: ["synthetic-private-phone"] }, rawRecord: { private: true } } } });
        await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence,
          rawStorageKey: `synthetic-private/${sequence}`, rawArtifactHash: "a".repeat(64), rawByteCount: 1,
          normalizedContentHash: "b".repeat(64), completedAt: new Date() } });
        await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
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
    const fixtures = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const source = await tx.source.create({ data: {
        organizationId: scope.organizationId, projectId: scope.projectId, sourceKey: "synthetic-input",
        name: "Synthetic input source", adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0",
        profileKey: "vladis-vt24-v1", profileVersion: "1.0.0", datasetType: "RESALE",
        schedulePolicy: { mode: "MANUAL_ONLY" }, enabled: true,
      } });
      const target = { organizationId: scope.organizationId, projectId: scope.projectId, sourceId: source.id };
      const good = async (sequence: number, externalId: string, inventoryUid: string, recordHash: string) => {
        const revision = await tx.sourceRevision.create({ data: { ...target, sourceVersion: source.version,
          adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey,
          profileVersion: source.profileVersion, safetyPolicy: {}, recordCount: 1,
        } });
        await tx.sourceRevisionRecord.create({ data: { ...target, revisionId: revision.id,
          externalId, orderKey: Buffer.from(externalId).toString("hex"), inventoryUid, recordHash,
          payload: { schemaVersion: 1, draft: { contactPhones: ["synthetic-private-only"] }, rawRecord: { marker: "private" }, fields: {} },
        } });
        await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED",
          rawStorageKey: `private-synthetic/${sequence}`, rawArtifactHash: "a".repeat(64), rawByteCount: 1,
          normalizedContentHash: recordHash, sequence, completedAt: new Date(),
        } });
        await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
        return revision.id;
      };
      const historical = await good(1, "kept", uid, "b".repeat(64));
      const head = await good(2, "new-only", createUlid(), "c".repeat(64));
      await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: head } });
      await tx.inventoryIdentity.create({ data: { ...target, uid, externalOfferId: "kept", status: "ACTIVE",
        sourceHash: "d".repeat(64), normalizedHash: "b".repeat(64), firstSeenAt: new Date(), lastSeenAt: new Date(),
        missingGoodRuns: 1, missingSince: new Date(),
      } });
      await tx.sourceRevision.create({ data: { ...target, sourceVersion: source.version, adapterKey: source.adapterKey,
        adapterVersion: source.adapterVersion, profileKey: source.profileKey, profileVersion: source.profileVersion, safetyPolicy: {},
      } });
      return { sourceId: source.id, historical, head };
    });
    await worker(scope, async (tx) => {
      const inventory: CanonicalJsonValue[] = [];
      const sources: CanonicalJsonValue[] = [];
      await createSourceSnapshotFactReader(tx).capture(scope, (kind, rows) => {
        (kind === "inventory" ? inventory : sources).push(...rows);
      });
      expect(inventory).toHaveLength(1);
      expect(inventory[0]).toMatchObject({ uid, approvedHeadId: fixtures.head, approvedHeadSequence: 2,
        factRevisionId: fixtures.historical, factRevisionSequence: 1, factProfileIdentity: "vladis-vt24-v1@1.0.0" });
      expect(sources.filter((value) => typeof value === "object" && value !== null && !Array.isArray(value)
        && value.entityType === "profile")).toHaveLength(1);
      expect(JSON.stringify({ inventory, sources })).not.toMatch(/rawRecord|contactPhones|rawStorageKey|synthetic-private-only/u);
      expect(await tx.sourceRevision.count()).toBe(2);
      expect(await tx.sourceRevision.updateMany({ where: { id: fixtures.head }, data: { failedStage: "DENIED" } })).toMatchObject({ count: 0 });
      const foreign: CanonicalJsonValue[] = [];
      await createSourceSnapshotFactReader(tx).capture({ organizationId: scope.organizationId, projectId: scope.foreignProjectId },
        (_kind, rows) => { foreign.push(...rows); });
      expect(foreign).toEqual([]);
    });
    await runInPrincipalDatabaseTransaction(admin, (tx) => tx.inventoryIdentity.update({ where: { uid }, data: { normalizedHash: "e".repeat(64) } }));
    await expect(worker(scope, (tx) => createSourceSnapshotFactReader(tx).capture(scope, () => undefined)))
      .rejects.toThrow("SNAPSHOT_INPUT_INVENTORY_FACT_MISSING");
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
