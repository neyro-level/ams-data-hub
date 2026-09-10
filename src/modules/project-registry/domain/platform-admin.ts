import { z } from "zod";

const idSchema = z.string().trim().min(1).max(128);
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Используйте строчные латинские буквы, цифры и дефис");
const siteNameSchema = z.string().trim().min(2, "Укажите название сайта").max(160);
const projectNameSchema = z.string().trim().min(2).max(160);
const timezoneSchema = z.string().trim().min(1).max(64);
const finiteNumberSchema = z.number().finite();
const positiveVersionSchema = z.number().int().positive();
const settingsScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const sensitiveSettingKey = /(token|secret|password|credential|authorization|api.?key)/i;
const trackedQueryTextSchema = z.string().trim().min(1).max(500);

function uniqueQueries(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export const providerSchema = z.enum([
  "YANDEX_WEBMASTER",
  "YANDEX_METRIKA",
  "TOPVISOR",
]);
export const rankingSourceSchema = z.enum(["OWNER_PROVIDED", "TOPVISOR"]);
export const goalCategorySchema = z.enum([
  "LEAD_SUBMIT",
  "PHONE_CLICK",
  "MESSENGER_CLICK",
  "FORM_START",
  "FILE_DOWNLOAD",
  "OTHER",
]);
export const goalDirectionSchema = z.enum(["PRIMARY", "SECONDARY"]);

export const settingsJsonSchema = z
  .record(z.string(), settingsScalarSchema)
  .nullable()
  .superRefine((value, ctx) => {
    if (!value) return;
    for (const key of Object.keys(value)) {
      if (sensitiveSettingKey.test(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Разрешён только плоский nonsecret JSON без token, password, secret и API key",
        });
        return;
      }
    }
  });

const resourceUpdateSchema = z.object({
  id: idSchema,
  version: positiveVersionSchema,
});

export const createSiteInputSchema = z.object({
  projectId: idSchema,
  slug: slugSchema,
  name: siteNameSchema,
  url: z.url(),
  timezone: timezoneSchema,
  enabled: z.boolean(),
});
export const updateSiteInputSchema = resourceUpdateSchema.extend({
  slug: slugSchema,
  name: siteNameSchema,
  url: z.url(),
  timezone: timezoneSchema,
  enabled: z.boolean(),
});
export const saveSiteInputSchema = z.union([
  createSiteInputSchema,
  updateSiteInputSchema,
]);

export const createProviderConnectionInputSchema = z.object({
  siteId: idSchema,
  provider: providerSchema,
  externalId: z.string().trim().max(160).nullable(),
  enabled: z.boolean(),
  settingsJson: settingsJsonSchema,
});
export const updateProviderConnectionInputSchema = resourceUpdateSchema.extend({
  externalId: z.string().trim().max(160).nullable(),
  enabled: z.boolean(),
  settingsJson: settingsJsonSchema,
});
export const saveProviderConnectionInputSchema = z.union([
  createProviderConnectionInputSchema,
  updateProviderConnectionInputSchema,
]);

export const confirmMetricaGoalsInputSchema = z.object({
  siteId: idSchema,
  leadGoalId: idSchema,
  phoneGoalId: idSchema,
}).refine((value) => value.leadGoalId !== value.phoneGoalId, {
  message: "Для двух бизнес-целей выберите разные цели Метрики",
  path: ["phoneGoalId"],
});

export const createGoalDefinitionInputSchema = z.object({
  projectId: idSchema,
  externalGoalId: idSchema,
  label: projectNameSchema,
  category: goalCategorySchema,
  direction: goalDirectionSchema,
  includeInSeoConversion: z.boolean(),
  siteIds: z.array(idSchema).max(100).transform(uniqueQueries),
});
export const updateGoalDefinitionInputSchema = resourceUpdateSchema.extend({
  label: projectNameSchema,
  category: goalCategorySchema,
  direction: goalDirectionSchema,
  includeInSeoConversion: z.boolean(),
  siteIds: z.array(idSchema).max(100).transform(uniqueQueries),
});
export const saveGoalDefinitionInputSchema = z.union([
  createGoalDefinitionInputSchema,
  updateGoalDefinitionInputSchema,
]);

export const trackedQueryListInputSchema = z
  .array(trackedQueryTextSchema)
  .min(1, "Добавьте хотя бы один запрос")
  .max(5000)
  .transform(uniqueQueries);

export const createTrackedQuerySetInputSchema = z.object({
  siteId: idSchema,
  source: rankingSourceSchema,
  baselineLabel: z.string().trim().min(2).max(160),
  queries: trackedQueryListInputSchema,
});
export const updateTrackedQuerySetInputSchema = resourceUpdateSchema.extend({
  source: rankingSourceSchema,
  baselineLabel: z.string().trim().min(2).max(160),
  queries: trackedQueryListInputSchema,
});
export const saveTrackedQuerySetInputSchema = z.union([
  createTrackedQuerySetInputSchema,
  updateTrackedQuerySetInputSchema,
]);

