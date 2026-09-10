import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const databaseName = process.env.DATABASE_NAME?.trim() || (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
  } catch {
    return "";
  }
})();

if (!databaseName.endsWith("_test")) {
  throw new Error("Synthetic test bootstrap requires a database name ending in _test");
}

const sourceRoot = await mkdtemp(path.join(tmpdir(), "ams-impulse-test-config-"));

async function writeJson(relativePath, value) {
  const target = path.join(sourceRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

try {
  await writeJson("thresholds.json", {
    schemaVersion: 1,
    queryOpportunity: { minimumShows: 30, maximumCtrPercent: 5, maximumAveragePosition: 10 },
    trendAlerts: {
      showsDropPercent: 30,
      clicksDropPercent: 30,
      positionWorsenedDelta: 2,
      pagesInSearchDropPercent: 10,
      organicVisitsDropPercent: 30,
      goalConversionDropPercent: 20,
    },
  });
  await writeJson("clusters/default.json", {
    schemaVersion: 1,
    profileSlug: "default",
    name: "Synthetic default",
    brandTerms: [],
    groups: [],
  });
  await writeJson("clusters/real-estate.json", {
    schemaVersion: 1,
    profileSlug: "real-estate",
    name: "Synthetic clusters",
    brandTerms: ["alpha"],
    groups: [
      { slug: "brand", label: "Brand", terms: ["alpha"] },
      { slug: "generic", label: "Generic", terms: ["service"] },
    ],
  });
  await writeJson("clients/alpha.json", {
    schemaVersion: 1,
    clientSlug: "alpha",
    name: "Synthetic Alpha Organization",
    enabled: true,
    clusterProfile: "real-estate",
    sites: ["north", "east", "south"].map((siteSlug, index) => ({
      siteSlug,
      name: `Synthetic site ${index + 1}`,
      siteUrl: `https://${siteSlug}.example.test`,
      timezone: "+03:00",
      enabled: true,
      webmaster: {
        enabled: true,
        expectedHostUrl: `https://${siteSlug}.example.test`,
      },
      metrica: {
        enabled: true,
        counterId: String(700001 + index),
        goalProfile: "alpha",
      },
      topvisor: {
        enabled: false,
        projectId: index === 0 ? 900001 : null,
        regionIndex: index === 0 ? 0 : null,
      },
    })),
  });
  await writeJson("clients/beta.json", {
    schemaVersion: 1,
    clientSlug: "beta",
    name: "Synthetic Beta Organization",
    enabled: true,
    clusterProfile: "default",
    sites: [
      {
        siteSlug: "west",
        name: "Synthetic site",
        siteUrl: "https://beta.example.test",
        timezone: "+03:00",
        enabled: true,
        webmaster: { enabled: false, expectedHostUrl: null },
        metrica: { enabled: false, counterId: null, goalProfile: null },
        topvisor: { enabled: false, projectId: null, regionIndex: null },
      },
    ],
  });
  await writeJson("goals/alpha.json", {
    schemaVersion: 1,
    clientSlug: "alpha",
    goals: [
      {
        goalId: "100001",
        label: "Synthetic conversion",
        category: "lead_submit",
        direction: "primary",
        includeInSeoConversion: true,
        siteSlugs: ["north", "east", "south"],
      },
    ],
  });
  await writeJson("goals/beta.json", {
    schemaVersion: 1,
    clientSlug: "beta",
    goals: [],
  });
  await mkdir(path.join(sourceRoot, "tracked-queries"), { recursive: true });
  await writeJson("tracked-queries/alpha-north.json", {
    schemaVersion: 1,
    clientSlug: "alpha",
    siteSlug: "north",
    source: "owner-provided",
    baselineLabel: "synthetic-baseline",
    expectedCount: 75,
    queries: Array.from({ length: 75 }, (_, index) => ({
      query: `synthetic query ${index + 1}`,
      position: { current: null, baseline: null, delta: null },
    })),
  });

  const result = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/config-sync.ts", "--source", sourceRoot, "--apply"],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  await rm(sourceRoot, { recursive: true, force: true });
}
