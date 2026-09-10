import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

integrationDescription("seed and configuration boundaries", () => {
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

  async function snapshot() {
    const [threshold, cluster, projectCount, siteCount, goalCount, queryCount] = await Promise.all([
      database.prisma.thresholdProfile.findUniqueOrThrow({ where: { slug: "default" } }),
      database.prisma.queryClusterProfile.findUniqueOrThrow({ where: { slug: "default" } }),
      database.prisma.project.count(),
      database.prisma.site.count(),
      database.prisma.goalDefinition.count(),
      database.prisma.trackedQuery.count(),
    ]);
    return {
      thresholdUpdatedAt: threshold.updatedAt.toISOString(),
      clusterUpdatedAt: cluster.updatedAt.toISOString(),
      projectCount,
      siteCount,
      goalCount,
      queryCount,
    };
  }

  it("keeps bootstrap idempotent", async () => {
    const before = await snapshot();
    const result = spawnSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "scripts/seed-bootstrap.ts"],
      { cwd: process.cwd(), env: process.env, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ mode: "bootstrap", created: [], unchanged: 2 });
    await expect(snapshot()).resolves.toEqual(before);
  });

  it("reports a complete dry-run summary without writing", async () => {
    const sourceRoot = await mkdtemp(path.join(tmpdir(), "ams-config-dry-run-"));
    try {
      await Promise.all(
        ["clusters", "clients", "goals", "tracked-queries"].map((directory) =>
          mkdir(path.join(sourceRoot, directory), { recursive: true }),
        ),
      );
      await writeFile(
        path.join(sourceRoot, "thresholds.json"),
        JSON.stringify({
          schemaVersion: 1,
          queryOpportunity: { minimumShows: 31, maximumCtrPercent: 5, maximumAveragePosition: 10 },
          trendAlerts: {
            showsDropPercent: 30,
            clicksDropPercent: 30,
            positionWorsenedDelta: 2,
            pagesInSearchDropPercent: 10,
            organicVisitsDropPercent: 30,
            goalConversionDropPercent: 20,
          },
        }),
      );
      await writeFile(
        path.join(sourceRoot, "clusters", "new-profile.json"),
        JSON.stringify({
          schemaVersion: 1,
          profileSlug: "new-profile",
          name: "Synthetic new profile",
          brandTerms: [],
          groups: [],
        }),
      );

      const before = await snapshot();
      const result = spawnSync(
        process.execPath,
        ["node_modules/tsx/dist/cli.mjs", "scripts/config-sync.ts", "--source", sourceRoot],
        { cwd: process.cwd(), env: process.env, encoding: "utf8" },
      );

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.mode).toBe("dry-run");
      expect(Object.keys(output.changes)).toEqual([
        "CREATE",
        "UPDATE",
        "DELETE_OR_DISABLE",
        "UNCHANGED",
      ]);
      expect(output.changes.CREATE).toContain("query-cluster-profile:new-profile");
      expect(output.changes.UPDATE).toContain("threshold-profile:default");
      await expect(snapshot()).resolves.toEqual(before);
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
    }
  });
});
