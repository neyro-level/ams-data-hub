import { z } from "zod";

export const webmasterSafeErrorCodeSchema = z.enum([
  "TOKEN_INACTIVE",
  "MISSING_ENV",
  "UNTRUSTED_ORIGIN",
  "INVALID_RESPONSE",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "NETWORK_ERROR",
  "TARGET_SITE_MISSING",
  "TARGET_SITE_UNVERIFIED",
]);

export const webmasterProblemSeveritySchema = z.enum([
  "FATAL",
  "CRITICAL",
  "POSSIBLE_PROBLEM",
  "RECOMMENDATION",
  "UNKNOWN",
]);

export const webmasterProblemStateSchema = z.enum(["PRESENT", "ABSENT", "UNDEFINED", "UNKNOWN"]);
export const webmasterQueryOrderBySchema = z.enum(["TOTAL_SHOWS", "TOTAL_CLICKS"]);
export const webmasterDeviceSchema = z.enum(["ALL", "DESKTOP", "MOBILE", "TABLET", "MOBILE_AND_TABLET"]);

export const webmasterHostAccessSchema = z.object({
  userId: z.string().min(1),
  hostId: z.string().min(1),
  matchedHostUrl: z.string().url(),
  targetSiteUrl: z.string().url(),
  verified: z.boolean(),
});

export const webmasterSummarySchema = z.object({
  siteUrl: z.string().url(),
  searchablePages: z.number().nonnegative().nullable(),
  excludedPages: z.number().nonnegative().nullable(),
  sqi: z.number().nonnegative().nullable(),
});

export const webmasterDiagnosticSchema = z.object({
  code: z.string().min(1),
  severity: webmasterProblemSeveritySchema,
  state: webmasterProblemStateSchema,
  lastStateUpdate: z.string().nullable(),
});

export const webmasterSitemapSchema = z.object({
  id: z.string().nullable(),
  url: z.string().url().nullable(),
  status: z.string().nullable(),
  lastDownloadedAt: z.string().nullable(),
  urlsTotal: z.number().nonnegative().nullable(),
  errorsCount: z.number().nonnegative().nullable(),
  warningsCount: z.number().nonnegative().nullable(),
});

export const webmasterQuerySchema = z.object({
  queryId: z.string().min(1),
  queryText: z.string().min(1),
  orderBy: webmasterQueryOrderBySchema,
  device: webmasterDeviceSchema,
  shows: z.number().nonnegative(),
  clicks: z.number().nonnegative(),
  ctrPercent: z.number().nonnegative().nullable(),
  avgShowPosition: z.number().nonnegative().nullable(),
  avgClickPosition: z.number().nonnegative().nullable(),
  demand: z.number().nonnegative().nullable().optional(),
  relevantUrl: z.string().nullable().optional(),
});

export const webmasterQueryCollectionSchema = z.object({
  orderBy: webmasterQueryOrderBySchema,
  device: webmasterDeviceSchema,
  requestedLimit: z.number().int().positive(),
  dateFrom: z.string().nullable(),
  dateTo: z.string().nullable(),
  totalAvailable: z.number().nonnegative().nullable(),
  queries: z.array(webmasterQuerySchema),
});

export const webmasterHistoryPointSchema = z.object({
  date: z.string().min(1),
  value: z.number().nonnegative(),
});

export const webmasterIndicatorHistorySchema = z.object({
  indicator: z.string().min(1),
  points: z.array(webmasterHistoryPointSchema),
});

export const webmasterEndpointErrorSchema = z.object({
  endpoint: z.string().min(1),
  code: webmasterSafeErrorCodeSchema,
  status: z.number().int().nullable(),
});

export const webmasterSiteDataSchema = z.object({
  schemaVersion: z.literal(1),
  fetchedAt: z.string().datetime({ offset: true }),
  access: webmasterHostAccessSchema,
  summary: webmasterSummarySchema,
  diagnostics: z.array(webmasterDiagnosticSchema),
  sitemaps: z.array(webmasterSitemapSchema),
  queryCollections: z.array(webmasterQueryCollectionSchema),
  allQueryHistory: z.array(webmasterIndicatorHistorySchema),
  indexingHistory: z.array(webmasterIndicatorHistorySchema),
  sqiHistory: z.array(webmasterHistoryPointSchema).default([]),
  pagesInSearchHistory: z.array(webmasterHistoryPointSchema),
  searchEventsHistory: z.array(webmasterIndicatorHistorySchema),
  brokenInternalLinksHistory: z.array(webmasterIndicatorHistorySchema),
  externalLinksHistory: z.array(webmasterIndicatorHistorySchema),
  partial: z.boolean(),
  endpointErrors: z.array(webmasterEndpointErrorSchema),
});

export type WebmasterSafeErrorCode = z.infer<typeof webmasterSafeErrorCodeSchema>;
export type WebmasterHostAccess = z.infer<typeof webmasterHostAccessSchema>;
export type WebmasterSummary = z.infer<typeof webmasterSummarySchema>;
export type WebmasterDiagnostic = z.infer<typeof webmasterDiagnosticSchema>;
export type WebmasterSitemap = z.infer<typeof webmasterSitemapSchema>;
export type WebmasterQuery = z.infer<typeof webmasterQuerySchema>;
export type WebmasterQueryOrderBy = z.infer<typeof webmasterQueryOrderBySchema>;
export type WebmasterDevice = z.infer<typeof webmasterDeviceSchema>;
export type WebmasterQueryCollection = z.infer<typeof webmasterQueryCollectionSchema>;
export type WebmasterHistoryPoint = z.infer<typeof webmasterHistoryPointSchema>;
export type WebmasterIndicatorHistory = z.infer<typeof webmasterIndicatorHistorySchema>;
export type WebmasterEndpointError = z.infer<typeof webmasterEndpointErrorSchema>;
export type WebmasterSiteData = z.infer<typeof webmasterSiteDataSchema>;
