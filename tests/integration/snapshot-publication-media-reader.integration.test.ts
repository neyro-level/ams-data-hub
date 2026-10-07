import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../../src/generated/prisma/client.ts";
import { captureSnapshotInput, createSnapshotMediaProjectionServer } from "../../src/modules/snapshot-delivery/server.ts";
import { selectSnapshotCatalog } from "../../src/modules/snapshot-delivery/index.ts";
import { createSnapshotPublicationMediaReader } from "../../src/modules/media-assets/server.ts";
import { analyzeImportSafety, BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../../src/modules/ingestion-core/index.ts";
import { lockSnapshotPublication } from "../../src/modules/snapshot-delivery/infrastructure/snapshot-publication-lock.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { createMediaKey } from "../../src/platform/storage/object-storage.ts";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";

const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-media-admission", correlationId: randomUUID() };
async function fixture() {
  const setup = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const suffix = randomUUID().slice(0, 8);
    const org = await tx.organization.create({ data: { name: "Synthetic media admission", slug: `media-admit-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic media", slug: `media-${suffix}` } });
    const foreign = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic foreign media", slug: `foreign-${suffix}` } });
    const scope = { organizationId: org.id, projectId: project.id };
    const foreignScope = { organizationId: org.id, projectId: foreign.id };
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() }, update: { jobsFrozen: false, unfrozenAt: new Date() } });
    const developer = await tx.developer.create({ data: { uid: createUlid(), name: "Synthetic media developer", normalizedName: `media-${suffix}` } });
    const development = await tx.development.create({ data: { uid: createUlid(), developerUid: developer.uid, cityUid: "01M41T6Q04BADHXSERJHZFXKCH", name: "Synthetic media development", normalizedName: `media-${suffix}` } });
    const building = await tx.building.create({ data: { uid: createUlid(), developmentUid: development.uid, label: "Synthetic media building", normalizedLabel: "media" } });
    await tx.projectCatalogSubscription.create({ data: { ...scope, mode: "CURATED", cities: { create: { cityUid: development.cityUid } }, selections: { create: { developmentUid: development.uid, decision: "INCLUDE" } } } });
    const sourceData = { sourceKey: "synthetic-media", name: "Synthetic media", adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0", datasetType: "RESALE" as const, schedulePolicy: { mode: "MANUAL_ONLY" } };
    const source = await tx.source.create({ data: { ...scope, ...sourceData } }); const foreignSource = await tx.source.create({ data: { ...foreignScope, ...sourceData } });
    const assetData = { sha256: "a".repeat(64), storageKey: createMediaKey("a".repeat(64)), contentType: "image/jpeg", byteSize: 100,
      originalFileName: "synthetic-private-filename", source: "synthetic-private-source", rightsBasis: "LICENSED" as const,
      license: "\ufeffsynthetic-private-license\u2007", uploadedBy: "synthetic" };
    const asset = await tx.mediaAsset.create({ data: { ...scope, ...assetData } });
    const feed = await tx.mediaAsset.create({ data: { ...scope, ...assetData, sha256: "c".repeat(64), storageKey: createMediaKey("c".repeat(64)), rightsBasis: "OWNED", license: null } });
    const foreignAsset = await tx.mediaAsset.create({ data: { ...foreignScope, ...assetData } });
    const inventoryUid = createUlid(); const target = { ...scope, sourceId: source.id }; const recordHash = "b".repeat(64);
    const inventoryUrl = "https://private.example.invalid/inventory.jpg"; const sharedUrl = "https://private.example.invalid/shared.jpg";
    const analysis = analyzeImportSafety({ recordCount: 1, previousGoodRecordCount: null, invalidRecordCount: 0, issues: [] }, BOOTSTRAP_SOURCE_SAFETY_POLICY);
    const revision = await tx.sourceRevision.create({ data: { ...target, sourceVersion: 1, adapterKey: source.adapterKey, adapterVersion: source.adapterVersion,
      profileKey: source.profileKey, profileVersion: source.profileVersion, safetyPolicy: BOOTSTRAP_SOURCE_SAFETY_POLICY, safetyAnalysis: JSON.parse(JSON.stringify(analysis)) as Prisma.InputJsonObject, recordCount: 1 } });
    await tx.sourceRevisionRecord.create({ data: { ...target, revisionId: revision.id, externalId: "synthetic-private", orderKey: "73796e746865746963",
      inventoryUid, recordHash, payload: { schemaVersion: 1, draft: { imageUrls: [inventoryUrl, inventoryUrl] }, fields: {} } } });
    await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence: 1, rawStorageKey: "private-synthetic/media",
      rawArtifactHash: "a".repeat(64), rawByteCount: 1, normalizedContentHash: recordHash, completedAt: new Date() } });
    await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
    await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: revision.id } });
    await tx.inventoryIdentity.create({ data: { ...target, uid: inventoryUid, externalOfferId: "synthetic-private", normalizedHash: recordHash,
      sourceHash: "a".repeat(64), firstSeenAt: new Date(), lastSeenAt: new Date() } });
    const relationData = { ...target, sourceRevisionId: revision.id, entityType: "INVENTORY", entityUid: inventoryUid, kind: "LISTING_IMAGE" as const,
      position: 7, sourceUrl: inventoryUrl, canonicalSourceUrl: inventoryUrl, status: "WARNING" as const, assetId: asset.id, firstSeenAt: new Date(), lastAttemptAt: new Date(), mirroredAt: new Date() };
    const relation = await tx.mediaSource.create({ data: relationData });
    const agent = await tx.agent.create({ data: { ...scope, uid: createUlid(), slug: "synthetic-agent", fullName: "Synthetic media Agent", showOnSite: true,
      consentConfirmedAt: new Date("2026-10-07T01:02:03.789Z"), photoMediaId: asset.id, feedPhotoMediaId: feed.id } });
    const observationData = { developmentUid: development.uid, buildingUid: building.uid, externalId: "synthetic-private", kind: "DEVELOPMENT_IMAGE" as const,
      position: 2, sourceUrl: sharedUrl, canonicalSourceUrl: sharedUrl, rightsBasis: "LICENSED" as const, attribution: "\u2007synthetic-private-attribution\ufeff", license: null, observedAt: new Date() };
    const observation = await tx.sharedMediaAsset.create({ data: { ...target, ...observationData } });
    const sharedRelation = await tx.mediaSource.create({ data: { ...relationData, entityType: "BUILDING", entityUid: building.uid, kind: "DEVELOPMENT_IMAGE",
      sourceRevisionId: "manual-approved-observation", sourceUrl: sharedUrl, canonicalSourceUrl: sharedUrl } });
    await tx.sharedMediaAsset.create({ data: { ...foreignScope, sourceId: foreignSource.id, ...observationData } });
    await tx.mediaSource.create({ data: { ...relationData, ...foreignScope, sourceId: foreignSource.id, assetId: foreignAsset.id } });
    return { scope, foreignId: foreign.id, inventoryUid, agentUid: agent.uid, buildingUid: building.uid, asset, feed,
      relationId: relation.id, relationUpdatedAt: relation.updatedAt, observationId: observation.id, observationUpdatedAt: observation.updatedAt,
      sharedRelationId: sharedRelation.id, sourceId: source.id, foreignAssetId: foreignAsset.id };
  });
  const receipt = await captureSnapshotInput(createProjectJobPrincipal({ ...setup.scope, jobName: "snapshot-input" }),
    { ...setup.scope, idempotencyKey: "synthetic-media-admission", schemaMinor: 0 });
  const storage = { head: vi.fn(async (key: string) => {
    const asset = [setup.asset, setup.feed].find((row) => row.storageKey === key);
    return asset ? { key, sha256: asset.sha256, contentLength: asset.byteSize, contentType: asset.contentType, etag: null, lastModifiedAt: new Date(0) } : null;
  }) };
  const projection = await createSnapshotMediaProjectionServer({ ...setup.scope, storage })(receipt, selectSnapshotCatalog(receipt));
  expect(projection.mediaAnchors.attachments.map((row) => `${row.entityType}/${row.position}`).sort())
    .toEqual(["AGENT/0", "BUILDING/2", "INVENTORY/0", "INVENTORY/1"]);
  expect(storage.head).toHaveBeenCalledOnce(); // Same immutable object across all owners; feed never selected.
  return { ...setup, receipt, storage, anchors: projection.mediaAnchors };
}
function publication<T>(scope: { organizationId: string; projectId: string }, execute: (tx: DatabaseTransaction) => Promise<T>,
  projects: readonly string[] | "*" = [scope.projectId], principalKind: "project-job" | "job" = "project-job", actorId = "snapshot-publication") {
  return runInAuthorizedDatabaseTransaction({ principalKind, actorId, organizationId: scope.organizationId, projectIds: projects, correlationId: randomUUID() }, async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
    expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user"))
      .toEqual([{ rolbypassrls: false, rolsuper: false }]);
    await lockSnapshotPublication(tx, scope); return execute(tx);
  }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
}
describe("actual NOBYPASS publication media rights and association admission", () => {
  it("serializes an owned metadata writer and rejects URL reassociation even without timestamp changes", async () => {
    const s = await fixture(); const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });
    const writer = new pg.Client({ host: target.host, port: target.port, database: target.database,
      user: target.user, password: target.password, ssl: target.sslmode === "require", options: "-c timezone=UTC" });
    await writer.connect(); let pending: Promise<{ error: unknown; count: number | null }> | undefined;
    try {
      await writer.query("BEGIN"); await writer.query("SET LOCAL ROLE ams_data_hub_worker");
      await writer.query("SET LOCAL lock_timeout='2s'");
      await writer.query("SELECT set_config('app.principal_kind','project-job',true), set_config('app.actor_id','media-mirror',true), set_config('app.organization_id',$1,true), set_config('app.project_ids',$2,true)",
        [s.scope.organizationId, s.scope.projectId]);
      expect((await writer.query("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user")).rows)
        .toEqual([{ rolbypassrls: false, rolsuper: false }]);
      const pid = (await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      await publication(s.scope, async (tx) => {
        const read = createSnapshotPublicationMediaReader(tx); await read(s.scope, s.anchors);
        pending = writer.query('UPDATE "MediaSource" SET "canonicalSourceUrl"=$1 WHERE id=$2',
          ["https://private.example.invalid/reassociated.jpg", s.relationId])
          .then((result) => ({ error: null, count: result.rowCount }), (error: unknown) => ({ error, count: null }));
        const deadline = Date.now() + 1500; let waiting = false;
        while (Date.now() < deadline) {
          const locks = await tx.$queryRaw<{ pid: number }[]>(Prisma.sql`
            SELECT w.pid FROM pg_locks w JOIN pg_locks owner ON w.locktype=owner.locktype AND w.database=owner.database
              AND w.classid=owner.classid AND w.objid=owner.objid AND w.objsubid=owner.objsubid
            WHERE owner.pid=pg_backend_pid() AND owner.locktype='advisory' AND owner.granted AND NOT w.granted AND w.pid=${pid}`);
          if (locks.length) { waiting = true; break; } await delay(20);
        }
        expect(waiting).toBe(true); await read(s.scope, s.anchors);
      });
      expect(await pending).toEqual({ error: null, count: 1 }); await writer.query("COMMIT");
      await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        expect((await tx.mediaSource.findUniqueOrThrow({ where: { id: s.relationId } })).updatedAt).toEqual(s.relationUpdatedAt);
      });
      await expect(publication(s.scope, (tx) => createSnapshotPublicationMediaReader(tx)(s.scope, s.anchors)))
        .rejects.toThrow("SNAPSHOT_PUBLICATION_MEDIA_STALE");
    } finally { if (pending) await pending; await writer.query("ROLLBACK"); await writer.end(); }
  });
  it("checks only deduplicated metadata/booleans and accepts eligible retry changes or producer OFF", async () => {
    const s = await fixture();
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      await tx.source.update({ where: { id: s.sourceId }, data: { enabled: false, version: { increment: 1 } } });
      await tx.mediaSource.update({ where: { id: s.relationId }, data: { position: 8, status: "MIRRORED", lastAttemptAt: new Date() } });
      await tx.sharedMediaAsset.update({ where: { id: s.observationId }, data: { attribution: "\u0085" } }); // Non-ECMAScript whitespace remains present.
    });
    await publication(s.scope, async (tx) => {
      const trace = vi.spyOn(tx, "$queryRaw");
      try {
        await createSnapshotPublicationMediaReader(tx)(s.scope, s.anchors);
        expect(trace.mock.calls).toHaveLength(4); // Scope + one asset + two dedup relations + one observation.
        const results = await Promise.all(trace.mock.results.map((row) => row.value));
        expect(JSON.stringify(results)).not.toMatch(/https:|synthetic-private|originalFileName|sourceUrl|canonicalSourceUrl|license":|attribution":/u);
        const queries = trace.mock.calls.map(([sql]) => (sql as Prisma.Sql).text).join("\n");
        expect(queries).not.toMatch(/FOR UPDATE|FOR SHARE|payload|SourceRevisionRecord/u);
      } finally { trace.mockRestore(); }
    });
  });
  it.each(["relation-kind", "relation-mirror", "relation-asset", "relation-revision", "relation-owner", "relation-hash",
    "shared-position", "shared-parent", "shared-rights", "shared-attribution", "shared-license", "shared-hash", "shared-relation-owner"])("rejects changed %s", async (mode) => {
    const s = await fixture();
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      if (mode === "relation-kind") await tx.mediaSource.update({ where: { id: s.relationId }, data: { kind: "AGENT_PHOTO" } });
      if (mode === "relation-mirror") await tx.mediaSource.update({ where: { id: s.relationId }, data: { mirroredAt: null } });
      if (mode === "relation-asset") await tx.mediaSource.update({ where: { id: s.relationId }, data: { assetId: s.feed.id } });
      if (mode === "relation-revision") await tx.mediaSource.update({ where: { id: s.relationId }, data: { sourceRevisionId: "different-revision" } });
      if (mode === "relation-owner") await tx.mediaSource.update({ where: { id: s.relationId }, data: { entityUid: createUlid() } });
      if (mode === "relation-hash") {
        await tx.$executeRaw(Prisma.sql`UPDATE "MediaSource" SET "canonicalSourceUrl"='https://private.example.invalid/reassociated.jpg' WHERE id=${s.relationId}`);
        expect((await tx.mediaSource.findUniqueOrThrow({ where: { id: s.relationId } })).updatedAt).toEqual(s.relationUpdatedAt);
      }
      if (mode === "shared-position") await tx.sharedMediaAsset.update({ where: { id: s.observationId }, data: { position: 3 } });
      if (mode === "shared-parent") await tx.sharedMediaAsset.update({ where: { id: s.observationId }, data: { buildingUid: null } });
      if (mode === "shared-rights") await tx.sharedMediaAsset.update({ where: { id: s.observationId }, data: { rightsBasis: "OWNED" } });
      if (mode === "shared-attribution") await tx.sharedMediaAsset.update({ where: { id: s.observationId }, data: { attribution: "\ufeff\u2007\t" } });
      if (mode === "shared-license") await tx.sharedMediaAsset.update({ where: { id: s.observationId }, data: { license: "synthetic-private-license" } });
      if (mode === "shared-hash") {
        await tx.$executeRaw(Prisma.sql`UPDATE "SharedMediaAsset" SET "canonicalSourceUrl"='https://private.example.invalid/reassociated.jpg' WHERE id=${s.observationId}`);
        expect((await tx.sharedMediaAsset.findUniqueOrThrow({ where: { id: s.observationId } })).updatedAt).toEqual(s.observationUpdatedAt);
      }
      if (mode === "shared-relation-owner") await tx.mediaSource.update({ where: { id: s.sharedRelationId }, data: { entityUid: createUlid() } });
    });
    await expect(publication(s.scope, (tx) => createSnapshotPublicationMediaReader(tx)(s.scope, s.anchors))).rejects.toThrow("SNAPSHOT_PUBLICATION_MEDIA_STALE");
  });
  it("rejects mismatched scoped immutable asset metadata without granting asset UPDATE", async () => {
    const s = await fixture(); const forged = structuredClone(s.anchors); forged.attachments.forEach((row) => { row.asset.byteSize++; });
    await expect(publication(s.scope, (tx) => createSnapshotPublicationMediaReader(tx)(s.scope, forged))).rejects.toThrow("SNAPSHOT_PUBLICATION_MEDIA_STALE");
    const foreign = structuredClone(s.anchors); foreign.attachments.forEach((row) => {
      row.asset.id = s.foreignAssetId; if (row.relation) row.relation.assetId = s.foreignAssetId;
    });
    await expect(publication(s.scope, (tx) => createSnapshotPublicationMediaReader(tx)(s.scope, foreign))).rejects.toThrow("SNAPSHOT_PUBLICATION_MEDIA_STALE");
    await expect(publication(s.scope, (tx) => tx.$executeRaw(Prisma.sql`UPDATE "MediaAsset" SET "byteSize"="byteSize" WHERE id=${s.asset.id}`))).rejects.toThrow();
  });
  it("denies broad/legacy/wrong actors before asset or relation reads and isolates populated foreign media", async () => {
    const s = await fixture();
    for (const projects of ["*", [], [s.scope.projectId, s.foreignId], [s.foreignId]] as const) {
      await publication(s.scope, async (tx) => {
        const foreign = projects.length === 1 && projects[0] === s.foreignId ? 1 : 0;
        expect(await tx.mediaAsset.count()).toBe(foreign); expect(await tx.mediaSource.count()).toBe(foreign); expect(await tx.sharedMediaAsset.count()).toBe(foreign);
        const trace = vi.spyOn(tx, "$queryRaw");
        try { await expect(createSnapshotPublicationMediaReader(tx)(s.scope, s.anchors)).rejects.toThrow("SNAPSHOT_PUBLICATION_MEDIA_ACCESS_DENIED");
          expect(trace.mock.calls).toHaveLength(1); } finally { trace.mockRestore(); }
      }, projects);
    }
    for (const [kind, actor] of [["job", "snapshot-publication"], ["project-job", "synthetic-other-job"]] as const) {
      await publication(s.scope, async (tx) => {
        if (kind === "job") { expect(await tx.mediaAsset.count()).toBe(0); expect(await tx.mediaSource.count()).toBe(0); }
        await expect(createSnapshotPublicationMediaReader(tx)(s.scope, s.anchors)).rejects.toThrow("SNAPSHOT_PUBLICATION_MEDIA_ACCESS_DENIED");
      }, [s.scope.projectId], kind, actor);
    }
  });
});
