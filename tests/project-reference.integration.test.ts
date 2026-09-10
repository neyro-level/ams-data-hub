import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import {
  changeProjectStatus,
  createProject,
  listProjects,
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
const suffix = "project-reference-integration";
const admin: PrincipalContext = {
  kind: "platform-admin",
  userId: `${suffix}-admin`,
  correlationId: "00000000-0000-4000-8000-000000000410",
};
const analyst: PrincipalContext = {
  kind: "platform-analyst",
  userId: `${suffix}-analyst`,
  correlationId: "00000000-0000-4000-8000-000000000411",
};

integrationDescription("Project reference slice", () => {
  let prisma: PrismaClient;
  let pool: Pool;
  let organizationAId = "";
  let organizationBId = "";
  let thresholdProfileId = "";
  let clusterProfileId = "";
  let projectAId = "";
  let projectBId = "";

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

    const [organizationA, organizationB, thresholdProfile, clusterProfile] = await Promise.all([
      prisma.organization.create({ data: { slug: `${suffix}-a`, name: "Reference organization A" } }),
      prisma.organization.create({ data: { slug: `${suffix}-b`, name: "Reference organization B" } }),
      prisma.thresholdProfile.create({
        data: {
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
        },
      }),
      prisma.queryClusterProfile.create({ data: { slug: suffix, name: "Reference clusters" } }),
    ]);
    organizationAId = organizationA.id;
    organizationBId = organizationB.id;
    thresholdProfileId = thresholdProfile.id;
    clusterProfileId = clusterProfile.id;
  });

  async function cleanup() {
    const organizations = await prisma.organization.findMany({
      where: { slug: { in: [`${suffix}-a`, `${suffix}-b`] } },
      select: { id: true },
    });
    const organizationIds = organizations.map((organization) => organization.id);
    await prisma.auditEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.project.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.queryClusterProfile.deleteMany({ where: { slug: suffix } });
    await prisma.thresholdProfile.deleteMany({ where: { slug: suffix } });
  }

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await pool.end();
  });

  it("creates tenant-owned projects and commits their audit events", async () => {
    const projectA = await createProject(admin, {
      organizationId: organizationAId,
      slug: `${suffix}-project-a`,
      name: "Reference project A",
      status: "PLANNED",
      thresholdProfileId,
      clusterProfileId,
    });
    const projectB = await createProject(admin, {
      organizationId: organizationBId,
      slug: `${suffix}-project-b`,
      name: "Reference project B",
      status: "PLANNED",
      thresholdProfileId,
      clusterProfileId,
    });
    projectAId = projectA.projectId;
    projectBId = projectB.projectId;

    expect(projectA.version).toBe(1);
    expect(await prisma.auditEvent.count({
      where: { entityType: "Project", entityId: { in: [projectAId, projectBId] }, action: "project.create" },
    })).toBe(2);
  });

  it("scopes reads to the active tenant while analysts read all projects", async () => {
    const ownerA: PrincipalContext = {
      kind: "tenant-user",
      userId: `${suffix}-owner-a`,
      membershipId: `${suffix}-membership-a`,
      organizationId: organizationAId,
      role: "ORG_OWNER",
      correlationId: "00000000-0000-4000-8000-000000000412",
    };
    const tenantResult = await listProjects(ownerA, {
      page: 1,
      pageSize: 20,
      search: suffix,
      status: null,
      sort: "name",
      direction: "asc",
    });
    const analystResult = await listProjects(analyst, {
      page: 1,
      pageSize: 20,
      search: suffix,
      status: null,
      sort: "name",
      direction: "asc",
    });

    expect(tenantResult.items.map((project) => project.id)).toEqual([projectAId]);
    expect(analystResult.items.map((project) => project.id)).toEqual([projectAId, projectBId]);
  });

  it("allows own-tenant changes and rejects foreign and stale mutations", async () => {
    const ownerA: PrincipalContext = {
      kind: "tenant-user",
      userId: `${suffix}-owner-a`,
      membershipId: `${suffix}-membership-a`,
      organizationId: organizationAId,
      role: "ORG_OWNER",
      correlationId: "00000000-0000-4000-8000-000000000413",
    };
    const ownerB: PrincipalContext = {
      ...ownerA,
      userId: `${suffix}-owner-b`,
      membershipId: `${suffix}-membership-b`,
      organizationId: organizationBId,
    };

    const statusResult = await changeProjectStatus(ownerA, {
      organizationId: organizationAId,
      projectId: projectAId,
      version: 1,
      status: "ACTIVE",
    });
    expect(statusResult.version).toBe(2);
    await expect(changeProjectStatus(ownerB, {
      organizationId: organizationAId,
      projectId: projectAId,
      version: 2,
      status: "DISABLED",
    })).rejects.toMatchObject({ code: "PROJECT_ACCESS_DENIED" });
    await expect(changeProjectStatus(ownerA, {
      organizationId: organizationAId,
      projectId: projectAId,
      version: 1,
      status: "DISABLED",
    })).rejects.toMatchObject({ code: "PROJECT_STALE" });

    const settingsResult = await updateProjectSettings(ownerA, {
      organizationId: organizationAId,
      projectId: projectAId,
      version: 2,
      name: "Reference project A updated",
      thresholdProfileId,
      clusterProfileId,
    });
    expect(settingsResult.version).toBe(3);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: projectAId } })).toMatchObject({
      name: "Reference project A updated",
      status: "ACTIVE",
      version: 3,
    });
    expect(await prisma.auditEvent.count({ where: { entityId: projectAId } })).toBe(3);
  });

  it("denies project mutations to a read-only analyst", async () => {
    await expect(changeProjectStatus(analyst, {
      organizationId: organizationBId,
      projectId: projectBId,
      version: 1,
      status: "ACTIVE",
    })).rejects.toMatchObject({ code: "PROJECT_ACCESS_DENIED" });
  });
});
