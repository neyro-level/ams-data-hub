import { randomUUID } from "node:crypto";
import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../../src/generated/prisma/client.ts";
import { captureSnapshotInput } from "../../src/modules/snapshot-delivery/server.ts";
import { validateSnapshotInput } from "../../src/modules/snapshot-delivery/index.ts";
import { createSnapshotPublicationSourceReader, createSnapshotRollbackSourceReader, createSnapshotSourceGoodTriggerReader } from "../../src/modules/ingestion-core/server.ts";
import { prepareSnapshotPublicationSourceAnchors, analyzeImportSafety, BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../../src/modules/ingestion-core/index.ts";
import { lockSnapshotPublication } from "../../src/modules/snapshot-delivery/infrastructure/snapshot-publication-lock.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";

const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-fresh-source", correlationId: randomUUID() };
const recordHash = "b".repeat(64);
async function fixture() {
  const setup = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const suffix = randomUUID().slice(0, 8);
    const org = await tx.organization.create({ data: { name: "Synthetic freshness", slug: `fresh-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic freshness", slug: `fresh-${suffix}` } });
    const foreign = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic foreign", slug: `fresh-b-${suffix}` } });
    const scope = { organizationId: org.id, projectId: project.id };
    await tx.projectCatalogSubscription.create({ data: { ...scope, mode: "CURATED", cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
      update: { jobsFrozen: false, unfrozenAt: new Date() } });
    const sourceData = { ...scope, sourceKey: "synthetic-fresh", name: "Synthetic freshness", adapterKey: "yrl-realty-2010",
      adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0", datasetType: "RESALE" as const,
      schedulePolicy: { mode: "MANUAL_ONLY" }, enabled: true };
    const source = await tx.source.create({ data: sourceData });
    const target = { ...scope, sourceId: source.id }; const uid = createUlid();
    // Explicit fixture-only empty GOOD permits a missing-grace historical fact.
    const policy = { ...BOOTSTRAP_SOURCE_SAFETY_POLICY, allowEmpty: true, maxDropPercent: 100, requireManualApprovalAboveDrop: false };
    let previous: string | null = null; const revisions: string[] = [];
    for (const sequence of [1, 2]) {
      const count = sequence === 1 ? 1 : 0;
      const analysis = analyzeImportSafety({ recordCount: count, previousGoodRecordCount: sequence === 1 ? null : 1,
        invalidRecordCount: 0, issues: [] }, policy);
      const revision: { id: string } = await tx.sourceRevision.create({ data: { ...target, sourceVersion: source.version,
        adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey, profileVersion: source.profileVersion,
        baseLastGoodRevisionId: previous, safetyPolicy: policy, safetyAnalysis: JSON.parse(JSON.stringify(analysis)) as Prisma.InputJsonObject,
        recordCount: count } });
      if (count) await tx.sourceRevisionRecord.create({ data: { ...target, revisionId: revision.id, externalId: "synthetic-private-external",
        orderKey: "73796e746865746963", inventoryUid: uid, recordHash,
        payload: { schemaVersion: 1, draft: { imageUrls: [], private: true }, fields: {}, rawRecord: { private: true } } } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence,
        rawStorageKey: "private-synthetic/fresh", rawArtifactHash: "a".repeat(64), rawByteCount: 1,
        normalizedContentHash: sequence === 1 ? recordHash : "c".repeat(64), completedAt: new Date() } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
      previous = revision.id; revisions.push(revision.id);
    }
    await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: previous } });
    await tx.inventoryIdentity.create({ data: { ...target, uid, externalOfferId: "synthetic-private-external", normalizedHash: recordHash,
      sourceHash: "a".repeat(64), firstSeenAt: new Date(), lastSeenAt: new Date(), missingGoodRuns: 1, missingSince: new Date() } });
    return { scope, foreignId: foreign.id, sourceId: source.id, sourceData, uid, revisions };
  });
  const receipt = await captureSnapshotInput(createProjectJobPrincipal({ ...setup.scope, jobName: "snapshot-input" }),
    { ...setup.scope, idempotencyKey: "synthetic-fresh", schemaMinor: 0 });
  const parts = validateSnapshotInput(receipt);
  const anchors = prepareSnapshotPublicationSourceAnchors({ sources: parts.filter((part) => part.kind === "sources").flatMap((part) => part.payload),
    inventory: parts.filter((part) => part.kind === "inventory").flatMap((part) => part.payload) });
  return { ...setup, anchors };
}
function publication<T>(scope: { organizationId: string; projectId: string }, execute: (tx: DatabaseTransaction) => Promise<T>,
  projects: readonly string[] | "*" = [scope.projectId], kind: "project-job" | "job" = "project-job") {
  return runInAuthorizedDatabaseTransaction({ principalKind: kind, actorId: "snapshot-publication", organizationId: scope.organizationId,
    projectIds: projects, correlationId: randomUUID() }, async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
    expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user"))
      .toEqual([{ rolbypassrls: false, rolsuper: false }]);
    await lockSnapshotPublication(tx, scope); return execute(tx);
  }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
}
describe("actual NOBYPASS publication source freshness", () => {
  it("admits historical GOOD trigger metadata after head advance and producer OFF", async () => {
    const s = await fixture();
    await runInPrincipalDatabaseTransaction(admin, (tx) => tx.source.update({ where: { id: s.sourceId }, data: { enabled: false, version: { increment: 1 } } }));
    await publication(s.scope, async (tx) => {
      const trace = vi.spyOn(tx.sourceRevision, "findFirst");
      try {
        await createSnapshotSourceGoodTriggerReader(tx)({ schemaVersion: 1, ...s.scope, sourceId: s.sourceId,
          sourceRevisionId: s.revisions[0]!, sourceRevisionSequence: 1 });
        expect(trace).toHaveBeenCalledOnce();
        expect(trace.mock.calls[0]![0]).toEqual({ where: { ...s.scope, sourceId: s.sourceId, id: s.revisions[0], sequence: 1, status: "GOOD" }, select: { id: true } });
        expect(JSON.stringify(await trace.mock.results[0]!.value)).not.toMatch(/payload|private|external|profile/u);
      } finally { trace.mockRestore(); }
    });
  });
  it.each(["source", "revision", "sequence", "project", "organization", "failed"])("denies invalid %s GOOD trigger membership", async (mode) => {
    const s = await fixture();
    const failed = await runInPrincipalDatabaseTransaction(admin, (tx) => tx.sourceRevision.create({ data: { ...s.scope, sourceId: s.sourceId,
      sourceVersion: 1, adapterKey: s.sourceData.adapterKey, adapterVersion: s.sourceData.adapterVersion,
      profileKey: s.sourceData.profileKey, profileVersion: s.sourceData.profileVersion,
      safetyPolicy: BOOTSTRAP_SOURCE_SAFETY_POLICY, safetyAnalysis: {}, recordCount: 0, status: "FAILED", completedAt: new Date() } }));
    const input = { schemaVersion: 1 as const, ...s.scope, sourceId: s.sourceId, sourceRevisionId: s.revisions[0]!, sourceRevisionSequence: 1 };
    if (mode === "source") input.sourceId = "synthetic-nonexistent-source";
    if (mode === "revision") input.sourceRevisionId = "synthetic-nonexistent-revision";
    if (mode === "sequence") input.sourceRevisionSequence = 2;
    if (mode === "project") input.projectId = s.foreignId;
    if (mode === "organization") input.organizationId = "synthetic-foreign-org";
    if (mode === "failed") input.sourceRevisionId = failed.id;
    await expect(publication(s.scope, (tx) => createSnapshotSourceGoodTriggerReader(tx)(input))).rejects.toThrow("SNAPSHOT_BUILD_REQUEST_INVALID");
  });
  it("denies broad or legacy trigger purpose before any revision read", async () => {
    const s = await fixture(); const input = { schemaVersion: 1 as const, ...s.scope, sourceId: s.sourceId,
      sourceRevisionId: s.revisions[0]!, sourceRevisionSequence: 1 };
    for (const projects of ["*", [], [s.scope.projectId, s.foreignId]] as const) {
      await publication(s.scope, async (tx) => {
        const trace = vi.spyOn(tx.sourceRevision, "findFirst");
        try { await expect(createSnapshotSourceGoodTriggerReader(tx)(input)).rejects.toThrow("SNAPSHOT_BUILD_REQUEST_INVALID");
          expect(trace).not.toHaveBeenCalled(); } finally { trace.mockRestore(); }
      }, projects);
    }
    await publication(s.scope, (tx) => expect(createSnapshotSourceGoodTriggerReader(tx)(input)).rejects.toThrow("SNAPSHOT_BUILD_REQUEST_INVALID"), [s.scope.projectId], "job");
  });
  it("accepts historical missing-grace GOOD and OFF/failed attempt with metadata-only queries", async () => {
    const setup = await fixture();
    expect(setup.anchors.inventory[0]!.factRevisionId).toBe(setup.revisions[0]);
    expect(setup.anchors.sources[0]!.approvedHead!.id).toBe(setup.revisions[1]);
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      await tx.source.update({ where: { id: setup.sourceId }, data: { enabled: false, version: { increment: 1 }, lastAttemptAt: new Date() } });
      await tx.sourceRevision.create({ data: { ...setup.scope, sourceId: setup.sourceId, sourceVersion: 2,
        adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
        safetyPolicy: BOOTSTRAP_SOURCE_SAFETY_POLICY, status: "FAILED", failureCode: "SYNTHETIC_FETCH_FAILED" } });
    });
    await publication(setup.scope, async (tx) => {
      const sourceTrace = vi.spyOn(tx.source, "findMany"); const inventoryTrace = vi.spyOn(tx.inventoryIdentity, "findMany");
      const sqlTrace = vi.spyOn(tx, "$queryRaw");
      try {
        await createSnapshotPublicationSourceReader(tx)(setup.scope, setup.anchors);
        expect(sourceTrace.mock.calls.every(([args]) => !JSON.stringify(args?.select).match(/enabled|version|payload|safety|lastAttempt/u))).toBe(true);
        expect(inventoryTrace).not.toHaveBeenCalled();
        const queries = sqlTrace.mock.calls.map(([sql]) => (sql as Prisma.Sql).text).join("\n");
        expect(queries).not.toMatch(/payload|draft|fields|FOR UPDATE|FOR SHARE/u);
        expect(queries).toContain("jsonb_to_recordset");
        expect(queries).toContain('"SourceRevisionRecord"');
      } finally { sourceTrace.mockRestore(); inventoryTrace.mockRestore(); sqlTrace.mockRestore(); }
    });
  });
  it.each(["dataset", "extra-source", "extra-active", "deactivated", "hash", "external-membership"])("rejects changed %s facts", async (mode) => {
    const setup = await fixture();
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      if (mode === "dataset") await tx.source.update({ where: { id: setup.sourceId }, data: { datasetType: "LAND" } });
      if (mode === "extra-source") await tx.source.create({ data: { ...setup.sourceData, sourceKey: "synthetic-extra" } });
      if (mode === "extra-active") await tx.inventoryIdentity.create({ data: { ...setup.scope, sourceId: setup.sourceId, uid: createUlid(),
        externalOfferId: "synthetic-extra", normalizedHash: recordHash, sourceHash: "a".repeat(64), firstSeenAt: new Date(), lastSeenAt: new Date() } });
      if (mode === "deactivated") await tx.inventoryIdentity.update({ where: { uid: setup.uid }, data: { status: "INACTIVE" } });
      if (mode === "hash") await tx.inventoryIdentity.update({ where: { uid: setup.uid }, data: { normalizedHash: "f".repeat(64) } });
      if (mode === "external-membership") await tx.inventoryIdentity.update({ where: { uid: setup.uid }, data: { externalOfferId: "synthetic-unmatched" } });
    });
    await expect(publication(setup.scope, (tx) => createSnapshotPublicationSourceReader(tx)(setup.scope, setup.anchors)))
      .rejects.toThrow("SNAPSHOT_PUBLICATION_SOURCE_STALE");
  });
  it("rejects changed head metadata and missing/foreign historical membership", async () => {
    const setup = await fixture();
    for (const mode of ["head-hash", "head-sequence", "missing-fact", "foreign-source", "profile"] as const) {
      const anchors = structuredClone(setup.anchors);
      if (mode === "head-hash") anchors.sources[0]!.approvedHead!.normalizedContentHash = "f".repeat(64);
      if (mode === "head-sequence") anchors.sources[0]!.approvedHead!.sequence = 3;
      if (mode === "missing-fact") anchors.inventory[0]!.factRevisionId = "synthetic-missing";
      if (mode === "foreign-source") { anchors.sources[0]!.sourceId = "synthetic-foreign"; anchors.inventory[0]!.sourceId = "synthetic-foreign"; }
      if (mode === "profile") anchors.inventory[0]!.factProfileKey = "synthetic-missing";
      await expect(publication(setup.scope, (tx) => createSnapshotPublicationSourceReader(tx)(setup.scope, anchors)))
        .rejects.toThrow("SNAPSHOT_PUBLICATION_SOURCE_STALE");
    }
  });
  it("rejects a new committed GOOD head while retained ACTIVE facts are unchanged", async () => {
    const setup = await fixture();
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const policy = { ...BOOTSTRAP_SOURCE_SAFETY_POLICY, allowEmpty: true, maxDropPercent: 100, requireManualApprovalAboveDrop: false };
      const analysis = analyzeImportSafety({ recordCount: 0, previousGoodRecordCount: 0, invalidRecordCount: 0, issues: [] }, policy);
      const revision = await tx.sourceRevision.create({ data: { ...setup.scope, sourceId: setup.sourceId, sourceVersion: 1,
        baseLastGoodRevisionId: setup.revisions[1], adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0",
        profileKey: "vladis-vt24-v1", profileVersion: "1.0.0", safetyPolicy: policy,
        safetyAnalysis: JSON.parse(JSON.stringify(analysis)) as Prisma.InputJsonObject, recordCount: 0 } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence: 3,
        rawStorageKey: "private-synthetic/fresh-head", rawArtifactHash: "a".repeat(64), rawByteCount: 1,
        normalizedContentHash: "d".repeat(64), completedAt: new Date() } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
      await tx.source.update({ where: { id: setup.sourceId }, data: { lastGoodRevisionId: revision.id } });
    });
    await expect(publication(setup.scope, (tx) => createSnapshotPublicationSourceReader(tx)(setup.scope, setup.anchors)))
      .rejects.toThrow("SNAPSHOT_PUBLICATION_SOURCE_STALE");
    await publication(setup.scope, (tx) => createSnapshotRollbackSourceReader(tx)(setup.scope, setup.anchors));
  });
  it.each(["new-hash", "extra-source", "extra-active", "inactive", "external", "dataset", "false-head", "false-fact"])("historical rollback source permission: %s", async (mode) => {
    const s = await fixture(); const original = structuredClone(s.anchors); const pins = structuredClone(s.anchors);
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      if (mode === "new-hash") await tx.inventoryIdentity.update({ where: { uid: s.uid }, data: { normalizedHash: "f".repeat(64) } });
      if (mode === "extra-source") await tx.source.create({ data: { ...s.sourceData, sourceKey: "synthetic-rollback-extra" } });
      if (mode === "extra-active") await tx.inventoryIdentity.create({ data: { ...s.scope, sourceId: s.sourceId, uid: createUlid(),
        externalOfferId: "synthetic-rollback-extra", normalizedHash: recordHash, sourceHash: "a".repeat(64), firstSeenAt: new Date(), lastSeenAt: new Date() } });
      if (mode === "inactive") await tx.inventoryIdentity.update({ where: { uid: s.uid }, data: { status: "INACTIVE" } });
      if (mode === "external") await tx.inventoryIdentity.update({ where: { uid: s.uid }, data: { externalOfferId: "synthetic-unmatched" } });
      if (mode === "dataset") await tx.source.update({ where: { id: s.sourceId }, data: { datasetType: "LAND" } });
    });
    if (mode === "false-head") pins.sources[0]!.approvedHead!.normalizedContentHash = "f".repeat(64);
    if (mode === "false-fact") pins.inventory[0]!.factProfileKey = "synthetic-false";
    const read = publication(s.scope, (tx) => createSnapshotRollbackSourceReader(tx)(s.scope, pins));
    if (["new-hash", "extra-source", "extra-active"].includes(mode)) await read;
    else await expect(read).rejects.toThrow("SNAPSHOT_ROLLBACK_SOURCE_DENIED");
    expect(s.anchors).toEqual(original);
    await publication(s.scope, (tx) => expect(createSnapshotRollbackSourceReader(tx)(s.scope, pins))
      .rejects.toThrow("SNAPSHOT_ROLLBACK_SOURCE_ACCESS_DENIED"), "*");
  });
  it("enforces exact scope and read-only facts despite legacy broad job grants", async () => {
    const setup = await fixture();
    for (const projects of ["*", [], [setup.scope.projectId, setup.foreignId], [setup.foreignId]] as const) {
      await publication(setup.scope, async (tx) => {
        expect(await tx.source.count()).toBe(0); expect(await tx.inventoryIdentity.count()).toBe(0);
        expect(await tx.sourceRevision.count()).toBe(0); expect(await tx.sourceRevisionRecord.count()).toBe(0);
        await expect(createSnapshotPublicationSourceReader(tx)(setup.scope, setup.anchors)).rejects.toThrow("SNAPSHOT_PUBLICATION_SOURCE_ACCESS_DENIED");
      }, projects);
    }
    await publication(setup.scope, async (tx) => { expect(await tx.source.count()).toBe(0); }, [setup.scope.projectId], "job");
    await publication(setup.scope, async (tx) => {
      expect(await tx.sourceRevision.count()).toBe(2);
      expect((await tx.source.updateMany({ data: { enabled: false } })).count).toBe(0);
      expect((await tx.inventoryIdentity.updateMany({ data: { status: "INACTIVE" } })).count).toBe(0);
    });
  });
  it("rejects null-to-GOOD head activation after an actual new receipt", async () => {
    const setup = await fixture();
    const empty = await runInPrincipalDatabaseTransaction(admin, (tx) => tx.source.create({ data: {
      ...setup.sourceData, sourceKey: "synthetic-empty-head", enabled: false } }));
    const receipt = await captureSnapshotInput(createProjectJobPrincipal({ ...setup.scope, jobName: "snapshot-input" }),
      { ...setup.scope, idempotencyKey: "synthetic-null-head", schemaMinor: 0 });
    const parts = validateSnapshotInput(receipt);
    const anchors = prepareSnapshotPublicationSourceAnchors({ sources: parts.filter((part) => part.kind === "sources").flatMap((part) => part.payload),
      inventory: parts.filter((part) => part.kind === "inventory").flatMap((part) => part.payload) });
    expect(anchors.sources.find((row) => row.sourceId === empty.id)!.approvedHead).toBeNull();
    await publication(setup.scope, (tx) => createSnapshotPublicationSourceReader(tx)(setup.scope, anchors));
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const policy = { ...BOOTSTRAP_SOURCE_SAFETY_POLICY, allowEmpty: true };
      const analysis = analyzeImportSafety({ recordCount: 0, previousGoodRecordCount: null, invalidRecordCount: 0, issues: [] }, policy);
      const revision = await tx.sourceRevision.create({ data: { ...setup.scope, sourceId: empty.id, sourceVersion: 1,
        adapterKey: empty.adapterKey, adapterVersion: empty.adapterVersion, profileKey: empty.profileKey, profileVersion: empty.profileVersion,
        safetyPolicy: policy, safetyAnalysis: JSON.parse(JSON.stringify(analysis)) as Prisma.InputJsonObject, recordCount: 0 } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence: 1,
        rawStorageKey: "private-synthetic/new-head", rawArtifactHash: "a".repeat(64), rawByteCount: 1,
        normalizedContentHash: "d".repeat(64), completedAt: new Date() } });
      await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
      await tx.source.update({ where: { id: empty.id }, data: { lastGoodRevisionId: revision.id } });
    });
    await expect(publication(setup.scope, (tx) => createSnapshotPublicationSourceReader(tx)(setup.scope, anchors)))
      .rejects.toThrow("SNAPSHOT_PUBLICATION_SOURCE_STALE");
  });
});