export const createThresholdProfileInputSchema = z.object({
  slug: slugSchema,
  minimumShows: z.number().int().min(0),
  maximumCtrPercent: finiteNumberSchema,
  maximumAveragePosition: finiteNumberSchema,
  showsDropPercent: finiteNumberSchema,
  clicksDropPercent: finiteNumberSchema,
  positionWorsenedDelta: finiteNumberSchema,
  pagesInSearchDropPercent: finiteNumberSchema,
  organicVisitsDropPercent: finiteNumberSchema,
  goalConversionDropPercent: finiteNumberSchema,
});
export const updateThresholdProfileInputSchema = resourceUpdateSchema.extend({
  minimumShows: z.number().int().min(0),
  maximumCtrPercent: finiteNumberSchema,
  maximumAveragePosition: finiteNumberSchema,
  showsDropPercent: finiteNumberSchema,
  clicksDropPercent: finiteNumberSchema,
  positionWorsenedDelta: finiteNumberSchema,
  pagesInSearchDropPercent: finiteNumberSchema,
  organicVisitsDropPercent: finiteNumberSchema,
  goalConversionDropPercent: finiteNumberSchema,
});
export const saveThresholdProfileInputSchema = z.union([
  createThresholdProfileInputSchema,
  updateThresholdProfileInputSchema,
]);

export const queryClusterGroupInputSchema = z.object({
  slug: slugSchema,
  label: z.string().trim().min(1).max(160),
  order: z.number().int().min(0),
  brandTerms: z.array(z.string().trim().min(1)).max(500),
  terms: z.array(z.string().trim().min(1)).max(500),
});
export const createQueryClusterProfileInputSchema = z.object({
  slug: slugSchema,
  name: projectNameSchema,
  groups: z.array(queryClusterGroupInputSchema).min(1).max(500),
});
export const updateQueryClusterProfileInputSchema = resourceUpdateSchema.extend({
  name: projectNameSchema,
  groups: z.array(queryClusterGroupInputSchema).min(1).max(500),
});
export const saveQueryClusterProfileInputSchema = z.union([
  createQueryClusterProfileInputSchema,
  updateQueryClusterProfileInputSchema,
]);

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(""),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

export const siteListQuerySchema = paginationSchema.extend({
  projectId: idSchema.nullable().default(null),
  enabled: z.boolean().nullable().default(null),
  sort: z.enum(["name", "slug", "updatedAt"]).default("updatedAt"),
});
export const providerConnectionListQuerySchema = paginationSchema.extend({
  siteId: idSchema.nullable().default(null),
  provider: providerSchema.nullable().default(null),
  enabled: z.boolean().nullable().default(null),
  sort: z.enum(["provider", "updatedAt"]).default("updatedAt"),
});
export const goalDefinitionListQuerySchema = paginationSchema.extend({
  projectId: idSchema.nullable().default(null),
  includeInSeoConversion: z.boolean().nullable().default(null),
  category: goalCategorySchema.nullable().default(null),
  sort: z.enum(["label", "externalGoalId", "updatedAt"]).default("updatedAt"),
});
export const trackedQuerySetListQuerySchema = paginationSchema.extend({
  siteId: idSchema.nullable().default(null),
  source: rankingSourceSchema.nullable().default(null),
  sort: z.enum(["baselineLabel", "expectedCount", "updatedAt"]).default("updatedAt"),
});
export const thresholdProfileListQuerySchema = paginationSchema.extend({
  sort: z.enum(["slug", "updatedAt"]).default("updatedAt"),
});
export const queryClusterProfileListQuerySchema = paginationSchema.extend({
  sort: z.enum(["name", "slug", "updatedAt"]).default("updatedAt"),
});

