import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { newbuildingImportCommands, sharedCatalogCommands } from "../../src/modules/shared-catalog/server.ts";
import { createNewbuildingImportCommands } from "../../src/modules/shared-catalog/application/newbuilding-import-commands.ts";
import { PrismaNewbuildingImportRepository } from "../../src/modules/shared-catalog/infrastructure/prisma-newbuilding-import-repository.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";

const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });
const client = new pg.Client({
  host: target.host,
  port: target.port,
  database: target.database,
  user: target.user,
  password: target.password,
  ssl: target.sslmode === "require",
});

beforeAll(() => client.connect());
afterAll(() => client.end());

const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "newbuilding-fixture-operator", correlationId: "newbuilding-fixture" };

async function fixture() {
  const suffix = randomUUID().slice(0, 8);
  const scope = await runInPrincipalDatabaseTransaction(admin, async (transaction) => {
    const organization = await transaction.organization.create({ data: { name: suffix, slug: "nb-" + suffix } });
    const project = await transaction.project.create({ data: { organizationId: organization.id, name: suffix, slug: "nb-" + suffix } });
    const source = await transaction.source.create({ data: {
      organizationId: organization.id, projectId: project.id, name: suffix, sourceKey: "nb-" + suffix,
      adapterKey: "manual", adapterVersion: "1", profileKey: "manual", profileVersion: "1",
      datasetType: "NEW_BUILD", schedulePolicy: { mode: "MANUAL_ONLY" },
    } });
    const city = await transaction.city.findFirstOrThrow();
    return { organizationId: organization.id, projectId: project.id, sourceId: source.id, cityUid: city.uid };
  });
  const developer = await sharedCatalogCommands.createDeveloper(admin, { name: "Fixture " + suffix, lifecycle: "ACTIVE", aliases: [] });
  return {
    organizationId: scope.organizationId, projectId: scope.projectId,
    payload: {
      source: { sourceId: scope.sourceId, externalId: "development-1", observedAt: "2026-10-05T12:00:00.000Z" },
      target: { developmentUid: null, developerUid: developer.uid, cityUid: scope.cityUid, districtUid: null },
      development: { name: "Fixture " + suffix, addressLine: "Fixture street", latitude: 47.2, longitude: 39.7 },
      prices: [{ externalId: "lot-1", amount: 1000000, currency: "RUB", basis: "TOTAL" as const, areaM2: 40, roomCount: 1 }],
      media: [{ externalId: "media-1", sourceUrl: "https://example.invalid/fixture.jpg", position: 0, rightsBasis: "LICENSED" as const, attribution: "Fixture", license: null }],
    },
  };
}

