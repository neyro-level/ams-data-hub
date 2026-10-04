import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";
import {
  catalogSubscriptionCommands,
  getProjectCatalogSnapshotSelection,
  sharedCatalogCommands,
} from "../../src/modules/shared-catalog/server.ts";
import type { PlatformAdminPrincipal, TenantUserPrincipal } from "../../src/platform/authorization/principal.ts";
import {
  runInPrincipalDatabaseTransaction,
} from "../../src/platform/database/transaction.ts";

const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });

function platformAdmin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `subscription-admin-${randomUUID()}`, correlationId: randomUUID() };
}

describe("project catalog subscriptions", () => {
  it("lets two projects reuse one shared development without leaking subscription state", async () => {
    const admin = platformAdmin();
    const suffix = randomUUID().slice(0, 8);
    const setup = await runInPrincipalDatabaseTransaction(admin, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Synthetic Org ${suffix}`, slug: `synthetic-${suffix}` } });
      const firstProject = await transaction.project.create({ data: { organizationId: organization.id, name: `Project A ${suffix}`, slug: `project-a-${suffix}` } });
      const secondProject = await transaction.project.create({ data: { organizationId: organization.id, name: `Project B ${suffix}`, slug: `project-b-${suffix}` } });
      const city = await transaction.city.findFirstOrThrow({ where: { region: { code: "RU-KDA" } }, select: { uid: true } });
      return { organizationId: organization.id, firstProjectId: firstProject.id, secondProjectId: secondProject.id, cityUid: city.uid };
    });
    const developer = await sharedCatalogCommands.createDeveloper(admin, { name: `Synthetic Developer ${suffix}`, lifecycle: "ACTIVE", aliases: [] });
    const development = await sharedCatalogCommands.createDevelopment(admin, { developerUid: developer.uid, cityUid: setup.cityUid, name: `Synthetic Development ${suffix}`, lifecycle: "ACTIVE", aliases: [] });
    const building = await sharedCatalogCommands.createBuilding(admin, { developmentUid: development.uid, label: `Building ${suffix}`, floors: 12, commissioningYear: 2028, commissioningQuarter: 4, constructionStatus: "UNDER_CONSTRUCTION", material: "Synthetic", housingClass: "Test", lifecycle: "ACTIVE", aliases: [] });

    await catalogSubscriptionCommands.replaceProjectSubscription(admin, {
      organizationId: setup.organizationId, projectId: setup.firstProjectId,
      mode: "ALL_SHARED", version: 0, cityUids: [setup.cityUid], selections: [],
    });
    await catalogSubscriptionCommands.replaceProjectSubscription(admin, {
      organizationId: setup.organizationId, projectId: setup.secondProjectId,
      mode: "CURATED", version: 0, cityUids: [],
      selections: [{ developmentUid: development.uid, decision: "INCLUDE" }],
    });

    const tenant: TenantUserPrincipal = {
      kind: "tenant-user", userId: `tenant-${suffix}`, organizationId: setup.organizationId,
      membershipId: `membership-${suffix}`, role: "ORG_ADMIN",
      projectIds: [setup.firstProjectId, setup.secondProjectId], correlationId: randomUUID(),
    };
    const [firstSelection, secondSelection] = await Promise.all([
      getProjectCatalogSnapshotSelection(tenant, { organizationId: setup.organizationId, projectId: setup.firstProjectId }),
      getProjectCatalogSnapshotSelection(tenant, { organizationId: setup.organizationId, projectId: setup.secondProjectId }),
    ]);
    expect(firstSelection).toMatchObject({ projectId: setup.firstProjectId, mode: "ALL_SHARED" });
    expect(secondSelection).toMatchObject({ projectId: setup.secondProjectId, mode: "CURATED" });
    const sharedDevelopment = { uid: development.uid, developerUid: developer.uid, cityUid: setup.cityUid, buildingUids: [building.uid] };
    expect(firstSelection.developments).toContainEqual(sharedDevelopment);
    expect(secondSelection.developments).toEqual([sharedDevelopment]);

    const audits = await runInPrincipalDatabaseTransaction(admin, (transaction) => transaction.auditEvent.count({
      where: { organizationId: setup.organizationId, action: "catalog-subscription.replace", entityType: "ProjectCatalogSubscription" },
    }));
    expect(audits).toBe(2);

    const client = new pg.Client({ host: target.host, port: target.port, database: target.database, user: target.user, password: target.password, ssl: target.sslmode === "require" });
    await client.connect();
    try {
      await client.query("set role ams_data_hub_web");
      await client.query("begin");
      await client.query("select set_config('app.principal_kind', 'tenant-user', true)");
      await client.query("select set_config('app.actor_id', $1, true)", [tenant.userId]);
      await client.query("select set_config('app.organization_id', $1, true)", [setup.organizationId]);
      await client.query("select set_config('app.project_ids', $1, true)", [setup.firstProjectId]);
      const rows = await client.query<{ projectId: string }>('select "projectId" from "ProjectCatalogSubscription" order by "projectId"');
      expect(rows.rows).toEqual([{ projectId: setup.firstProjectId }]);
      const forbiddenUpdate = await client.query('update "ProjectCatalogSubscription" set "mode" = \'CURATED\' where "projectId" = $1', [setup.firstProjectId]);
      expect(forbiddenUpdate.rowCount).toBe(0);
      const unchanged = await client.query<{ mode: string }>('select "mode" from "ProjectCatalogSubscription" where "projectId" = $1', [setup.firstProjectId]);
      expect(unchanged.rows).toEqual([{ mode: "ALL_SHARED" }]);
      await client.query("rollback");
    } finally {
      await client.end();
    }
  });

  it("rejects stale replacement and cross-organization reads", async () => {
    const admin = platformAdmin();
    const suffix = randomUUID().slice(0, 8);
    const setup = await runInPrincipalDatabaseTransaction(admin, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Isolation Org ${suffix}`, slug: `isolation-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Isolation Project ${suffix}`, slug: `isolation-project-${suffix}` } });
      const city = await transaction.city.findFirstOrThrow({ where: { region: { code: "RU-KDA" } }, select: { uid: true } });
      return { organizationId: organization.id, projectId: project.id, cityUid: city.uid };
    });
    await catalogSubscriptionCommands.replaceProjectSubscription(admin, { organizationId: setup.organizationId, projectId: setup.projectId, mode: "ALL_SHARED", version: 0, cityUids: [setup.cityUid], selections: [] });
    await expect(catalogSubscriptionCommands.replaceProjectSubscription(admin, { organizationId: setup.organizationId, projectId: setup.projectId, mode: "ALL_SHARED", version: 0, cityUids: [setup.cityUid], selections: [] })).rejects.toThrow("SHARED_CATALOG_SUBSCRIPTION_STALE");

    const foreignTenant: TenantUserPrincipal = { kind: "tenant-user", userId: `foreign-${suffix}`, organizationId: `foreign-org-${suffix}`, membershipId: `foreign-member-${suffix}`, role: "ORG_VIEWER", projectIds: [setup.projectId], correlationId: randomUUID() };
    await expect(getProjectCatalogSnapshotSelection(foreignTenant, { organizationId: setup.organizationId, projectId: setup.projectId })).rejects.toThrow("SHARED_CATALOG_SUBSCRIPTION_ACCESS_DENIED");
  });
});