export type SaveSiteInput = z.infer<typeof saveSiteInputSchema>;
export type CreateSiteInput = z.infer<typeof createSiteInputSchema>;
export type UpdateSiteInput = z.infer<typeof updateSiteInputSchema>;
export type SaveProviderConnectionInput = z.infer<typeof saveProviderConnectionInputSchema>;
export type ConfirmMetricaGoalsInput = z.infer<typeof confirmMetricaGoalsInputSchema>;
export type CreateProviderConnectionInput = z.infer<typeof createProviderConnectionInputSchema>;
export type UpdateProviderConnectionInput = z.infer<typeof updateProviderConnectionInputSchema>;
export type SaveGoalDefinitionInput = z.infer<typeof saveGoalDefinitionInputSchema>;
export type CreateGoalDefinitionInput = z.infer<typeof createGoalDefinitionInputSchema>;
export type UpdateGoalDefinitionInput = z.infer<typeof updateGoalDefinitionInputSchema>;
export type SaveTrackedQuerySetInput = z.infer<typeof saveTrackedQuerySetInputSchema>;
export type CreateTrackedQuerySetInput = z.infer<typeof createTrackedQuerySetInputSchema>;
export type UpdateTrackedQuerySetInput = z.infer<typeof updateTrackedQuerySetInputSchema>;
export type SaveThresholdProfileInput = z.infer<typeof saveThresholdProfileInputSchema>;
export type CreateThresholdProfileInput = z.infer<typeof createThresholdProfileInputSchema>;
export type UpdateThresholdProfileInput = z.infer<typeof updateThresholdProfileInputSchema>;
export type SaveQueryClusterProfileInput = z.infer<typeof saveQueryClusterProfileInputSchema>;
export type CreateQueryClusterProfileInput = z.infer<typeof createQueryClusterProfileInputSchema>;
export type UpdateQueryClusterProfileInput = z.infer<typeof updateQueryClusterProfileInputSchema>;
export type QueryClusterGroupInput = z.infer<typeof queryClusterGroupInputSchema>;
export type SiteListQuery = z.infer<typeof siteListQuerySchema>;
export type ProviderConnectionListQuery = z.infer<typeof providerConnectionListQuerySchema>;
export type GoalDefinitionListQuery = z.infer<typeof goalDefinitionListQuerySchema>;
export type TrackedQuerySetListQuery = z.infer<typeof trackedQuerySetListQuerySchema>;
export type ThresholdProfileListQuery = z.infer<typeof thresholdProfileListQuerySchema>;
export type QueryClusterProfileListQuery = z.infer<typeof queryClusterProfileListQuerySchema>;
export type Provider = z.infer<typeof providerSchema>;
export type RankingSource = z.infer<typeof rankingSourceSchema>;
export type GoalCategory = z.infer<typeof goalCategorySchema>;
export type GoalDirection = z.infer<typeof goalDirectionSchema>;

export type ProjectRegistryAdminErrorCode =
  | "PROJECT_REGISTRY_ADMIN_ACCESS_DENIED"
  | "SITE_CONFLICT"
  | "SITE_NOT_FOUND_OR_FORBIDDEN"
  | "SITE_REFERENCE_INVALID"
  | "SITE_STALE"
  | "PROVIDER_CONNECTION_CONFLICT"
  | "PROVIDER_CONNECTION_NOT_FOUND_OR_FORBIDDEN"
  | "PROVIDER_CONNECTION_REFERENCE_INVALID"
  | "PROVIDER_CONNECTION_STALE"
  | "METRIKA_GOAL_MAPPING_INVALID"
  | "GOAL_DEFINITION_CONFLICT"
  | "GOAL_DEFINITION_NOT_FOUND_OR_FORBIDDEN"
  | "GOAL_DEFINITION_REFERENCE_INVALID"
  | "GOAL_DEFINITION_STALE"
  | "TRACKED_QUERY_SET_CONFLICT"
  | "TRACKED_QUERY_SET_NOT_FOUND_OR_FORBIDDEN"
  | "TRACKED_QUERY_SET_REFERENCE_INVALID"
  | "TRACKED_QUERY_SET_STALE"
  | "THRESHOLD_PROFILE_NOT_FOUND_OR_FORBIDDEN"
  | "THRESHOLD_PROFILE_REFERENCE_INVALID"
  | "THRESHOLD_PROFILE_SLUG_CONFLICT"
  | "THRESHOLD_PROFILE_STALE"
  | "QUERY_CLUSTER_PROFILE_NOT_FOUND_OR_FORBIDDEN"
  | "QUERY_CLUSTER_PROFILE_REFERENCE_INVALID"
  | "QUERY_CLUSTER_PROFILE_SLUG_CONFLICT"
  | "QUERY_CLUSTER_PROFILE_STALE";

export class ProjectRegistryAdminError extends Error {
  constructor(public readonly code: ProjectRegistryAdminErrorCode) {
    super(code);
    this.name = "ProjectRegistryAdminError";
  }
}

export function nextResourceVersion(
  version: number,
  staleCode:
    | "SITE_STALE"
    | "PROVIDER_CONNECTION_STALE"
    | "GOAL_DEFINITION_STALE"
    | "TRACKED_QUERY_SET_STALE"
    | "THRESHOLD_PROFILE_STALE"
    | "QUERY_CLUSTER_PROFILE_STALE",
) {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ProjectRegistryAdminError(staleCode);
  }
  return version + 1;
}

export function normalizeTrackedQuery(query: string) {
  return query.toLocaleLowerCase("ru").replace(/\s+/g, " ").trim();
}