describe("new-building import database foundation", () => {
  it("upgrades existing development rows without data loss", async () => {
    const input = await fixture();
    const development = await sharedCatalogCommands.createDevelopment(admin, {
      developerUid: input.payload.target.developerUid, cityUid: input.payload.target.cityUid,
      name: "Upgrade " + randomUUID(), lifecycle: "ACTIVE", aliases: [],
    });
    await client.query("BEGIN");
    try {
      await client.query('DROP TABLE "SharedMediaAsset", "PriceObservation", "DevelopmentExternalIdentity"; DROP TYPE "PriceObservationBasis"; DROP INDEX "Building_developmentUid_uid_key"; ALTER TABLE "Development" DROP COLUMN "addressLine", DROP COLUMN "latitude", DROP COLUMN "longitude"');
      await client.query(readFileSync("prisma/migrations/20261005210000_newbuilding_import_foundation/migration.sql", "utf8"));
      const row = await client.query('SELECT "uid", "addressLine", "latitude", "longitude" FROM "Development" WHERE "uid"=$1', [development.uid]);
      expect(row.rows[0]).toEqual({ uid: development.uid, addressLine: null, latitude: null, longitude: null });
    } finally { await client.query("ROLLBACK"); }
  });

  it("previews without writes, applies atomically, and rejects stale or conflicting reviews", async () => {
    const input = await fixture();
    const preview = await newbuildingImportCommands.preview(admin, input);
    const before = await client.query('SELECT count(*)::int AS count FROM "DevelopmentExternalIdentity" WHERE "projectId"=$1', [input.projectId]);
    expect(before.rows[0].count).toBe(0);
    const result = await newbuildingImportCommands.apply(admin, { ...input, confirmed: true, reviewedPlanSha256: preview.planSha256 });
    const state = await client.query('SELECT "addressLine", "version" FROM "Development" WHERE "uid"=$1', [result.uid]);
    expect(state.rows[0]).toEqual({ addressLine: "Fixture street", version: 1 });
    await expect(newbuildingImportCommands.apply(admin, { ...input, confirmed: true, reviewedPlanSha256: preview.planSha256 })).rejects.toThrow("NEWBUILDING_REVIEW_STALE");
    const repeated = await newbuildingImportCommands.preview(admin, input);
    expect(repeated.plan.newPriceKeys).toEqual([]);
    expect(repeated.plan.newMediaUrls).toEqual([]);
    await newbuildingImportCommands.apply(admin, { ...input, confirmed: true, reviewedPlanSha256: repeated.planSha256 });
    const observations = await client.query('SELECT count(*)::int AS count FROM "PriceObservation" WHERE "projectId"=$1', [input.projectId]);
    expect(observations.rows[0].count).toBe(1);
    const altered = { ...input, payload: { ...input.payload, prices: [{ ...input.payload.prices[0]!, amount: 2000000 }] } };
    const reviewed = await newbuildingImportCommands.preview(admin, altered);
    await expect(newbuildingImportCommands.apply(admin, { ...altered, confirmed: true, reviewedPlanSha256: reviewed.planSha256 })).rejects.toThrow("NEWBUILDING_PRICE_OBSERVATION_CONFLICT");
    const version = await client.query('SELECT "version" FROM "Development" WHERE "uid"=$1', [result.uid]);
    expect(version.rows[0].version).toBe(2);
  });

  it("rolls back development, prices and media when audit fails", async () => {
    const input = await fixture();
    const preview = await newbuildingImportCommands.preview(admin, input);
    const failing = createNewbuildingImportCommands({ createRepository: (transaction) => {
      const repository = new PrismaNewbuildingImportRepository(transaction);
      repository.appendAudit = async () => { throw new Error("AUDIT_FIXTURE_FAILURE"); };
      return repository;
    } });
    await expect(failing.apply(admin, { ...input, confirmed: true, reviewedPlanSha256: preview.planSha256 })).rejects.toThrow("AUDIT_FIXTURE_FAILURE");
    for (const table of ["DevelopmentExternalIdentity", "PriceObservation", "SharedMediaAsset"]) {
      const rows = await client.query(`SELECT count(*)::int AS count FROM "${table}" WHERE "projectId"=$1`, [input.projectId]);
      expect(rows.rows[0].count).toBe(0);
    }
    const development = await client.query('SELECT count(*)::int AS count FROM "Development" WHERE "name"=$1', [input.payload.development.name]);
    expect(development.rows[0].count).toBe(0);
  });

  it("denies missing context, other projects, tenants writes and cross-project source links", async () => {
    const input = await fixture();
    const preview = await newbuildingImportCommands.preview(admin, input);
    await newbuildingImportCommands.apply(admin, { ...input, confirmed: true, reviewedPlanSha256: preview.planSha256 });
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE ams_data_hub_web");
      for (const table of ["DevelopmentExternalIdentity", "PriceObservation", "SharedMediaAsset"]) {
        expect((await client.query(`SELECT * FROM "${table}" WHERE "projectId"=$1`, [input.projectId])).rows).toEqual([]);
      }
      await client.query("SELECT set_config('app.principal_kind','tenant-user',true), set_config('app.organization_id',$1,true), set_config('app.project_ids',$2,true)", [input.organizationId, input.projectId]);
      expect((await client.query('SELECT * FROM "PriceObservation" WHERE "projectId"=$1', [input.projectId])).rows).toHaveLength(1);
      expect((await client.query('UPDATE "PriceObservation" SET "amount"=2 WHERE "projectId"=$1 RETURNING "id"', [input.projectId])).rows).toEqual([]);
      await client.query("SELECT set_config('app.project_ids','unrelated-project',true)");
      expect((await client.query('SELECT * FROM "PriceObservation" WHERE "projectId"=$1', [input.projectId])).rows).toEqual([]);
      await client.query("SELECT set_config('app.organization_id','unrelated-organization',true), set_config('app.project_ids','*',true)");
      expect((await client.query('SELECT * FROM "SharedMediaAsset" WHERE "projectId"=$1', [input.projectId])).rows).toEqual([]);
    } finally { await client.query("ROLLBACK"); }
    const other = await fixture();
    await expect(client.query('UPDATE "DevelopmentExternalIdentity" SET "sourceId"=$1 WHERE "projectId"=$2', [other.payload.source.sourceId, input.projectId])).rejects.toThrow();
    const tenant = { kind: "tenant-user" as const, userId: "fixture", organizationId: input.organizationId, membershipId: "fixture", role: "ORG_ADMIN" as const, projectIds: "*" as const, correlationId: "fixture" };
    await expect(newbuildingImportCommands.preview(tenant, input)).rejects.toThrow("SHARED_CATALOG_ADMIN_ACCESS_DENIED");
  });
  it("installs geography, provenance, price and rights-bearing media models", async () => {
    const columns = await client.query<{ table_name: string; column_name: string }>(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public' and (
        (table_name = 'Development' and column_name in ('addressLine', 'latitude', 'longitude')) or
        table_name in ('DevelopmentExternalIdentity', 'PriceObservation', 'SharedMediaAsset')
      )
      order by table_name, column_name
    `);
    expect(columns.rows).toEqual(expect.arrayContaining([
      { table_name: "Development", column_name: "addressLine" },
      { table_name: "Development", column_name: "latitude" },
      { table_name: "Development", column_name: "longitude" },
      { table_name: "DevelopmentExternalIdentity", column_name: "externalId" },
      { table_name: "PriceObservation", column_name: "observedAt" },
      { table_name: "SharedMediaAsset", column_name: "rightsBasis" },
      { table_name: "SharedMediaAsset", column_name: "attribution" },
    ]));
  });

  it("enforces RLS and omits hard-delete grants for runtime roles", async () => {
    const tables = ["DevelopmentExternalIdentity", "PriceObservation", "SharedMediaAsset"];
    const rls = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
      select relname, relrowsecurity, relforcerowsecurity
      from pg_class
      where relname = any($1::text[])
      order by relname
    `, [tables]);
    expect(rls.rows).toHaveLength(3);
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const grants = await client.query<{ table_name: string; grantee: string; privilege_type: string }>(`
      select table_name, grantee, privilege_type
      from information_schema.role_table_grants
      where table_name = any($1::text[])
        and grantee in ('ams_data_hub_web', 'ams_data_hub_worker')
        and privilege_type = 'DELETE'
    `, [tables]);
    expect(grants.rows).toEqual([]);
  });
});
