import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, ReportFreshness, ReportPeriodKey } from "../src/generated/prisma/client.ts"
import { Pool } from "pg";
import { PrismaProjectRepository } from "../src/modules/project-registry/server.ts";
import { PrismaReportRepository } from "../src/modules/reporting/server.ts";
import { createPgPoolConfigFromEnvironment } from "../src/platform/database/prisma/pool-config.ts";
import { siteReportSnapshotSchema } from "../src/shared/schemas/report.ts";

const repositoryTestEnabled = Boolean(
  process.env.TEST_DATABASE_HOST &&
    process.env.TEST_DATABASE_USER &&
    process.env.TEST_DATABASE_PASSWORD &&
    process.env.TEST_DATABASE_NAME,
);
const repositoryTestDescription = repositoryTestEnabled ? describe : describe.skip;

let prisma: PrismaClient | null = null;
let pool: Pool | null = null;

repositoryTestDescription("Prisma repositories", () => {
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

    const site = await prisma.site.findFirstOrThrow({
      where: {
        slug: "north",
        project: { slug: "alpha" },
      },
      select: { id: true, organizationId: true },
    });

    await prisma.reportSnapshot.deleteMany({
      where: {
        siteId: site.id,
        periodKey: ReportPeriodKey.MONTH,
      },
    });

    const payload = siteReportSnapshotSchema.parse({
      schemaVersion: 1,
      clientSlug: "alpha",
      siteSlug: "north",
      siteUrl: "https://alpha.example.test",
      generatedAt: "2026-08-30T00:00:00+03:00",
      freshness: "fresh",
      periodKey: "month",
      sources: {
        webmaster: {
          status: "success",
          fetchedAt: "2026-08-30T00:00:00+03:00",
          periodStart: "2026-08-03",
          periodEnd: "2026-08-30",
          timezone: "+03:00",
          note: null,
          safeErrorCode: null,
        },
        metrica: {
          status: "success",
          fetchedAt: "2026-08-30T00:00:00+03:00",
          periodStart: "2026-08-03",
          periodEnd: "2026-08-30",
          timezone: "+03:00",
          note: null,
          safeErrorCode: null,
        },
      },
      webmaster: null,
      metrica: null,
      ranking: null,
      comparison: null,
      combined: {
        funnel: {
          shows: 0,
          clicks: 0,
          visits: 0,
          goalReaches: 0,
          caveats: ["test"],
        },
        opportunities: [],
        alerts: [],
        methodology: ["test"],
      },
    });

    await prisma.reportSnapshot.create({
      data: {
        siteId: site.id,
        organizationId: site.organizationId,
        periodKey: ReportPeriodKey.MONTH,
        schemaVersion: 1,
        generatedAt: new Date("2026-08-30T00:00:00+03:00"),
        freshness: ReportFreshness.FRESH,
        payload,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
    if (pool) {
      await pool.end();
    }
  });

  it("loads project summaries from PostgreSQL", async () => {
    const repository = new PrismaProjectRepository();
    const projects = await repository.listProjects({ organizationIds: null });
    const alpha = projects.find((project) => project.projectSlug === "alpha");

    expect(projects.length).toBeGreaterThanOrEqual(2);
    expect(alpha?.sites).toHaveLength(3);
    expect(alpha?.sites[0]?.enabledSourceCount).toBeGreaterThanOrEqual(0);
  });

  it("applies organization scope inside Prisma queries", async () => {
    const repository = new PrismaProjectRepository();
    const alpha = await prisma!.organization.findUniqueOrThrow({
      where: { slug: "alpha" },
      select: { id: true },
    });
    const scopedProjects = await repository.listProjects({
      organizationIds: [alpha.id],
    });
    const foreignProject = await repository.findProjectBySlug("beta", {
      organizationIds: [alpha.id],
    });
    const foreignSite = await repository.findSiteBySlugs("beta", "west", {
      organizationIds: [alpha.id],
    });

    expect(scopedProjects.map((project) => project.projectSlug)).toEqual(["alpha"]);
    expect(foreignProject).toBeNull();
    expect(foreignSite).toBeNull();
  });

  it("loads latest report snapshot from PostgreSQL", async () => {
    const projectRepository = new PrismaProjectRepository();
    const reportRepository = new PrismaReportRepository();
    const site = await projectRepository.findSiteBySlugs("alpha", "north", {
      organizationIds: null,
    });

    expect(site).not.toBeNull();

    const report = await reportRepository.findLatestReportSnapshot(site!.siteId, "month");
    expect(report?.payload.clientSlug).toBe("alpha");
    expect(report?.periodKey).toBe("month");
  });
});
