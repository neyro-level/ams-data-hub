import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceIndex = process.argv.indexOf("--source");
const sourceArg = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined;
const configRoot = sourceArg
  ? path.resolve(process.cwd(), sourceArg)
  : path.join(projectRoot, "config", "examples");
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const timezonePattern = /^[+-](0\d|1[0-4]):[0-5]\d$/;
const placeholderHost = "todo.invalid";

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "Expected https URL");

const clientSchema = z.object({
  schemaVersion: z.literal(1),
  clientSlug: z.string().regex(slugPattern),
  name: z.string().min(1),
  enabled: z.boolean(),
  clusterProfile: z.string().regex(slugPattern),
  sites: z.array(
    z.object({
      siteSlug: z.string().regex(slugPattern),
      name: z.string().min(1),
      siteUrl: httpsUrlSchema,
      timezone: z.string().regex(timezonePattern),
      enabled: z.boolean(),
      webmaster: z.object({
        enabled: z.boolean(),
        expectedHostUrl: httpsUrlSchema.nullable(),
      }),
      metrica: z.object({
        enabled: z.boolean(),
        counterId: z.string().regex(/^\d+$/).nullable(),
        goalProfile: z.string().regex(slugPattern).nullable(),
      }),
      topvisor: z.object({
        enabled: z.boolean(),
        projectId: z.number().int().positive().nullable(),
        regionIndex: z.number().int().nonnegative().nullable(),
      }).default({
        enabled: false,
        projectId: null,
        regionIndex: null,
      }),
    }),
  ),
});

const clusterSchema = z.object({
  schemaVersion: z.literal(1),
  profileSlug: z.string().regex(slugPattern),
  name: z.string().min(1),
  brandTerms: z.array(z.string()),
  groups: z.array(z.object({ slug: z.string().regex(slugPattern), label: z.string().min(1) })),
});

const goalProfileSchema = z.object({
  schemaVersion: z.literal(1),
  clientSlug: z.string().regex(slugPattern),
  goals: z.array(z.object({
    goalId: z.string().regex(/^\d+$/),
    label: z.string().min(1),
    category: z.string().min(1),
    direction: z.string().min(1),
    includeInSeoConversion: z.boolean(),
    siteSlugs: z.array(z.string().regex(slugPattern)).default([]),
  })),
});

const trackedQuerySetSchema = z
  .object({
    schemaVersion: z.literal(1),
    clientSlug: z.string().regex(slugPattern),
    siteSlug: z.string().regex(slugPattern),
    source: z.literal("owner-provided"),
    baselineLabel: z.string().min(1),
    expectedCount: z.number().int().min(1).max(100),
    queries: z.array(
      z.object({
        query: z.string().trim().min(2),
        position: z.object({
          current: z.number().int().min(1).max(250).nullable(),
          baseline: z.number().int().min(1).max(250).nullable(),
          delta: z.number().int().nullable(),
        }),
      }),
    ).min(1).max(100),
  })
  .superRefine((value, ctx) => {
    const normalizedQueries = new Set();

    for (const [index, query] of value.queries.entries()) {
      const normalized = query.query.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim();
      if (normalizedQueries.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate tracked query: ${query.query}`,
          path: ["queries", index, "query"],
        });
      }
      normalizedQueries.add(normalized);
    }

    if (value.queries.length !== value.expectedCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Tracked core must contain exactly ${value.expectedCount} queries`,
        path: ["queries"],
      });
    }
  });

const thresholdsSchema = z.object({
  schemaVersion: z.literal(1),
  queryOpportunity: z.object({
    minimumShows: z.number().nonnegative(),
    maximumCtrPercent: z.number().nonnegative(),
    maximumAveragePosition: z.number().nonnegative(),
  }),
  trendAlerts: z.object({
    showsDropPercent: z.number().nonnegative(),
    clicksDropPercent: z.number().nonnegative(),
    positionWorsenedDelta: z.number().nonnegative(),
    pagesInSearchDropPercent: z.number().nonnegative(),
    organicVisitsDropPercent: z.number().nonnegative(),
    goalConversionDropPercent: z.number().nonnegative(),
  }),
});

function isPlaceholderUrl(value) {
  return new URL(value).hostname === placeholderHost;
}

