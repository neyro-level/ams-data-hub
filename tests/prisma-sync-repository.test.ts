import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts"
import { Pool } from "pg";
import { PrismaSyncRepository } from "../src/modules/data-ingestion/server.ts";
import { createPgPoolConfigFromEnvironment } from "../src/platform/database/prisma/pool-config.ts";
import { siteReportSnapshotSchema } from "../src/shared/schemas/report.ts";

const syncRepositoryTestEnabled = Boolean(
  process.env.TEST_DATABASE_HOST &&
    process.env.TEST_DATABASE_USER &&
    process.env.TEST_DATABASE_PASSWORD &&
    process.env.TEST_DATABASE_NAME,
);
const syncRepositoryTestDescription = syncRepositoryTestEnabled ? describe : describe.skip;

let prisma: PrismaClient | null = null;
let pool: Pool | null = null;

syncRepositoryTestDescription("PrismaSyncRepository", () => {
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
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
    if (pool) {
      await pool.end();
    }
  });

  it("prevents overlapping full syncs for the same scope", async () => {
    const firstRepository = new PrismaSyncRepository();
    const secondRepository = new PrismaSyncRepository();
    const firstLock = await firstRepository.tryAcquireFullSyncLock("alpha-test");
    expect(firstLock).not.toBeNull();

    const overlappingLock = await secondRepository.tryAcquireFullSyncLock("alpha-test");
    expect(overlappingLock).toBeNull();

    await firstLock!.release();
    const lockAfterRelease = await secondRepository.tryAcquireFullSyncLock("alpha-test");
    expect(lockAfterRelease).not.toBeNull();
    await lockAfterRelease!.release();
  });

  it("persists sync runs, source runs and report snapshots", async () => {
    const repository = new PrismaSyncRepository();
    const site = await prisma!.site.findFirstOrThrow({
      where: {
        slug: "north",
        project: { slug: "alpha" },
      },
      select: { id: true, organizationId: true, projectId: true },
    });
    if (!site.organizationId) throw new Error("Seeded site ownership is missing");

    await prisma!.reportSnapshot.deleteMany({
      where: {
        siteId: site.id,
        periodKey: "WEEK",
        generatedAt: new Date("2026-08-30T00:00:00+03:00"),
      },
    });

    const syncRun = await repository.createSyncRun({
      organizationId: site.organizationId,
      projectId: site.projectId,
      projectSlug: "alpha",
      trigger: "manual",
      startedAt: "2026-08-30T00:00:00+03:00",
      correlationId: "00000000-0000-4000-8000-000000000020",
    });
    const sourceRun = await repository.createSourceRun({
      syncRunId: syncRun.syncRunId,
      projectId: site.projectId,
      siteId: site.id,
      provider: "YANDEX_WEBMASTER",
      startedAt: "2026-08-30T00:00:00+03:00",
      correlationId: "00000000-0000-4000-8000-000000000020",
    });

    const snapshot = siteReportSnapshotSchema.parse({
      schemaVersion: 1,
      clientSlug: "alpha",
      siteSlug: "north",
      siteUrl: "https://alpha.example.test",
      generatedAt: "2026-08-30T00:00:00+03:00",
      freshness: "partial",
      periodKey: "week",
      sources: {
        webmaster: {
          status: "success",
          fetchedAt: "2026-08-30T00:00:00+03:00",
          periodStart: "2026-08-24",
          periodEnd: "2026-08-30",
          timezone: "+03:00",
          note: null,
          safeErrorCode: null,
        },
        metrica: {
          status: "failed",
          fetchedAt: "2026-08-30T00:00:00+03:00",
          periodStart: "2026-08-24",
          periodEnd: "2026-08-30",
          timezone: "+03:00",
          note: null,
          safeErrorCode: "UNAUTHORIZED",
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
          caveats: ["sync-test"],
        },
        opportunities: [],
        alerts: [],
        methodology: ["sync-test"],
      },
    });

    await repository.storeReportSnapshot({
      siteId: site.id,
      periodKey: "week",
      snapshot,
    });
    await repository.finishSourceRun({
      sourceRunId: sourceRun.sourceRunId,
      status: "partial",
      finishedAt: "2026-08-30T00:05:00+03:00",
      durationMs: 300000,
      rowsReceived: 10,
      safeErrorCode: "UNAUTHORIZED",
      notes: "metrica failure",
    });
    await repository.finishSyncRun({
      syncRunId: syncRun.syncRunId,
      status: "partial",
      finishedAt: "2026-08-30T00:05:00+03:00",
      sitesProcessed: 1,
      sitesSucceeded: 0,
      sitesPartial: 1,
      sitesFailed: 0,
      safeError: "UNAUTHORIZED",
    });

    const storedSyncRun = await prisma!.syncRun.findUniqueOrThrow({
      where: { id: syncRun.syncRunId },
      select: {
        status: true,
        sitesProcessed: true,
        sitesPartial: true,
        projectId: true,
        projectSlug: true,
        correlationId: true,
        organizationId: true,
      },
    });
    const storedSourceRun = await prisma!.sourceRun.findUniqueOrThrow({
      where: { id: sourceRun.sourceRunId },
      select: {
        status: true,
        safeErrorCode: true,
        projectId: true,
        correlationId: true,
        organizationId: true,
      },
    });
    const storedReport = await prisma!.reportSnapshot.findFirstOrThrow({
      where: {
        siteId: site.id,
        periodKey: "WEEK",
        generatedAt: new Date("2026-08-30T00:00:00+03:00"),
      },
      select: { freshness: true, schemaVersion: true, organizationId: true },
    });

    expect(storedSyncRun.status).toBe("PARTIAL");
    expect(storedSyncRun.sitesProcessed).toBe(1);
    expect(storedSyncRun.sitesPartial).toBe(1);
    expect(storedSyncRun.projectId).toBe(site.projectId);
    expect(storedSyncRun.projectSlug).toBe("alpha");
    expect(storedSyncRun.correlationId).toBe("00000000-0000-4000-8000-000000000020");
    expect(storedSyncRun.organizationId).toBe(site.organizationId);
    expect(storedSourceRun.status).toBe("PARTIAL");
    expect(storedSourceRun.safeErrorCode).toBe("UNAUTHORIZED");
    expect(storedSourceRun.projectId).toBe(site.projectId);
    expect(storedSourceRun.correlationId).toBe("00000000-0000-4000-8000-000000000020");
    expect(storedSourceRun.organizationId).toBe(site.organizationId);
    expect(storedReport.freshness).toBe("PARTIAL");
    expect(storedReport.schemaVersion).toBe(1);
    expect(storedReport.organizationId).toBe(site.organizationId);
  });
});
