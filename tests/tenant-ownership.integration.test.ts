import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaContext,
  type PrismaContext,
} from "../src/platform/database/prisma/context.ts";

const integrationEnabled = Boolean(
  process.env.TEST_DATABASE_HOST &&
    process.env.TEST_DATABASE_USER &&
    process.env.TEST_DATABASE_PASSWORD &&
    process.env.TEST_DATABASE_NAME,
);
const integrationDescription = integrationEnabled ? describe : describe.skip;
const tenantTables = [
  "Site",
  "ProviderConnection",
  "GoalDefinition",
  "GoalDefinitionSite",
  "TrackedQuerySet",
  "TrackedQuery",
  "SyncRun",
  "SourceRun",
  "WebmasterDailyMetric",
  "WebmasterQueryDailyMetric",
  "MetrikaDailyMetric",
  "LandingPageDailyMetric",
  "MetrikaDeviceDailyMetric",
  "MetrikaGoalDailyMetric",
  "RankingCapture",
  "TechnicalSnapshot",
  "ReportSnapshot",
] as const;

integrationDescription("tenant ownership expansion", () => {
  let database: PrismaContext;

  beforeAll(() => {
    database = createPrismaContext({
      DATABASE_HOST: process.env.TEST_DATABASE_HOST,
      DATABASE_PORT: process.env.TEST_DATABASE_PORT,
      DATABASE_USER: process.env.TEST_DATABASE_USER,
      DATABASE_PASSWORD: process.env.TEST_DATABASE_PASSWORD,
      DATABASE_NAME: process.env.TEST_DATABASE_NAME,
      DATABASE_SSLMODE: process.env.TEST_DATABASE_SSLMODE,
    });
  });

  afterAll(async () => {
    await database.close();
  });

  it("writes ownership to seeded registry and worker-generated tenant records", async () => {
    const nullOwnershipCounts = await Promise.all(
      tenantTables.map(async (table) => {
        // Table names come from this closed literal list; no browser/runtime identifier enters SQL.
        const result = await database.pool.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM "${table}" WHERE "organizationId" IS NULL`,
        );
        return Number(result.rows[0]?.count ?? 0);
      }),
    );

    expect(nullOwnershipCounts).toEqual(
      Array.from({ length: tenantTables.length }, () => 0),
    );
  });

});
