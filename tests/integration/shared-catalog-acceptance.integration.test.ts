import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  catalogSubscriptionCommands,
  getProjectCatalogSnapshotSelection,
  sharedCatalogCommands,
} from "../../src/modules/shared-catalog/server.ts";
import type { PlatformAdminPrincipal, TenantUserPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

function platformAdmin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `catalog-acceptance-${randomUUID()}`, correlationId: randomUUID() };
}

describe("DH-03 shared catalog acceptance", () => {
  it("reuses one three-region catalog across projects without leaking project state", async () => {
    const admin = platformAdmin();
    const suffix = randomUUID().slice(0, 8);
    const setup = await runInPrincipalDatabaseTransaction(admin, async (transaction) => {
      const organization = await transaction.organization.create({
        data: { name: `Acceptance Org ${suffix}`, slug: `acceptance-org-${suffix}` },
      });
      const firstProject = await transaction.project.create({
        data: { organizationId: organization.id, name: `Three Regions ${suffix}`, slug: `three-regions-${suffix}` },
      });
      const secondProject = await transaction.project.create({
        data: { organizationId: organization.id, name: `Curated Region ${suffix}`, slug: `curated-region-${suffix}` },
      });
      const cities = await transaction.city.findMany({
        where: { uid: { in: [
          "01M41T6Q04BADHXSERJHZFXKCH",
          "01M41T6Q052F51RZX5628BV9N6",
          "01M41T6Q06MZSPS0T4TQKDA8QC",
        ] } },
        select: { uid: true, region: { select: { code: true } } },
        orderBy: { region: { code: "asc" } },
      });
      return {
        organizationId: organization.id,
        firstProjectId: firstProject.id,
        secondProjectId: secondProject.id,
        cities,
      };
    });
    expect(setup.cities.map((city) => city.region.code)).toEqual(["RU-KDA", "RU-ROS", "RU-SEV"]);

    const developer = await sharedCatalogCommands.createDeveloper(admin, {
      name: `Acceptance Developer ${suffix}`,
      lifecycle: "ACTIVE",
      aliases: [],
    });
    const developments: Array<{ uid: string }> = [];
    for (const city of setup.cities) {
      developments.push(await sharedCatalogCommands.createDevelopment(admin, {
        developerUid: developer.uid,
        cityUid: city.uid,
        name: `Acceptance ${city.region.code} ${suffix}`,
        lifecycle: "ACTIVE",
        aliases: [],
      }));
    }

    await catalogSubscriptionCommands.replaceProjectSubscription(admin, {
      organizationId: setup.organizationId,
      projectId: setup.firstProjectId,
      mode: "ALL_SHARED",
      version: 0,
      cityUids: setup.cities.map((city) => city.uid),
      selections: [],
    });
    await catalogSubscriptionCommands.replaceProjectSubscription(admin, {
      organizationId: setup.organizationId,
      projectId: setup.secondProjectId,
      mode: "CURATED",
      version: 0,
      cityUids: [],
      selections: [{ developmentUid: developments[1].uid, decision: "INCLUDE" }],
    });

    const tenant: TenantUserPrincipal = {
      kind: "tenant-user",
      userId: `acceptance-tenant-${suffix}`,
      organizationId: setup.organizationId,
      membershipId: `acceptance-membership-${suffix}`,
      role: "ORG_ADMIN",
      projectIds: "*",
      correlationId: randomUUID(),
    };
    const first = await getProjectCatalogSnapshotSelection(tenant, {
      organizationId: setup.organizationId,
      projectId: setup.firstProjectId,
    });
    const second = await getProjectCatalogSnapshotSelection(tenant, {
      organizationId: setup.organizationId,
      projectId: setup.secondProjectId,
    });

    expect(first).toMatchObject({ projectId: setup.firstProjectId, mode: "ALL_SHARED" });
    const ownedDevelopmentUids = new Set(developments.map((item) => item.uid));
    expect(first.developments.filter((item) => ownedDevelopmentUids.has(item.uid)).map((item) => item.uid).sort())
      .toEqual(developments.map((item) => item.uid).sort());
    expect(second).toMatchObject({ projectId: setup.secondProjectId, mode: "CURATED" });
    expect(second.developments.map((item) => item.uid)).toEqual([developments[1].uid]);
    expect(first.developments.find((item) => item.uid === developments[1].uid)).toEqual(second.developments[0]);

    const persisted = await runInPrincipalDatabaseTransaction(admin, async (transaction) => ({
      sharedDevelopmentCount: await transaction.development.count({
        where: { uid: { in: developments.map((item) => item.uid) } },
      }),
      firstSelectionCount: await transaction.projectCatalogSubscriptionSelection.count({
        where: { organizationId: setup.organizationId, projectId: setup.firstProjectId },
      }),
      secondSelectionCount: await transaction.projectCatalogSubscriptionSelection.count({
        where: { organizationId: setup.organizationId, projectId: setup.secondProjectId },
      }),
    }));
    expect(persisted).toEqual({ sharedDevelopmentCount: 3, firstSelectionCount: 0, secondSelectionCount: 1 });

    const foreignTenant: TenantUserPrincipal = {
      ...tenant,
      userId: `foreign-${suffix}`,
      organizationId: `foreign-${suffix}`,
      membershipId: `foreign-member-${suffix}`,
    };
    await expect(getProjectCatalogSnapshotSelection(foreignTenant, {
      organizationId: setup.organizationId,
      projectId: setup.firstProjectId,
    })).rejects.toThrow("SHARED_CATALOG_SUBSCRIPTION_ACCESS_DENIED");
  });
});
