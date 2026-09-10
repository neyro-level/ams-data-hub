import { z } from "zod";
import { slugPattern, timezonePattern } from "./registry.ts";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const sourceStatusSchema = z.enum([
  "success",
  "partial",
  "failed",
  "not_configured",
  "access_denied",
  "quota_limited",
  "stale",
]);

export const sourceStateSchema = z.object({
  status: sourceStatusSchema,
  fetchedAt: isoDateTimeSchema,
  periodStart: isoDateSchema.nullable(),
  periodEnd: isoDateSchema.nullable(),
  timezone: z.string().regex(timezonePattern),
  note: z.string().nullable(),
  safeErrorCode: z.string().nullable(),
});

export const reportPeriodKeySchema = z.enum(["week", "month", "quarter", "halfYear"]);

export const comparisonMetricSchema = z.object({
  current: z.number().nullable(),
  previous: z.number().nullable(),
  deltaPercent: z.number().nullable(),
  deltaPoints: z.number().nullable(),
});

export const reportComparisonSchema = z.object({
  periodKey: reportPeriodKeySchema,
  currentPeriod: z.object({
    dateFrom: isoDateSchema,
    dateTo: isoDateSchema,
  }),
  previousPeriod: z.object({
    dateFrom: isoDateSchema,
    dateTo: isoDateSchema,
  }),
  metrics: z.object({
    shows: comparisonMetricSchema,
    clicks: comparisonMetricSchema,
    ctr: comparisonMetricSchema,
    avgPosition: comparisonMetricSchema,
    organicVisits: comparisonMetricSchema,
    targetVisits: comparisonMetricSchema,
    conversionRate: comparisonMetricSchema,
    pagesInSearch: comparisonMetricSchema,
    organicShare: comparisonMetricSchema,
  }),
});

const severitySchema = z.enum(["success", "info", "warning", "error"]);

export const trendPointSchema = z.object({
  label: z.string().min(1),
  date: isoDateSchema,
  value: z.number().nonnegative(),
  secondaryValue: z.number().nonnegative().nullable(),
  tertiaryValue: z.number().nullable(),
});

export const webmasterQuerySchema = z.object({
  queryId: z.string().min(1),
  query: z.string().min(1),
  cluster: z.string().min(1),
  device: z.enum(["ALL", "DESKTOP", "MOBILE"]),
  shows: z.number().nonnegative(),
  clicks: z.number().nonnegative(),
  ctr: z.number().nonnegative(),
  avgShowPosition: z.number().nonnegative(),
  avgClickPosition: z.number().nonnegative().nullable(),
  previousShows: z.number().nonnegative().nullable(),
  previousClicks: z.number().nonnegative().nullable(),
  deltaClicksPercent: z.number().nullable(),
  deltaCtrPoints: z.number().nullable(),
  opportunityType: z.string().min(1),
});

export const trackedCoreQueryReportSchema = z.object({
  query: z.string().min(1),
  cluster: z.string().min(1),
  observedInWebmaster: z.boolean(),
  shows: z.number().nonnegative().nullable(),
  clicks: z.number().nonnegative().nullable(),
  ctr: z.number().nonnegative().nullable(),
  avgShowPosition: z.number().nonnegative().nullable(),
  previousShows: z.number().nonnegative().nullable(),
  previousClicks: z.number().nonnegative().nullable(),
  previousAvgShowPosition: z.number().nonnegative().nullable(),
  deltaClicksPercent: z.number().nullable(),
  deltaCtrPoints: z.number().nullable(),
  deltaPosition: z.number().nullable(),
  ownerPosition: z.number().int().min(1).max(250).nullable(),
  ownerBaselinePosition: z.number().int().min(1).max(250).nullable(),
  ownerPositionDelta: z.number().int().nullable(),
  opportunityType: z.string().min(1),
});

export const webmasterHealthSchema = z.object({
  status: z.enum(["stable", "attention", "critical"]),
  fatalCount: z.number().int().nonnegative(),
  criticalCount: z.number().int().nonnegative(),
  possibleProblemCount: z.number().int().nonnegative(),
  recommendationCount: z.number().int().nonnegative(),
  sitemapUrls: z.number().int().nonnegative(),
  sitemapErrors: z.number().int().nonnegative(),
  pagesInSearch: z.number().int().nonnegative(),
  excludedPages: z.number().int().nonnegative(),
  appearedInSearch: z.number().int().nonnegative(),
  removedFromSearch: z.number().int().nonnegative(),
  searchBalance: z.number().int(),
  http2xx: z.number().int().nonnegative(),
  http3xx: z.number().int().nonnegative(),
  http4xx: z.number().int().nonnegative(),
  http5xx: z.number().int().nonnegative(),
  otherHttp: z.number().int().nonnegative(),
  sqi: z.number().int().nonnegative().nullable(),
  previousSqi: z.number().int().nonnegative().nullable(),
  sqiDelta: z.number().int().nullable(),
});

