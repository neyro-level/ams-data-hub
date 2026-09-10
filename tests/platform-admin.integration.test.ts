import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import {
  createMembership,
  createOrganization,
  removeMembership,
  updateMembership,
  updateOrganization,
} from "../src/modules/identity-access/server.ts";
import { requestProjectSync } from "../src/modules/platform-operations/server.ts";
import {
  changeProjectStatus,
  createProject,
  saveGoalDefinition,
  saveProviderConnection,
  saveQueryClusterProfile,
  saveSite,
  saveThresholdProfile,
  saveTrackedQuerySet,
  updateProjectSettings,
} from "../src/modules/project-registry/server.ts";
import type { PrincipalContext } from "../src/platform/authorization/principal.ts";
import { createPgPoolConfigFromEnvironment } from "../src/platform/database/prisma/pool-config.ts";

const integrationEnabled = Boolean(
  process.env.TEST_DATABASE_HOST &&
    process.env.TEST_DATABASE_USER &&
    process.env.TEST_DATABASE_PASSWORD &&
    process.env.TEST_DATABASE_NAME,
);
const integrationDescription = integrationEnabled ? describe : describe.skip;
const suffix = "platform-admin-integration";
const admin: PrincipalContext = {
  kind: "platform-admin",
  userId: `${suffix}-admin`,
  correlationId: "00000000-0000-4000-8000-000000000060",
};

