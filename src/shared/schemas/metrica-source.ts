import { z } from "zod";

export const metricaSafeErrorCodeSchema = z.enum([
  "TOKEN_INACTIVE",
  "MISSING_ENV",
  "UNTRUSTED_ORIGIN",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "NETWORK_ERROR",
  "COUNTER_MISSING",
  "INVALID_RESPONSE",
]);

export const metricaPermissionSchema = z.enum(["own", "view", "edit", "unknown"]);

export const metricaCounterAccessSchema = z.object({
  counterId: z.string().min(1),
  site: z.string().min(1),
  permission: metricaPermissionSchema,
  name: z.string().min(1),
  timeZoneName: z.string().nullable(),
  timeZoneOffsetMinutes: z.number().int().nullable(),
});

export const metricaGoalSchema = z.object({
  goalId: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  isFavorite: z.boolean().nullable(),
  status: z.string().nullable(),
});

export const metricaAllowedGoalSchema = z.object({
  goalId: z.string().min(1),
  label: z.string().min(1),
  category: z.enum([
    "lead_submit",
    "phone_click",
    "messenger_click",
    "form_start",
    "file_download",
    "other",
  ]),
  direction: z.enum(["primary", "secondary"]),
  includeInSeoConversion: z.boolean(),
});

export const metricaSampleMetaSchema = z.object({
  sampled: z.boolean(),
  containsSensitiveData: z.boolean(),
  sampleShare: z.number().nullable(),
  sampleSize: z.number().nullable(),
  sampleSpace: z.number().nullable(),
  totalRows: z.number().int().nullable(),
  totalRowsRounded: z.boolean().nullable(),
  date1: z.string().nullable(),
  date2: z.string().nullable(),
  timezone: z.string().nullable(),
});

export const metricaSummarySchema = z.object({
  visits: z.number().nonnegative(),
  users: z.number().nonnegative(),
  pageviews: z.number().nonnegative(),
  bounceRate: z.number().nonnegative(),
  pageDepth: z.number().nonnegative(),
  averageVisitDurationSeconds: z.number().nonnegative(),
  goalReaches: z.number().nonnegative(),
  targetVisits: z.number().nonnegative().default(0),
  targetUsers: z.number().nonnegative().default(0),
  conversionRate: z.number().nonnegative().nullable(),
});

export const metricaTrendPointSchema = z.object({
  date: z.string().min(1),
  visits: z.number().nonnegative(),
  goalReaches: z.number().nonnegative(),
  targetVisits: z.number().nonnegative().default(0),
  conversionRate: z.number().nonnegative().nullable(),
});

export const metricaLandingPageSchema = z.object({
  path: z.string().min(1),
  visits: z.number().nonnegative(),
  users: z.number().nonnegative(),
  pageviews: z.number().nonnegative(),
  bounceRate: z.number().nonnegative(),
  pageDepth: z.number().nonnegative(),
  averageVisitDurationSeconds: z.number().nonnegative(),
  goalReaches: z.number().nonnegative(),
  targetVisits: z.number().nonnegative().default(0),
  conversionRate: z.number().nonnegative().nullable(),
});

export const metricaDeviceRowSchema = z.object({
  device: z.string().min(1),
  visits: z.number().nonnegative(),
  users: z.number().nonnegative(),
  goalReaches: z.number().nonnegative(),
  conversionRate: z.number().nonnegative().nullable(),
});

export const metricaGoalStatSchema = z.object({
  goalId: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  direction: z.enum(["primary", "secondary"]),
  reaches: z.number().nonnegative(),
  visits: z.number().nonnegative(),
  users: z.number().nonnegative(),
  conversionRate: z.number().nonnegative().nullable(),
});

export const metricaOrganicEngineRowSchema = z.object({
  engine: z.enum(["YANDEX", "GOOGLE"]),
  visits: z.number().nonnegative(),
  users: z.number().nonnegative(),
  goalReaches: z.number().nonnegative(),
  uniqueTargetVisits: z.number().nonnegative(),
  conversionRate: z.number().nonnegative().nullable(),
});

export const metricaSearchPhraseRowSchema = z.object({
  engine: z.enum(["YANDEX", "GOOGLE"]),
  phrase: z.string().min(1),
  visits: z.number().nonnegative(),
  users: z.number().nonnegative(),
  goalReaches: z.number().nonnegative(),
  uniqueTargetVisits: z.number().nonnegative(),
});

export const metricaGeoRowSchema = z.object({
  regionKey: z.string().min(1),
  regionName: z.string().min(1),
  visits: z.number().nonnegative(),
  users: z.number().nonnegative(),
  goalReaches: z.number().nonnegative(),
  uniqueTargetVisits: z.number().nonnegative(),
});

export const metricaPreflightSchema = z.object({
  schemaVersion: z.literal(1),
  checkedAt: z.string().datetime({ offset: true }),
  access: metricaCounterAccessSchema,
  goals: z.array(metricaGoalSchema),
});

export const metricaSiteAuditSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  fetchedAt: z.string().datetime({ offset: true }),
  access: metricaCounterAccessSchema,
  goals: z.array(metricaGoalSchema),
  allowedGoals: z.array(metricaAllowedGoalSchema),
  allTraffic: z.object({
    meta: metricaSampleMetaSchema,
    summary: metricaSummarySchema,
  }),
  yandexOrganic: z.object({
    meta: metricaSampleMetaSchema,
    summary: metricaSummarySchema,
    byTime: z.array(metricaTrendPointSchema),
    landingPages: z.array(metricaLandingPageSchema),
    devices: z.array(metricaDeviceRowSchema),
  }),
  goalsSummary: z.object({
    meta: metricaSampleMetaSchema,
    items: z.array(metricaGoalStatSchema),
  }),
  organicEngines: z.array(metricaOrganicEngineRowSchema).optional(),
  searchPhrases: z.array(metricaSearchPhraseRowSchema).optional(),
  geography: z.array(metricaGeoRowSchema).optional(),
});

export type MetricaSafeErrorCode = z.infer<typeof metricaSafeErrorCodeSchema>;
export type MetricaCounterAccess = z.infer<typeof metricaCounterAccessSchema>;
export type MetricaGoal = z.infer<typeof metricaGoalSchema>;
export type MetricaAllowedGoal = z.infer<typeof metricaAllowedGoalSchema>;
export type MetricaSampleMeta = z.infer<typeof metricaSampleMetaSchema>;
export type MetricaSummary = z.infer<typeof metricaSummarySchema>;
export type MetricaTrendPoint = z.infer<typeof metricaTrendPointSchema>;
export type MetricaLandingPage = z.infer<typeof metricaLandingPageSchema>;
export type MetricaDeviceRow = z.infer<typeof metricaDeviceRowSchema>;
export type MetricaGoalStat = z.infer<typeof metricaGoalStatSchema>;
export type MetricaOrganicEngineRow = z.infer<typeof metricaOrganicEngineRowSchema>;
export type MetricaSearchPhraseRow = z.infer<typeof metricaSearchPhraseRowSchema>;
export type MetricaGeoRow = z.infer<typeof metricaGeoRowSchema>;
export type MetricaPreflight = z.infer<typeof metricaPreflightSchema>;
export type MetricaSiteAudit = z.infer<typeof metricaSiteAuditSchema>;