export const trackedCoreReportSchema = z.object({
  expectedCount: z.number().int().min(1).max(100),
  observedCount: z.number().int().nonnegative(),
  coveragePercent: z.number().min(0).max(100),
  top3Count: z.number().int().nonnegative(),
  top10Count: z.number().int().nonnegative(),
  top20Count: z.number().int().nonnegative(),
  below20Count: z.number().int().nonnegative(),
  unmeasuredCount: z.number().int().nonnegative(),
  baselineLabel: z.string().min(1),
  queries: z.array(trackedCoreQueryReportSchema).max(100),
});

export const rankingMovementSchema = z.enum([
  "improved",
  "declined",
  "unchanged",
  "new",
  "lost",
  "unmeasured",
]);

export const rankingQueryReportSchema = z.object({
  query: z.string().min(1),
  cluster: z.string().min(1),
  currentPosition: z.number().int().min(1).max(250).nullable(),
  previousPosition: z.number().int().min(1).max(250).nullable(),
  positionDelta: z.number().int().nullable(),
  movement: rankingMovementSchema,
  shows: z.number().nonnegative().nullable(),
  clicks: z.number().nonnegative().nullable(),
  ctr: z.number().nonnegative().nullable(),
});

export const rankingHistoryPointSchema = z.object({
  date: isoDateSchema,
  top3Count: z.number().int().nonnegative(),
  top10Count: z.number().int().nonnegative(),
  top3Share: z.number().min(0).max(100),
  top10Share: z.number().min(0).max(100),
});

export const trackedRankingReportSchema = z.object({
  source: z.enum(["topvisor", "owner-provided"]),
  queryCount: z.number().int().min(1).max(100),
  measuredCount: z.number().int().nonnegative(),
  top3Count: z.number().int().nonnegative(),
  top10Count: z.number().int().nonnegative(),
  top3Share: z.number().min(0).max(100),
  top10Share: z.number().min(0).max(100),
  top3Delta: z.number().int().nullable(),
  top10Delta: z.number().int().nullable(),
  improvedCount: z.number().int().nonnegative(),
  declinedCount: z.number().int().nonnegative(),
  unchangedCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  lostCount: z.number().int().nonnegative(),
  unmeasuredCount: z.number().int().nonnegative(),
  baselineLabel: z.string().min(1),
  lastCapturedAt: isoDateSchema.nullable(),
  history: z.array(rankingHistoryPointSchema),
  queries: z.array(rankingQueryReportSchema).min(1).max(100),
});

export const landingPageSchema = z.object({
  path: z.string().min(1),
  visits: z.number().nonnegative(),
  users: z.number().nonnegative(),
  pageviews: z.number().nonnegative(),
  bounceRate: z.number().nonnegative(),
  depth: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  goals: z.number().nonnegative(),
  targetVisits: z.number().nonnegative().default(0),
  conversionRate: z.number().nonnegative().nullable(),
  trendLabel: z.string().min(1),
});

export const opportunitySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  source: z.enum(["webmaster", "metrica", "combined"]),
  tone: severitySchema,
});

export const alertSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  tone: severitySchema,
});

export const webmasterReportSchema = z.object({
  summary: z.object({
    shows: z.number().nonnegative(),
    clicks: z.number().nonnegative(),
    ctr: z.number().nonnegative(),
    avgPosition: z.number().nonnegative().nullable(),
    pagesInSearch: z.number().nonnegative(),
    excludedPages: z.number().nonnegative(),
    sitemapUrls: z.number().nonnegative(),
    sqi: z.number().nonnegative().nullable(),
  }),
  visibilityTrend: z.array(trendPointSchema),
  queries: z.array(webmasterQuerySchema),
  diagnostics: z.array(
    z.object({
      severity: severitySchema,
      title: z.string().min(1),
      description: z.string().min(1),
    }),
  ),
  sitemap: z
    .object({
      url: z.string().url(),
      urls: z.number().nonnegative(),
      errors: z.number().nonnegative(),
    })
    .nullable(),
  links: z.object({
    external: z.number().nonnegative(),
    brokenInternal: z.number().nonnegative(),
  }),
  health: webmasterHealthSchema.nullable().default(null),
  trackedCore: trackedCoreReportSchema.nullable().default(null),
  observedOutsideCore: z.array(webmasterQuerySchema).max(100).default([]),
});