integrationDescription("Platform Admin typed commands", () => {
  let prisma: PrismaClient;
  let pool: Pool;
  let organizationId = "";
  let membershipId = "";
  let projectId = "";
  let siteId = "";
  let providerId = "";
  let goalId = "";
  let trackedQuerySetId = "";
  let thresholdProfileId = "";
  let clusterProfileId = "";

  beforeAll(async () => {
    pool = new Pool(
      createPgPoolConfigFromEnvironment({
        DATABASE_HOST: process.env.TEST_DATABASE_HOST,
        DATABASE_PORT: process.env.TEST_DATABASE_PORT,
        DATABASE_USER: process.env.TEST_DATABASE_USER,
        DATABASE_PASSWORD: process.env.TEST_DATABASE_PASSWORD,
        DATABASE_NAME: process.env.TEST_DATABASE_NAME,
        DATABASE_SSLMODE: process.env.TEST_DATABASE_SSLMODE,
      }),
    );
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    await cleanup();
  });

  async function cleanup() {
    const organizations = await prisma.organization.findMany({
      where: { slug: { in: [`${suffix}`, `${suffix}-other`] } },
      select: { id: true },
    });
    const organizationIds = organizations.map((item) => item.id);
    const projects = await prisma.project.findMany({
      where: { slug: { in: [`${suffix}`, `${suffix}-other`] } },
      select: { id: true },
    });
    const projectIds = projects.map((item) => item.id);
    const sites = await prisma.site.findMany({
      where: { slug: { in: [`${suffix}`, `${suffix}-other`] } },
      select: { id: true },
    });
    const siteIds = sites.map((item) => item.id);

    await prisma.goalDefinitionSite.deleteMany({ where: { siteId: { in: siteIds } } });
    await prisma.metrikaGoalDailyMetric.deleteMany({ where: { siteId: { in: siteIds } } });
    await prisma.trackedQuery.deleteMany({ where: { trackedQuerySet: { siteId: { in: siteIds } } } });
    await prisma.trackedQuerySet.deleteMany({ where: { siteId: { in: siteIds } } });
    await prisma.providerConnection.deleteMany({ where: { siteId: { in: siteIds } } });
    await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
    await prisma.goalDefinition.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.member.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.outboxEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.idempotencyKey.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.jobRun.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.auditEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { email: { in: [`${suffix}@example.invalid`, `${suffix}-other@example.invalid`] } } });
    await prisma.queryClusterProfile.deleteMany({ where: { slug: { in: [`${suffix}`, `${suffix}-other`] } } });
    await prisma.thresholdProfile.deleteMany({ where: { slug: { in: [`${suffix}`, `${suffix}-other`] } } });
  }

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await pool.end();
  });

  it("creates and updates typed admin resources with audit and version bumps", async () => {
    const user = await prisma.user.create({
      data: {
        id: `${suffix}-user`,
        name: "Platform member",
        email: `${suffix}@example.invalid`,
        systemRole: "CLIENT_VIEWER",
      },
    });

    const thresholdCreate = await saveThresholdProfile(admin, {
      slug: suffix,
      minimumShows: 10,
      maximumCtrPercent: 2,
      maximumAveragePosition: 20,
      showsDropPercent: 10,
      clicksDropPercent: 10,
      positionWorsenedDelta: 3,
      pagesInSearchDropPercent: 10,
      organicVisitsDropPercent: 10,
      goalConversionDropPercent: 10,
    });
    thresholdProfileId = thresholdCreate.id;

    const thresholdUpdate = await saveThresholdProfile(admin, {
      id: thresholdCreate.id,
      version: thresholdCreate.version,
      minimumShows: 11,
      maximumCtrPercent: 2,
      maximumAveragePosition: 20,
      showsDropPercent: 10,
      clicksDropPercent: 10,
      positionWorsenedDelta: 3,
      pagesInSearchDropPercent: 10,
      organicVisitsDropPercent: 10,
      goalConversionDropPercent: 10,
    });

    const clusterCreate = await saveQueryClusterProfile(admin, {
      slug: suffix,
      name: "Platform clusters",
      groups: [{ slug: "brand", label: "Бренд", order: 1, brandTerms: ["ams"], terms: [] }],
    });
    clusterProfileId = clusterCreate.id;

    const clusterUpdate = await saveQueryClusterProfile(admin, {
      id: clusterCreate.id,
      version: clusterCreate.version,
      name: "Platform clusters updated",
      groups: [{ slug: "brand", label: "Бренд", order: 1, brandTerms: ["ams"], terms: ["seo"] }],
    });

    const organizationCreate = await createOrganization(admin, { slug: suffix, name: "Platform organization" });
    organizationId = organizationCreate.organizationId;
    const organizationUpdate = await updateOrganization(admin, {
      organizationId,
      version: organizationCreate.version,
      slug: suffix,
      name: "Platform organization updated",
    });

    const membershipCreate = await createMembership(admin, {
      organizationId,
      userId: user.id,
      tenantRole: "ORG_MEMBER",
    });
    membershipId = membershipCreate.membershipId;
    const membershipUpdate = await updateMembership(admin, {
      organizationId,
      membershipId,
      version: membershipCreate.version,
      tenantRole: "ORG_OWNER",
    });

    const projectCreate = await createProject(admin, {
      organizationId,
      slug: suffix,
      name: "Platform project",
      status: "PLANNED",
      thresholdProfileId,
      clusterProfileId,
    });
    projectId = projectCreate.projectId;
    await changeProjectStatus(admin, {
      organizationId,
      projectId,
      version: projectCreate.version,
      status: "ACTIVE",
    });
    await updateProjectSettings(admin, {
      organizationId,
      projectId,
      version: 2,
      name: "Platform project updated",
      thresholdProfileId,
      clusterProfileId,
    });

    const siteCreate = await saveSite(admin, {
      projectId,
      slug: suffix,
      name: "Platform site",
      url: "https://platform.example.invalid",
      timezone: "Europe/Moscow",
      enabled: true,
    });
    siteId = siteCreate.id;
    const siteUpdate = await saveSite(admin, {
      id: siteId,
      version: siteCreate.version,
      slug: suffix,
      name: "Platform site updated",
      url: "https://platform.example.invalid",
      timezone: "Europe/Moscow",
      enabled: false,
    });

    const providerCreate = await saveProviderConnection(admin, {
      siteId,
      provider: "YANDEX_WEBMASTER",
      externalId: "host-1",
      enabled: true,
      settingsJson: { hostUrl: "https://platform.example.invalid" },
    });
    providerId = providerCreate.id;
    const providerUpdate = await saveProviderConnection(admin, {
      id: providerId,
      version: providerCreate.version,
      externalId: "host-2",
      enabled: false,
      settingsJson: { hostUrl: "https://platform.example.invalid", region: "ru" },
    });

    const goalCreate = await saveGoalDefinition(admin, {
      projectId,
      externalGoalId: "goal-1",
      label: "Platform goal",
      category: "LEAD_SUBMIT",
      direction: "PRIMARY",
      includeInSeoConversion: true,
      siteIds: [siteId],
    });
    goalId = goalCreate.id;
    const goalUpdate = await saveGoalDefinition(admin, {
      id: goalId,
      version: goalCreate.version,
      label: "Platform goal updated",
      category: "PHONE_CLICK",
      direction: "SECONDARY",
      includeInSeoConversion: false,
      siteIds: [siteId],
    });

    const trackedCreate = await saveTrackedQuerySet(admin, {
      siteId,
      source: "OWNER_PROVIDED",
      baselineLabel: "Initial baseline",
      queries: ["seo аудит", "seo продвижение"],
    });
    trackedQuerySetId = trackedCreate.id;
    const trackedUpdate = await saveTrackedQuerySet(admin, {
      id: trackedQuerySetId,
      version: trackedCreate.version,
      source: "OWNER_PROVIDED",
      baselineLabel: "Updated baseline",
      queries: ["seo аудит"],
    });

    expect({ thresholdUpdate, clusterUpdate, organizationUpdate, membershipUpdate, siteUpdate, providerUpdate, goalUpdate, trackedUpdate }).toMatchObject({
      thresholdUpdate: { version: 2 },
      clusterUpdate: { version: 2 },
      organizationUpdate: { version: 2 },
      membershipUpdate: { version: 2 },
      siteUpdate: { version: 2 },
      providerUpdate: { version: 2 },
      goalUpdate: { version: 2 },
      trackedUpdate: { version: 2 },
    });

    const retainedQueries = await prisma.trackedQuery.findMany({
      where: { trackedQuerySetId },
      orderBy: { normalizedQuery: "asc" },
      select: { normalizedQuery: true, enabled: true },
    });
    expect(retainedQueries).toEqual([
      { normalizedQuery: "seo аудит", enabled: true },
      { normalizedQuery: "seo продвижение", enabled: false },
    ]);

    const audit = await prisma.auditEvent.findMany({
      where: { actorId: admin.userId },
      orderBy: { createdAt: "asc" },
      select: { action: true, source: true },
    });
    expect(audit.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "threshold-profile.create",
        "threshold-profile.update",
        "query-cluster-profile.create",
        "query-cluster-profile.update",
        "organization.create",
        "organization.update",
        "membership.create",
        "membership.update",
        "project.create",
        "project.change-status",
        "project.update-settings",
        "site.create",
        "site.update",
        "provider-connection.create",
        "provider-connection.update",
        "goal-definition.create",
        "goal-definition.update",
        "tracked-query-set.create",
        "tracked-query-set.update",
      ]),
    );
    expect(audit.filter((event) => event.action.startsWith("project.")).every((event) => event.source === "project-registry")).toBe(true);
    expect(audit.filter((event) => event.action.startsWith("organization.") || event.action.startsWith("membership.")).every((event) => event.source === "identity-access")).toBe(true);
    expect(audit.filter((event) => event.action.startsWith("site.") || event.action.startsWith("provider-connection.") || event.action.startsWith("goal-definition.") || event.action.startsWith("tracked-query-set.") || event.action.startsWith("threshold-profile.") || event.action.startsWith("query-cluster-profile.")).every((event) => event.source === "platform-admin")).toBe(true);
  });

  it("rejects sensitive provider settings keys before persistence", async () => {
    await expect(
      saveProviderConnection(admin, {
        siteId,
        provider: "TOPVISOR",
        externalId: "sensitive-host",
        enabled: true,
        settingsJson: { apiKey: "must-not-store" },
      }),
    ).rejects.toThrow(/nonsecret JSON/i);
    expect(
      await prisma.providerConnection.findFirst({
        where: { siteId, provider: "TOPVISOR" },
      }),
    ).toBeNull();
  });

  it("creates idempotent project sync requests from Platform Admin", async () => {
    const first = await requestProjectSync(admin, {
      projectSlug: suffix,
      idempotencyKey: `${suffix}-sync`,
    });
    const duplicate = await requestProjectSync(admin, {
      projectSlug: suffix,
      idempotencyKey: `${suffix}-sync`,
    });
    expect(first.duplicate).toBe(false);
    expect(duplicate).toEqual({ duplicate: true, outboxEventId: first.outboxEventId });

    const outbox = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: first.outboxEventId } });
    expect(outbox.topic).toBe("project.sync.requested");
    expect(outbox.organizationId).toBe(organizationId);
  });

  it("rejects stale updates, immutable ownership changes and non-admin principals", async () => {
    const otherThreshold = await saveThresholdProfile(admin, {
      slug: `${suffix}-other`,
      minimumShows: 5,
      maximumCtrPercent: 1,
      maximumAveragePosition: 10,
      showsDropPercent: 5,
      clicksDropPercent: 5,
      positionWorsenedDelta: 2,
      pagesInSearchDropPercent: 5,
      organicVisitsDropPercent: 5,
      goalConversionDropPercent: 5,
    });
    const otherCluster = await saveQueryClusterProfile(admin, {
      slug: `${suffix}-other`,
      name: "Other clusters",
      groups: [{ slug: "other", label: "Other", order: 1, brandTerms: [], terms: ["other"] }],
    });
    const otherOrganization = await createOrganization(admin, {
      slug: `${suffix}-other`,
      name: "Other organization",
    });
    const otherProject = await createProject(admin, {
      organizationId: otherOrganization.organizationId,
      slug: `${suffix}-other`,
      name: "Other project",
      status: "PLANNED",
      thresholdProfileId: otherThreshold.id,
      clusterProfileId: otherCluster.id,
    });

    await expect(
      updateOrganization(admin, {
        organizationId,
        version: 1,
        slug: suffix,
        name: "Stale org",
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_STALE" });
    await expect(
      removeMembership(admin, {
        organizationId,
        membershipId,
        version: 1,
      }),
    ).rejects.toMatchObject({ code: "MEMBERSHIP_STALE" });
    const otherSite = await saveSite(admin, {
      projectId: otherProject.projectId,
      slug: `${suffix}-other`,
      name: "Other site",
      url: "https://other.example.invalid",
      timezone: "Europe/Moscow",
      enabled: true,
    });
    await expect(
      saveProviderConnection(admin, {
        id: providerId,
        version: 1,
        externalId: "stale-host",
        enabled: true,
        settingsJson: { hostUrl: "https://platform.example.invalid" },
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_CONNECTION_STALE" });
    await expect(
      saveGoalDefinition(admin, {
        id: goalId,
        version: 2,
        label: "Cross-tenant goal",
        category: "LEAD_SUBMIT",
        direction: "PRIMARY",
        includeInSeoConversion: true,
        siteIds: [siteId, otherSite.id],
      }),
    ).rejects.toMatchObject({ code: "GOAL_DEFINITION_REFERENCE_INVALID" });
    await expect(
      changeProjectStatus(
        {
          kind: "platform-analyst",
          userId: `${suffix}-analyst`,
          correlationId: "00000000-0000-4000-8000-000000000061",
        },
        {
          organizationId: otherOrganization.organizationId,
          projectId: otherProject.projectId,
          version: 1,
          status: "ACTIVE",
        },
      ),
    ).rejects.toThrow();
  });
});
