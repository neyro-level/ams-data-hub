import { createUlid } from "@ams-data-hub/data-contracts";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";
import type { CatalogAuditInput } from "../../src/modules/shared-catalog/application/ports/shared-catalog-repository.ts";
import { createSharedCatalogCommands } from "../../src/modules/shared-catalog/application/shared-catalog-commands.ts";
import { PrismaSharedCatalogRepository } from "../../src/modules/shared-catalog/infrastructure/prisma-shared-catalog-repository.ts";
import type { PlatformAdminPrincipal, TenantUserPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });

function platformAdmin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `catalog-admin-${randomUUID()}`, correlationId: randomUUID() };
}

class FailingAuditRepository extends PrismaSharedCatalogRepository {
  override appendAudit(input: CatalogAuditInput): Promise<void> {
    void input;
    return Promise.reject(new Error("SHARED_CATALOG_AUDIT_FAILURE"));
  }
}

describe("shared catalog commands", () => {
  it("commits developer, development and building writes with audit events", async () => {
    const principal = platformAdmin();
    const commands = createSharedCatalogCommands({
      createRepository: (transaction) => new PrismaSharedCatalogRepository(transaction),
    });
    const city = await runInPrincipalDatabaseTransaction(principal, (transaction) =>
      transaction.city.findFirstOrThrow({ where: { normalizedName: "краснодар" }, select: { uid: true } }));
    const suffix = randomUUID().slice(0, 8);
    const developer = await commands.createDeveloper(principal, {
      name: `Застройщик ${suffix}`, aliases: [` Девелопер   ${suffix} `], lifecycle: "ACTIVE",
    });
    const development = await commands.createDevelopment(principal, {
      developerUid: developer.uid, cityUid: city.uid, name: `ЖК ${suffix}`,
      aliases: [`Комплекс ${suffix}`], lifecycle: "ACTIVE",
    });
    const building = await commands.createBuilding(principal, {
      developmentUid: development.uid, label: "Корпус 1", floors: 18,
      commissioningYear: 2028, commissioningQuarter: 2,
      constructionStatus: "UNDER_CONSTRUCTION", material: "Монолит",
      housingClass: "Комфорт", lifecycle: "ACTIVE", aliases: ["Литер 1"],
    });

    const state = await runInPrincipalDatabaseTransaction(principal, async (transaction) => ({
      developer: await transaction.developer.findUniqueOrThrow({
        where: { uid: developer.uid }, include: { aliases: true },
      }),
      building: await transaction.building.findUniqueOrThrow({ where: { uid: building.uid } }),
      audits: await transaction.auditEvent.count({
        where: { correlationId: principal.correlationId, source: "shared-catalog" },
      }),
    }));
    expect(state.developer.aliases[0]?.normalizedValue).toBe(`девелопер ${suffix}`);
    expect(state.building.constructionStatus).toBe("UNDER_CONSTRUCTION");
    expect(state.audits).toBe(3);
  });

  it("rolls back a catalog write when its audit append fails", async () => {
    const principal = platformAdmin();
    const suffix = randomUUID().slice(0, 8);
    const commands = createSharedCatalogCommands({
      createRepository: (transaction) => new FailingAuditRepository(transaction),
    });
    await expect(commands.createDeveloper(principal, {
      name: `Rollback ${suffix}`, aliases: [], lifecycle: "ACTIVE",
    })).rejects.toThrow("SHARED_CATALOG_AUDIT_FAILURE");
    const count = await runInPrincipalDatabaseTransaction(principal, (transaction) =>
      transaction.developer.count({ where: { normalizedName: `rollback ${suffix}` } }));
    expect(count).toBe(0);
  });

  it("relinks and merges dependants atomically and rejects tenant writes", async () => {
    const principal = platformAdmin();
    const commands = createSharedCatalogCommands({
      createRepository: (transaction) => new PrismaSharedCatalogRepository(transaction),
    });
    const city = await runInPrincipalDatabaseTransaction(principal, (transaction) =>
      transaction.city.findFirstOrThrow({ where: { normalizedName: "краснодар" }, select: { uid: true } }));
    const suffix = randomUUID().slice(0, 8);
    const first = await commands.createDeveloper(principal, { name: `Первый ${suffix}`, lifecycle: "ACTIVE", aliases: [] });
    const second = await commands.createDeveloper(principal, { name: `Второй ${suffix}`, lifecycle: "ACTIVE", aliases: [] });
    const development = await commands.createDevelopment(principal, {
      developerUid: first.uid, cityUid: city.uid, name: `Проект ${suffix}`, lifecycle: "ACTIVE", aliases: [],
    });
    await commands.relinkEntity(principal, {
      entityType: "DEVELOPMENT", uid: development.uid, version: 1,
      developerUid: second.uid, cityUid: city.uid, districtUid: null,
    });
    const merged = await commands.mergeEntity(principal, {
      entityType: "DEVELOPER", sourceUid: first.uid, targetUid: second.uid, sourceVersion: 1,
    });
    const state = await runInPrincipalDatabaseTransaction(principal, async (transaction) => ({
      development: await transaction.development.findUniqueOrThrow({ where: { uid: development.uid } }),
      source: await transaction.developer.findUniqueOrThrow({ where: { uid: first.uid } }),
      audit: await transaction.auditEvent.count({
        where: { correlationId: principal.correlationId, action: { in: ["development.relink", "developer.merge"] } },
      }),
    }));
    expect(merged.version).toBe(2);
    expect(state.development.developerUid).toBe(second.uid);
    expect(state.source).toMatchObject({ lifecycle: "ARCHIVED", mergedIntoUid: second.uid, version: 2 });
    expect(state.audit).toBe(2);

    const tenant: TenantUserPrincipal = {
      kind: "tenant-user", userId: `tenant-${suffix}`, organizationId: `org-${suffix}`,
      membershipId: `member-${suffix}`, role: "ORG_OWNER", correlationId: randomUUID(),
    };
    await expect(commands.createDeveloper(tenant, {
      name: `Запрещено ${suffix}`, lifecycle: "ACTIVE", aliases: [],
    })).rejects.toThrow("SHARED_CATALOG_ADMIN_ACCESS_DENIED");
  });

  it("denies a direct tenant write at the PostgreSQL RLS boundary", async () => {
    const client = new pg.Client({
      host: target.host, port: target.port, database: target.database,
      user: target.user, password: target.password, ssl: target.sslmode === "require",
    });
    await client.connect();
    try {
      await client.query("set role ams_data_hub_web");
      await client.query("begin");
      await client.query("select set_config('app.principal_kind', 'tenant-user', true)");
      await expect(client.query(
        'insert into "Developer" ("uid", "name", "normalizedName", "updatedAt") values ($1, $2, $3, now())',
        [createUlid(), "Запрещённый застройщик", "запрещённый застройщик"],
      )).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback");
    } finally {
      await client.end();
    }
  });
});