export const metricaReportSchema = z.object({
  summary: z.object({
    visits: z.number().nonnegative(),
    users: z.number().nonnegative(),
    pageviews: z.number().nonnegative(),
    bounceRate: z.number().nonnegative(),
    depth: z.number().nonnegative(),
    averageVisitDurationSeconds: z.number().nonnegative(),
    goalReaches: z.number().nonnegative(),
    targetVisits: z.number().nonnegative().default(0),
    targetUsers: z.number().nonnegative().default(0),
    allVisits: z.number().nonnegative().default(0),
    conversionRate: z.number().nonnegative().nullable(),
  }),
  organicTrend: z.array(trendPointSchema),
  landingPages: z.array(landingPageSchema),
  devices: z.array(
    z.object({
      device: z.string().min(1),
      visits: z.number().nonnegative(),
      conversionRate: z.number().nonnegative().nullable(),
    }),
  ),
  goals: z.array(
    z.object({
      label: z.string().min(1),
      category: z.string().min(1),
      reaches: z.number().nonnegative(),
      conversionRate: z.number().nonnegative().nullable(),
    }),
  ),
});

export const combinedSeoReportSchema = z.object({
  funnel: z.object({
    shows: z.number().nonnegative(),
    clicks: z.number().nonnegative(),
    visits: z.number().nonnegative(),
    goalReaches: z.number().nonnegative(),
    caveats: z.array(z.string().min(1)).min(1),
  }),
  opportunities: z.array(opportunitySchema),
  alerts: z.array(alertSchema),
  methodology: z.array(z.string().min(1)).min(1),
});

export const siteReportSnapshotSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  clientSlug: z.string().regex(slugPattern),
  siteSlug: z.string().regex(slugPattern),
  siteUrl: z.string().url(),
  generatedAt: isoDateTimeSchema,
  freshness: z.enum(["fresh", "stale", "partial", "unavailable"]),
  sources: z.object({
    webmaster: sourceStateSchema,
    metrica: sourceStateSchema,
    topvisor: sourceStateSchema.optional(),
  }),
  webmaster: webmasterReportSchema.nullable(),
  periodKey: reportPeriodKeySchema.default("month"),
  comparison: reportComparisonSchema.nullable().default(null),
  metrica: metricaReportSchema.nullable(),
  ranking: trackedRankingReportSchema.nullable().default(null),
  combined: combinedSeoReportSchema,
});

export const clientSyncResultSchema = z.object({
  clientSlug: z.string().regex(slugPattern),
  status: z.enum(["success", "partial", "failed"]),
  sitesTotal: z.number().int().nonnegative(),
  sitesSucceeded: z.number().int().nonnegative(),
  sitesFailed: z.number().int().nonnegative(),
});

export const syncRunSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  mode: z.enum(["daily", "weekly", "backfill", "preflight"]),
  status: z.enum(["running", "success", "partial", "failed"]),
  clients: z.array(clientSyncResultSchema),
  safeErrorCodes: z.array(z.string().min(1)),
});

export type TrendPoint = z.infer<typeof trendPointSchema>;
export type SiteReportSnapshot = z.infer<typeof siteReportSnapshotSchema>;
export type SyncRun = z.infer<typeof syncRunSchema>;
export type ReportPeriodKey = z.infer<typeof reportPeriodKeySchema>;
export type ReportComparison = z.infer<typeof reportComparisonSchema>;
export type WebmasterReport = z.infer<typeof webmasterReportSchema>;
export type TrackedCoreReport = z.infer<typeof trackedCoreReportSchema>;
export type TrackedRankingReport = z.infer<typeof trackedRankingReportSchema>;
export type RankingMovement = z.infer<typeof rankingMovementSchema>;
export type MetricaReport = z.infer<typeof metricaReportSchema>;
export type CombinedSeoReport = z.infer<typeof combinedSeoReportSchema>;
