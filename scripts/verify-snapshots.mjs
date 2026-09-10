import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = path.join(rootDir, process.argv[2] ?? "tests/fixtures/snapshots");
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const timezonePattern = /^[+-](0\d|1[0-4]):[0-5]\d$/;

const sourceStatusSchema = z.enum([
  "success",
  "partial",
  "failed",
  "not_configured",
  "access_denied",
  "quota_limited",
  "stale",
]);

const trendPointSchema = z.object({
  label: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().nonnegative(),
  secondaryValue: z.number().nullable(),
  tertiaryValue: z.number().nullable(),
});

const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  clientSlug: z.string().regex(slugPattern),
  siteSlug: z.string().regex(slugPattern),
  siteUrl: z.string().url(),
  generatedAt: z.string().datetime({ offset: true }),
  freshness: z.enum(["fresh", "stale", "partial", "unavailable"]),
  sources: z.object({
    webmaster: z.object({
      status: sourceStatusSchema,
      fetchedAt: z.string().datetime({ offset: true }),
      periodStart: z.string().nullable(),
      periodEnd: z.string().nullable(),
      timezone: z.string().regex(timezonePattern),
      note: z.string().nullable(),
      safeErrorCode: z.string().nullable(),
    }),
    metrica: z.object({
      status: sourceStatusSchema,
      fetchedAt: z.string().datetime({ offset: true }),
      periodStart: z.string().nullable(),
      periodEnd: z.string().nullable(),
      timezone: z.string().regex(timezonePattern),
      note: z.string().nullable(),
      safeErrorCode: z.string().nullable(),
    }),
  }),
  webmaster: z.object({
    summary: z.object({
      shows: z.number().nonnegative(),
      clicks: z.number().nonnegative(),
      ctr: z.number().nonnegative(),
      avgPosition: z.number().nullable(),
      pagesInSearch: z.number().nonnegative(),
      excludedPages: z.number().nonnegative(),
      sitemapUrls: z.number().nonnegative(),
      sqi: z.number().nullable(),
    }),
    visibilityTrend: z.array(trendPointSchema),
    queries: z.array(z.object({
      queryId: z.string(),
      query: z.string(),
      cluster: z.string(),
      device: z.string(),
      shows: z.number().nonnegative(),
      clicks: z.number().nonnegative(),
      ctr: z.number().nonnegative(),
      avgShowPosition: z.number().nonnegative(),
      avgClickPosition: z.number().nullable(),
      previousShows: z.number().nullable(),
      previousClicks: z.number().nullable(),
      deltaClicksPercent: z.number().nullable(),
      deltaCtrPoints: z.number().nullable(),
      opportunityType: z.string(),
    })),
    diagnostics: z.array(z.object({ severity: z.string(), title: z.string(), description: z.string() })),
    sitemap: z.object({ url: z.string().url(), urls: z.number().nonnegative(), errors: z.number().nonnegative() }),
    links: z.object({ external: z.number().nonnegative(), brokenInternal: z.number().nonnegative() }),
  }).nullable(),
  metrica: z.object({
    summary: z.object({
      visits: z.number().nonnegative(),
      users: z.number().nonnegative(),
      pageviews: z.number().nonnegative(),
      bounceRate: z.number().nonnegative(),
      depth: z.number().nonnegative(),
      averageVisitDurationSeconds: z.number().nonnegative(),
      goalReaches: z.number().nonnegative(),
      conversionRate: z.number().nullable(),
    }),
    organicTrend: z.array(trendPointSchema),
    landingPages: z.array(z.object({
      path: z.string(),
      visits: z.number().nonnegative(),
      users: z.number().nonnegative(),
      pageviews: z.number().nonnegative(),
      bounceRate: z.number().nonnegative(),
      depth: z.number().nonnegative(),
      durationSeconds: z.number().nonnegative(),
      goals: z.number().nonnegative(),
      conversionRate: z.number().nullable(),
      trendLabel: z.string(),
    })),
    devices: z.array(z.object({ device: z.string(), visits: z.number().nonnegative(), conversionRate: z.number().nullable() })),
    goals: z.array(z.object({ label: z.string(), category: z.string(), reaches: z.number().nonnegative(), conversionRate: z.number().nullable() })),
  }).nullable(),
  combined: z.object({
    funnel: z.object({
      shows: z.number().nonnegative(),
      clicks: z.number().nonnegative(),
      visits: z.number().nonnegative(),
      goalReaches: z.number().nonnegative(),
      caveats: z.array(z.string()).min(1),
    }),
    opportunities: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string(), source: z.string(), tone: z.string() })),
    alerts: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string(), tone: z.string() })),
    methodology: z.array(z.string()).min(1),
  }),
});

async function collectJsonFiles(currentDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectJsonFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      results.push(fullPath);
    }
  }
  return results;
}

try {
  const files = await collectJsonFiles(snapshotRoot).catch(() => []);
  let verifiedCount = 0;
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    snapshotSchema.parse(JSON.parse(raw));
    verifiedCount += 1;
  }
  console.log(`Snapshots verified: ${verifiedCount} file(s) in ${path.relative(rootDir, snapshotRoot) || "."}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