async function readJsonDirectory(relativeDir) {
  const absoluteDir = path.join(configRoot, relativeDir);
  const entries = (await readdir(absoluteDir)).filter((entry) => entry.endsWith(".json")).sort();
  return Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(absoluteDir, entry);
      const raw = await readFile(absolutePath, "utf8");
      return JSON.parse(raw);
    }),
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const clients = (await readJsonDirectory("clients")).map((item) => clientSchema.parse(item));
  const clusters = (await readJsonDirectory("clusters")).map((item) => clusterSchema.parse(item));
  const goalProfiles = (await readJsonDirectory("goals")).map((item) => goalProfileSchema.parse(item));
  const trackedQuerySets = (await readJsonDirectory("tracked-queries"))
    .map((item) => trackedQuerySetSchema.parse(item));
  const thresholds = thresholdsSchema.parse(
    JSON.parse(await readFile(path.join(configRoot, "thresholds.json"), "utf8")),
  );

  const clusterSlugs = new Set(clusters.map((item) => item.profileSlug));
  const goalClientSlugs = new Set(goalProfiles.map((item) => item.clientSlug));
  const routeSet = new Set(["/", "/demo/", "/analyst/"]);
  const clientSet = new Set();
  const siteUrlSet = new Set();
  const siteKeys = new Set();

  for (const client of clients) {
    assert(!clientSet.has(client.clientSlug), `Duplicate client slug: ${client.clientSlug}`);
    clientSet.add(client.clientSlug);
    assert(clusterSlugs.has(client.clusterProfile), `Unknown cluster profile: ${client.clusterProfile}`);
    assert(goalClientSlugs.has(client.clientSlug), `Missing goal profile: ${client.clientSlug}`);

    const clientRoute = `/c/${client.clientSlug}/`;
    assert(!routeSet.has(clientRoute), `Route collision: ${clientRoute}`);
    routeSet.add(clientRoute);

    const siteSet = new Set();
    for (const site of client.sites) {
      assert(!siteSet.has(site.siteSlug), `Duplicate site slug: ${client.clientSlug}/${site.siteSlug}`);
      siteSet.add(site.siteSlug);
      siteKeys.add(`${client.clientSlug}/${site.siteSlug}`);

      const parsedSiteUrl = new URL(site.siteUrl);
      const normalizedSitePath =
        parsedSiteUrl.pathname === "/" ? "" : parsedSiteUrl.pathname.replace(/\/$/, "");
      const normalizedSiteUrl =
        `${parsedSiteUrl.protocol.toLowerCase()}//${parsedSiteUrl.hostname.toLowerCase()}${normalizedSitePath}`;
      assert(!siteUrlSet.has(normalizedSiteUrl), `Duplicate site URL: ${site.siteUrl}`);
      siteUrlSet.add(normalizedSiteUrl);

      if (site.enabled) {
        assert(!isPlaceholderUrl(site.siteUrl), `Enabled site cannot use placeholder URL: ${client.clientSlug}/${site.siteSlug}`);
      }

      if (!site.enabled) {
        assert(!site.webmaster.enabled, `Disabled site cannot enable webmaster: ${client.clientSlug}/${site.siteSlug}`);
        assert(!site.metrica.enabled, `Disabled site cannot enable metrica: ${client.clientSlug}/${site.siteSlug}`);
        assert(!site.topvisor.enabled, `Disabled site cannot enable Topvisor: ${client.clientSlug}/${site.siteSlug}`);
      }

      if (site.webmaster.enabled) {
        assert(site.webmaster.expectedHostUrl, `Enabled webmaster requires expectedHostUrl: ${client.clientSlug}/${site.siteSlug}`);
      }

      if (site.metrica.enabled) {
        assert(site.metrica.counterId, `Enabled metrica requires counterId: ${client.clientSlug}/${site.siteSlug}`);
        assert(site.metrica.goalProfile, `Enabled metrica requires goalProfile: ${client.clientSlug}/${site.siteSlug}`);
      }

      if (site.topvisor.enabled) {
        assert(site.topvisor.projectId, `Enabled Topvisor requires projectId: ${client.clientSlug}/${site.siteSlug}`);
        assert(site.topvisor.regionIndex !== null, `Enabled Topvisor requires regionIndex: ${client.clientSlug}/${site.siteSlug}`);
      }

      const siteRoute = `/c/${client.clientSlug}/${site.siteSlug}/`;
      assert(!routeSet.has(siteRoute), `Route collision: ${siteRoute}`);
      routeSet.add(siteRoute);
    }
  }

  for (const querySet of trackedQuerySets) {
    assert(
      siteKeys.has(`${querySet.clientSlug}/${querySet.siteSlug}`),
      `Tracked query set references unknown site: ${querySet.clientSlug}/${querySet.siteSlug}`,
    );
  }

  console.log(
    `Config verified: ${clients.length} projects, ${routeSet.size} routes, ${trackedQuerySets.length} tracked query sets, schemaVersion ${thresholds.schemaVersion}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
