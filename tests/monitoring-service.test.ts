import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { Pool } from "pg";
import { MonitoringService } from "../src/modules/project-registry/index.ts";
import { PrismaMonitoringRepository } from "../src/modules/project-registry/server.ts";
import { createPgPoolConfigFromEnvironment } from "../src/platform/database/prisma/pool-config.ts";

const monitoringTestEnabled = Boolean(
  process.env.TEST_DATABASE_HOST &&
    process.env.TEST_DATABASE_USER &&
    process.env.TEST_DATABASE_PASSWORD &&
    process.env.TEST_DATABASE_NAME,
);
const monitoringTestDescription = monitoringTestEnabled ? describe : describe.skip;

let prisma: PrismaClient | null = null;
let pool: Pool | null = null;

monitoringTestDescription("MonitoringService", () => {
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
    await prisma.providerConnection.updateMany({
      where: {
        provider: "TOPVISOR",
      },
      data: {
        enabled: false,
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

  it("reconstructs synthetic monitoring context from PostgreSQL", async () => {
    const monitoringService = new MonitoringService(new PrismaMonitoringRepository());
    const context = await monitoringService.getProjectContext("alpha");

    expect(context).not.toBeNull();
    expect(context?.client.clientSlug).toBe("alpha");
    expect(context?.client.sites).toHaveLength(3);
    expect(context?.goalProfile.goals.length).toBeGreaterThan(0);
    expect(context?.trackedQuerySets[0]?.expectedCount).toBe(75);
    expect(context?.clusterProfile.groups[0]?.slug).toBe("brand");
    expect(context?.thresholds.queryOpportunity.minimumShows).toBe(30);
  });

  it("lists only active projects in stable order", async () => {
    const monitoringService = new MonitoringService(new PrismaMonitoringRepository());

    await expect(monitoringService.listActiveProjectSlugs()).resolves.toEqual(["alpha", "beta"]);
  });
});
