import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";
import { createSharedCatalogCommands } from "../../src/modules/shared-catalog/application/shared-catalog-commands.ts";
import { getCatalogAdminData } from "../../src/modules/shared-catalog/application/shared-catalog-queries.ts";
import { PrismaSharedCatalogRepository } from "../../src/modules/shared-catalog/infrastructure/prisma-shared-catalog-repository.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });

function platformAdmin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `history-admin-${randomUUID()}`, correlationId: randomUUID() };
}

function commands() {
  return createSharedCatalogCommands({
    createRepository: (transaction) => new PrismaSharedCatalogRepository(transaction),
  });
}

describe("catalog provenance and immutable revisions", () => {
  it("records a manual revision and field provenance for every create and update", async () => {
    const principal = platformAdmin();
    const catalog = commands();
    const suffix = randomUUID().slice(0, 8);
    const created = await catalog.createDeveloper(principal, {
      name: `История ${suffix}`,
      lifecycle: "ACTIVE",
      aliases: [`Первое имя ${suffix}`],
    });
    await catalog.updateDeveloper(principal, {
      uid: created.uid,
      version: created.version,
      name: `Новая история ${suffix}`,
      lifecycle: "ACTIVE",
      aliases: [`Второе имя ${suffix}`],
    });

    const state = await runInPrincipalDatabaseTransaction(principal, async (transaction) => ({
      changeSets: await transaction.catalogChangeSet.findMany({
        where: { correlationId: principal.correlationId },
        orderBy: { createdAt: "asc" },
      }),
      versions: await transaction.catalogEntityVersion.findMany({
        where: { entityType: "DEVELOPER", entityUid: created.uid },
        orderBy: { version: "asc" },
        include: { provenance: { orderBy: { fieldPath: "asc" } } },
      }),
    }));

    expect(state.changeSets.map((item) => item.action)).toEqual(["developer.create", "developer.update"]);
    expect(state.changeSets.every((item) => item.source === "MANUAL_ADMIN" && item.actorId === principal.userId)).toBe(true);
    expect(state.versions.map((item) => [item.version, item.changeKind])).toEqual([[1, "CREATE"], [2, "UPDATE"]]);
    expect(state.versions[0]?.provenance.map((fact) => fact.fieldPath)).toEqual(expect.arrayContaining(["name", "aliases", "lifecycle", "version"]));
    expect(state.versions[1]?.provenance.map((fact) => fact.fieldPath)).toEqual(["aliases", "name", "version"]);
    expect(state.versions[1]?.snapshot).toMatchObject({ name: `Новая история ${suffix}`, aliases: [`Второе имя ${suffix}`], version: 2 });

    const adminData = await getCatalogAdminData(principal, {
      q: suffix, lifecycle: "ALL", regionUid: "", cityUid: "", developerUid: "",
    });
    expect(adminData.history.map((item) => [item.version, item.source])).toEqual([[2, "MANUAL_ADMIN"], [1, "MANUAL_ADMIN"]]);
  });

  it("covers development and building updates, relinks and batch creation", async () => {
    const principal = platformAdmin();
    const catalog = commands();
    const suffix = randomUUID().slice(0, 8);
    const city = await runInPrincipalDatabaseTransaction(principal, (transaction) =>
      transaction.city.findFirstOrThrow({ where: { normalizedName: "краснодар" }, select: { uid: true } }));
    const firstDeveloper = await catalog.createDeveloper(principal, { name: `Первый ${suffix}`, lifecycle: "ACTIVE", aliases: [] });
    const secondDeveloper = await catalog.createDeveloper(principal, { name: `Второй ${suffix}`, lifecycle: "ACTIVE", aliases: [] });
    const firstDevelopment = await catalog.createDevelopment(principal, { developerUid: firstDeveloper.uid, cityUid: city.uid, name: `Первый ЖК ${suffix}`, lifecycle: "ACTIVE", aliases: [] });
    const secondDevelopment = await catalog.createDevelopment(principal, { developerUid: secondDeveloper.uid, cityUid: city.uid, name: `Второй ЖК ${suffix}`, lifecycle: "ACTIVE", aliases: [] });
    const building = await catalog.createBuilding(principal, { developmentUid: firstDevelopment.uid, label: `Литер ${suffix}`, floors: 12, commissioningYear: 2028, commissioningQuarter: 3, constructionStatus: "UNDER_CONSTRUCTION", material: "Монолит", housingClass: "Комфорт", lifecycle: "ACTIVE", aliases: [] });
    const updatedDevelopment = await catalog.updateDevelopment(principal, { uid: firstDevelopment.uid, version: firstDevelopment.version, developerUid: firstDeveloper.uid, cityUid: city.uid, name: `Обновлённый ЖК ${suffix}`, lifecycle: "ACTIVE", aliases: [`Алиас ${suffix}`] });
    const updatedBuilding = await catalog.updateBuilding(principal, { uid: building.uid, version: building.version, developmentUid: firstDevelopment.uid, label: `Новый литер ${suffix}`, floors: 14, commissioningYear: 2029, commissioningQuarter: 1, constructionStatus: "UNDER_CONSTRUCTION", material: "Кирпич", housingClass: "Бизнес", lifecycle: "ACTIVE", aliases: [] });
    const relinkedDevelopment = await catalog.relinkEntity(principal, { entityType: "DEVELOPMENT", uid: firstDevelopment.uid, version: updatedDevelopment.version, developerUid: secondDeveloper.uid, cityUid: city.uid, districtUid: null });
    await catalog.relinkEntity(principal, { entityType: "BUILDING", uid: building.uid, version: updatedBuilding.version, developmentUid: secondDevelopment.uid });
    const batch = await catalog.createBuildingsBatch(principal, { developmentUid: firstDevelopment.uid, labels: [`Пакет 1 ${suffix}`, `Пакет 2 ${suffix}`], constructionStatus: "PLANNED", lifecycle: "ACTIVE" });

    const state = await runInPrincipalDatabaseTransaction(principal, async (transaction) => ({
      developmentVersions: await transaction.catalogEntityVersion.findMany({ where: { entityType: "DEVELOPMENT", entityUid: firstDevelopment.uid }, orderBy: { version: "asc" } }),
      buildingVersions: await transaction.catalogEntityVersion.findMany({ where: { entityType: "BUILDING", entityUid: building.uid }, orderBy: { version: "asc" } }),
      batchSet: await transaction.catalogChangeSet.findFirstOrThrow({ where: { correlationId: principal.correlationId, action: "building.create-batch" }, include: { entityVersions: true } }),
    }));
    expect(relinkedDevelopment.version).toBe(3);
    expect(state.developmentVersions.map((item) => [item.version, item.changeKind])).toEqual([[1, "CREATE"], [2, "UPDATE"], [3, "RELINK"]]);
    expect(state.buildingVersions.map((item) => [item.version, item.changeKind])).toEqual([[1, "CREATE"], [2, "UPDATE"], [3, "RELINK"]]);
    expect(batch.count).toBe(2);
    expect(state.batchSet.entityVersions).toHaveLength(2);
    expect(state.batchSet.entityVersions.every((item) => item.changeKind === "CREATE")).toBe(true);
  });

  it("versions merge reassignments for every affected shared entity in one change set", async () => {
    const principal = platformAdmin();
    const catalog = commands();
    const suffix = randomUUID().slice(0, 8);
    const city = await runInPrincipalDatabaseTransaction(principal, (transaction) =>
      transaction.city.findFirstOrThrow({ where: { normalizedName: "краснодар" }, select: { uid: true } }));
    const source = await catalog.createDeveloper(principal, { name: `Источник ${suffix}`, lifecycle: "ACTIVE", aliases: [] });
    const targetDeveloper = await catalog.createDeveloper(principal, { name: `Цель ${suffix}`, lifecycle: "ACTIVE", aliases: [] });
    const development = await catalog.createDevelopment(principal, {
      developerUid: source.uid,
      cityUid: city.uid,
      name: `Перенос ${suffix}`,
      lifecycle: "ACTIVE",
      aliases: [],
    });
    await catalog.mergeEntity(principal, {
      entityType: "DEVELOPER",
      sourceUid: source.uid,
      targetUid: targetDeveloper.uid,
      sourceVersion: source.version,
    });

    const mergeSet = await runInPrincipalDatabaseTransaction(principal, (transaction) =>
      transaction.catalogChangeSet.findFirstOrThrow({
        where: { correlationId: principal.correlationId, action: "developer.merge" },
        include: { entityVersions: { include: { provenance: true } } },
      }));
    expect(mergeSet.entityVersions.map((item) => [item.entityType, item.entityUid, item.version, item.changeKind]))
      .toEqual(expect.arrayContaining([
        ["DEVELOPER", source.uid, 2, "MERGE"],
        ["DEVELOPMENT", development.uid, 2, "MERGE_REASSIGN"],
      ]));
    const reassigned = mergeSet.entityVersions.find((item) => item.entityUid === development.uid);
    expect(reassigned?.provenance.map((fact) => fact.fieldPath)).toEqual(expect.arrayContaining(["developerUid", "version"]));
  });

  it("keeps history immutable and hides it from tenant runtime sessions", async () => {
    const principal = platformAdmin();
    const catalog = commands();
    const suffix = randomUUID().slice(0, 8);
    const developer = await catalog.createDeveloper(principal, {
      name: `Неизменяемая ${suffix}`, lifecycle: "ACTIVE", aliases: [],
    });
    const version = await runInPrincipalDatabaseTransaction(principal, (transaction) =>
      transaction.catalogEntityVersion.findFirstOrThrow({
        where: { entityType: "DEVELOPER", entityUid: developer.uid }, select: { id: true },
      }));

    const client = new pg.Client({
      host: target.host, port: target.port, database: target.database,
      user: target.user, password: target.password, ssl: target.sslmode === "require",
    });
    await client.connect();
    try {
      await expect(client.query('update "CatalogEntityVersion" set "version" = 99 where "id" = $1', [version.id]))
        .rejects.toMatchObject({ code: "55000" });
      await client.query("set role ams_data_hub_web");
      await client.query("begin");
      await client.query("select set_config('app.principal_kind', 'tenant-user', true)");
      const hidden = await client.query('select count(*)::int as count from "CatalogEntityVersion" where "entityUid" = $1', [developer.uid]);
      expect(hidden.rows[0]?.count).toBe(0);
      await client.query("rollback");
    } finally {
      await client.end();
    }
  });
});
