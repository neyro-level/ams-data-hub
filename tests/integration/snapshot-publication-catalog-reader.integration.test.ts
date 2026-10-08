import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";
import { captureSnapshotInput } from "../../src/modules/snapshot-delivery/server.ts";
import { projectSnapshotCatalog, selectSnapshotCatalog, validateSnapshotInput } from "../../src/modules/snapshot-delivery/index.ts";
import { prepareSnapshotPublicationCatalogAnchors } from "../../src/modules/shared-catalog/index.ts";
import { createSnapshotPublicationCatalogReader, createSnapshotRollbackCatalogReader } from "../../src/modules/shared-catalog/server.ts";
import { lockSnapshotPublication } from "../../src/modules/snapshot-delivery/infrastructure/snapshot-publication-lock.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { Prisma } from "../../src/generated/prisma/client.ts";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";

const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-catalog-admission", correlationId: randomUUID() };
async function fixture() {
  const setup = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const suffix = randomUUID().slice(0, 8);
    const org = await tx.organization.create({ data: { name: "Synthetic catalog admission", slug: `catalog-admit-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic catalog", slug: `catalog-${suffix}` } });
    const foreign = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic foreign catalog", slug: `foreign-${suffix}` } });
    const scope = { organizationId: org.id, projectId: project.id };
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
      update: { jobsFrozen: false, unfrozenAt: new Date() } });
    const cities = await tx.city.findMany({ take: 2, orderBy: { uid: "asc" } }); expect(cities).toHaveLength(2);
    const cityUid = cities[0]!.uid; const otherCityUid = cities[1]!.uid;
    const developer = await tx.developer.create({ data: { uid: createUlid(), name: "Synthetic developer", normalizedName: `developer-${suffix}` } });
    const otherDeveloper = await tx.developer.create({ data: { uid: createUlid(), name: "Synthetic other developer", normalizedName: `other-${suffix}` } });
    const development = await tx.development.create({ data: { uid: createUlid(), developerUid: developer.uid, cityUid,
      name: "Synthetic selected development", normalizedName: `selected-${suffix}` } });
    const otherDevelopment = await tx.development.create({ data: { uid: createUlid(), developerUid: otherDeveloper.uid, cityUid,
      name: "Synthetic other development", normalizedName: `other-${suffix}` } });
    const building = await tx.building.create({ data: { uid: createUlid(), developmentUid: development.uid, label: "Synthetic selected", normalizedLabel: "selected" } });
    const otherBuilding = await tx.building.create({ data: { uid: createUlid(), developmentUid: otherDevelopment.uid, label: "Synthetic other", normalizedLabel: "other" } });
    const district = await tx.district.create({ data: { uid: createUlid(), cityUid, name: "Synthetic district", normalizedName: `district-${suffix}` } });
    await tx.projectCatalogSubscription.create({ data: { ...scope, mode: "CURATED", cities: { create: { cityUid } },
      selections: { create: { developmentUid: development.uid, decision: "INCLUDE" } } } });
    await tx.projectCatalogSubscription.create({ data: { organizationId: org.id, projectId: foreign.id, mode: "CURATED",
      cities: { create: { cityUid: otherCityUid } }, selections: { create: { developmentUid: otherDevelopment.uid, decision: "INCLUDE" } } } });
    return { scope, foreignId: foreign.id, cityUid, otherCityUid, developerUid: developer.uid, otherDeveloperUid: otherDeveloper.uid,
      developmentUid: development.uid, otherDevelopmentUid: otherDevelopment.uid, buildingUid: building.uid, otherBuildingUid: otherBuilding.uid, districtUid: district.uid };
  });
  const receipt = await captureSnapshotInput(createProjectJobPrincipal({ ...setup.scope, jobName: "snapshot-input" }),
    { ...setup.scope, idempotencyKey: "synthetic-catalog-admission", schemaMinor: 0 });
  const parts = validateSnapshotInput(receipt); const selection = selectSnapshotCatalog(receipt); const catalog = projectSnapshotCatalog(receipt, selection);
  const anchors = prepareSnapshotPublicationCatalogAnchors({ projectId: receipt.projectId,
    subscriptions: parts.filter((part) => part.kind === "subscription").flatMap((part) => part.payload),
    catalog: parts.filter((part) => part.kind === "catalog").flatMap((part) => part.payload),
    publishedDevelopers: new Set(catalog.find((row) => row.kind === "developers")!.records.map((row) => row.key)),
    publishedDevelopments: selection.developmentUids, publishedBuildings: selection.buildingUids });
  expect(anchors.developments.map((row) => row.uid)).toEqual([setup.developmentUid]);
  return { ...setup, anchors };
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
describe("actual NOBYPASS selected catalog publication admission", () => {
  it("rollback uses current subscription permissions, not an obsolete subscription version", async () => {
    const s = await fixture(); const original = structuredClone(s.anchors);
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      await tx.projectCatalogSubscription.update({ where: { organizationId_projectId: s.scope }, data: { version: { increment: 1 } } });
      await tx.projectCatalogSubscriptionSelection.create({ data: { ...s.scope, developmentUid: s.otherDevelopmentUid, decision: "EXCLUDE" } });
    });
    await expect(publication(s.scope, (tx) => createSnapshotPublicationCatalogReader(tx)(s.scope, s.anchors)))
      .rejects.toThrow("SNAPSHOT_PUBLICATION_CATALOG_STALE");
    await publication(s.scope, (tx) => createSnapshotRollbackCatalogReader(tx)(s.scope, s.anchors));
    expect(s.anchors).toEqual(original);
    await publication(s.scope, (tx) => expect(createSnapshotRollbackCatalogReader(tx)(s.scope, s.anchors))
      .rejects.toThrow("SNAPSHOT_ROLLBACK_CATALOG_ACCESS_DENIED"), "*");
    await runInPrincipalDatabaseTransaction(admin, (tx) => tx.projectCatalogSubscriptionSelection.update({
      where: { organizationId_projectId_developmentUid: { ...s.scope, developmentUid: s.developmentUid } }, data: { decision: "EXCLUDE" } }));
    await expect(publication(s.scope, (tx) => createSnapshotRollbackCatalogReader(tx)(s.scope, s.anchors)))
      .rejects.toThrow("SNAPSHOT_ROLLBACK_CATALOG_DENIED");
  });
  it("allows name/version changes and unrelated additions without querying a live cohort", async () => {
    const setup = await fixture();
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      await tx.developer.update({ where: { uid: setup.developerUid }, data: { name: "Synthetic rename", version: { increment: 1 } } });
      await tx.development.update({ where: { uid: setup.developmentUid }, data: { name: "Synthetic rename", version: { increment: 1 } } });
      await tx.building.update({ where: { uid: setup.buildingUid }, data: { label: "Synthetic rename", version: { increment: 1 } } });
      await tx.building.create({ data: { uid: createUlid(), developmentUid: setup.developmentUid, label: "Synthetic new", normalizedLabel: "new" } });
    });
    await publication(setup.scope, async (tx) => {
      const developers = vi.spyOn(tx.developer, "findMany"); const developments = vi.spyOn(tx.development, "findMany"); const buildings = vi.spyOn(tx.building, "findMany");
      try {
        await createSnapshotPublicationCatalogReader(tx)(setup.scope, setup.anchors);
        for (const trace of [developers, developments, buildings]) {
          expect(trace.mock.calls).toHaveLength(1);
          expect(JSON.stringify(trace.mock.calls)).not.toMatch(/name|version|price|address|latitude|longitude|aliases/u);
          expect(trace.mock.calls[0]![0]!.take).toBe(201);
          expect(trace.mock.calls[0]![0]!.where!.uid).toHaveProperty("in");
        }
      } finally { developers.mockRestore(); developments.mockRestore(); buildings.mockRestore(); }
    });
  });
  it.each(["version", "mode", "city-add", "city-delete", "selection-add", "selection-delete", "selection-decision",
    "developer-inactive", "developer-merge", "development-inactive", "development-merge", "developer-parent", "city-parent", "district-parent",
    "building-inactive", "building-merge", "building-parent"])("rejects changed %s without live regeneration", async (mode) => {
    const s = await fixture();
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      if (mode === "version") await tx.projectCatalogSubscription.update({ where: { organizationId_projectId: s.scope }, data: { version: { increment: 1 } } });
      if (mode === "mode") await tx.projectCatalogSubscription.update({ where: { organizationId_projectId: s.scope }, data: { mode: "ALL_SHARED" } });
      if (mode === "city-add") await tx.projectCatalogSubscriptionCity.create({ data: { ...s.scope, cityUid: s.otherCityUid } });
      if (mode === "city-delete") await tx.projectCatalogSubscriptionCity.delete({ where: { organizationId_projectId_cityUid: { ...s.scope, cityUid: s.cityUid } } });
      if (mode === "selection-add") await tx.projectCatalogSubscriptionSelection.create({ data: { ...s.scope, developmentUid: s.otherDevelopmentUid, decision: "EXCLUDE" } });
      if (mode === "selection-delete") await tx.projectCatalogSubscriptionSelection.delete({ where: { organizationId_projectId_developmentUid: { ...s.scope, developmentUid: s.developmentUid } } });
      if (mode === "selection-decision") await tx.projectCatalogSubscriptionSelection.update({ where: { organizationId_projectId_developmentUid: { ...s.scope, developmentUid: s.developmentUid } }, data: { decision: "EXCLUDE" } });
      if (mode.startsWith("city-") || mode.startsWith("selection-")) expect((await tx.projectCatalogSubscription.findUniqueOrThrow({ where: { organizationId_projectId: s.scope } })).version).toBe(1);
      if (mode === "developer-inactive") await tx.developer.update({ where: { uid: s.developerUid }, data: { lifecycle: "INACTIVE" } });
      if (mode === "developer-merge") await tx.developer.update({ where: { uid: s.developerUid }, data: { mergedIntoUid: s.otherDeveloperUid } });
      if (mode === "development-inactive") await tx.development.update({ where: { uid: s.developmentUid }, data: { lifecycle: "ARCHIVED" } });
      if (mode === "development-merge") await tx.development.update({ where: { uid: s.developmentUid }, data: { mergedIntoUid: s.otherDevelopmentUid } });
      if (mode === "developer-parent") await tx.development.update({ where: { uid: s.developmentUid }, data: { developerUid: s.otherDeveloperUid } });
      if (mode === "city-parent") await tx.development.update({ where: { uid: s.developmentUid }, data: { cityUid: s.otherCityUid } });
      if (mode === "district-parent") await tx.development.update({ where: { uid: s.developmentUid }, data: { districtUid: s.districtUid } });
      if (mode === "building-inactive") await tx.building.update({ where: { uid: s.buildingUid }, data: { lifecycle: "INACTIVE" } });
      if (mode === "building-merge") await tx.building.update({ where: { uid: s.buildingUid }, data: { mergedIntoUid: s.otherBuildingUid } });
      if (mode === "building-parent") await tx.building.update({ where: { uid: s.buildingUid }, data: { developmentUid: s.otherDevelopmentUid } });
    });
    await expect(publication(s.scope, (tx) => createSnapshotPublicationCatalogReader(tx)(s.scope, s.anchors))).rejects.toThrow("SNAPSHOT_PUBLICATION_CATALOG_STALE");
  });
  it("isolates populated foreign subscriptions and denies broad/legacy scopes before global metadata reads", async () => {
    const s = await fixture();
    for (const projects of ["*", [], [s.scope.projectId, s.foreignId], [s.foreignId]] as const) {
      await publication(s.scope, async (tx) => {
        const foreign = projects.length === 1 && projects[0] === s.foreignId ? 1 : 0;
        expect(await tx.projectCatalogSubscription.count()).toBe(foreign);
        expect(await tx.projectCatalogSubscriptionCity.count()).toBe(foreign);
        expect(await tx.projectCatalogSubscriptionSelection.count()).toBe(foreign);
        const global = vi.spyOn(tx.development, "findMany");
        try { await expect(createSnapshotPublicationCatalogReader(tx)(s.scope, s.anchors)).rejects.toThrow("SNAPSHOT_PUBLICATION_CATALOG_ACCESS_DENIED");
          expect(global).not.toHaveBeenCalled(); } finally { global.mockRestore(); }
      }, projects);
    }
    await publication(s.scope, async (tx) => {
      expect(await tx.projectCatalogSubscription.count()).toBe(0); expect(await tx.developer.count()).toBe(0);
      await expect(createSnapshotPublicationCatalogReader(tx)(s.scope, s.anchors)).rejects.toThrow("SNAPSHOT_PUBLICATION_CATALOG_ACCESS_DENIED");
    }, [s.scope.projectId], "job");
    await publication(s.scope, (tx) => expect(createSnapshotPublicationCatalogReader(tx)(s.scope, s.anchors))
      .rejects.toThrow("SNAPSHOT_PUBLICATION_CATALOG_ACCESS_DENIED"), [s.scope.projectId], "project-job", "synthetic-other-job");
  });
  it("serializes actual child membership INSERT before rows and rejects it after commit without a version bump", async () => {
    const s = await fixture(); const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });
    const writer = new pg.Client({ host: target.host, port: target.port, database: target.database,
      user: target.user, password: target.password, ssl: target.sslmode === "require", options: "-c timezone=UTC" });
    await writer.connect(); let pending: Promise<{ error: unknown; count: number | null }> | undefined;
    try {
      await writer.query("BEGIN"); await writer.query("SET LOCAL ROLE ams_data_hub_web");
      await writer.query("SET LOCAL lock_timeout='2s'"); await writer.query("SELECT set_config('app.principal_kind','platform-admin',true)");
      expect((await writer.query("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user")).rows)
        .toEqual([{ rolbypassrls: false, rolsuper: false }]);
      const pid = (await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      await publication(s.scope, async (tx) => {
        const read = createSnapshotPublicationCatalogReader(tx); await read(s.scope, s.anchors);
        pending = writer.query('INSERT INTO "ProjectCatalogSubscriptionCity" ("organizationId","projectId","cityUid") VALUES ($1,$2,$3)',
          [s.scope.organizationId, s.scope.projectId, s.otherCityUid])
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
      await publication(s.scope, async (tx) => {
        expect((await tx.projectCatalogSubscription.findUniqueOrThrow({ where: { organizationId_projectId: s.scope } })).version).toBe(1);
        await expect(createSnapshotPublicationCatalogReader(tx)(s.scope, s.anchors)).rejects.toThrow("SNAPSHOT_PUBLICATION_CATALOG_STALE");
      });
    } finally { if (pending) await pending; await writer.query("ROLLBACK"); await writer.end(); }
  });
  it("admits 401 actual selected rows per entity through three bounded pages under the same five-second cut", async () => {
    const s = await fixture(); const suffix = randomUUID().slice(0, 8); const cityUid = createUlid();
    const rows = Array.from({ length: 401 }, () => ({ developer: createUlid(), development: createUlid(), building: createUlid() }));
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const city = await tx.city.findUniqueOrThrow({ where: { uid: s.cityUid } });
      await tx.city.create({ data: { uid: cityUid, regionUid: city.regionUid, name: "Synthetic paged catalog", normalizedName: `paged-${suffix}` } });
      await tx.developer.createMany({ data: rows.map((row) => ({ uid: row.developer, name: "Synthetic paged developer", normalizedName: `paged-${row.developer.toLowerCase()}` })) });
      await tx.development.createMany({ data: rows.map((row) => ({ uid: row.development, developerUid: row.developer,
        cityUid, name: "Synthetic paged development", normalizedName: `paged-${row.development.toLowerCase()}` })) });
      await tx.building.createMany({ data: rows.map((row) => ({ uid: row.building, developmentUid: row.development, label: "Synthetic paged building", normalizedLabel: "paged" })) });
      await tx.projectCatalogSubscription.update({ where: { organizationId_projectId: s.scope }, data: { mode: "ALL_SHARED", version: { increment: 1 } } });
      await tx.projectCatalogSubscriptionCity.deleteMany({ where: s.scope });
      await tx.projectCatalogSubscriptionCity.create({ data: { ...s.scope, cityUid } });
    });
    const receipt = await captureSnapshotInput(createProjectJobPrincipal({ ...s.scope, jobName: "snapshot-input" }),
      { ...s.scope, idempotencyKey: "synthetic-paged-catalog", schemaMinor: 0 });
    const parts = validateSnapshotInput(receipt); const selection = selectSnapshotCatalog(receipt); const catalog = projectSnapshotCatalog(receipt, selection);
    const anchors = prepareSnapshotPublicationCatalogAnchors({ projectId: receipt.projectId,
      subscriptions: parts.filter((part) => part.kind === "subscription").flatMap((part) => part.payload),
      catalog: parts.filter((part) => part.kind === "catalog").flatMap((part) => part.payload),
      publishedDevelopers: new Set(catalog.find((row) => row.kind === "developers")!.records.map((row) => row.key)),
      publishedDevelopments: selection.developmentUids, publishedBuildings: selection.buildingUids });
    expect([anchors.developers.length, anchors.developments.length, anchors.buildings.length]).toEqual([401, 401, 401]);
    const started = performance.now();
    await publication(s.scope, async (tx) => {
      const developers = vi.spyOn(tx.developer, "findMany"); const developments = vi.spyOn(tx.development, "findMany"); const buildings = vi.spyOn(tx.building, "findMany");
      try {
        await createSnapshotPublicationCatalogReader(tx)(s.scope, anchors);
        for (const trace of [developers, developments, buildings]) {
          expect(trace.mock.calls).toHaveLength(3);
          expect(trace.mock.calls.every(([args]) => args!.take === 201)).toBe(true);
          expect(trace.mock.calls.map(([args]) => {
            const uid = args!.where!.uid; if (!uid || typeof uid === "string" || !Array.isArray(uid.in)) throw new Error("SYNTHETIC_PAGE_QUERY_INVALID");
            return uid.in.length;
          })).toEqual([200, 200, 1]);
        }
      } finally { developers.mockRestore(); developments.mockRestore(); buildings.mockRestore(); }
    });
    expect(performance.now() - started).toBeLessThan(5000);
  }, 30_000);
});
