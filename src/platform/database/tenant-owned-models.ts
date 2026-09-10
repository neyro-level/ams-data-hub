export const TENANT_OWNED_MODELS = [
  "Project",
  "Site",
  "ProviderConnection",
  "GoalDefinition",
  "GoalDefinitionSite",
  "TrackedQuerySet",
  "TrackedQuery",
  "RankingCapture",
  "SearchTarget",
  "ProviderOperation",
  "CompetitorSnapshot",
  "SyncRun",
  "SourceRun",
  "WebmasterDailyMetric",
  "WebmasterQueryDailyMetric",
  "MetrikaDailyMetric",
  "LandingPageDailyMetric",
  "MetrikaDeviceDailyMetric",
  "MetrikaGoalDailyMetric",
  "MetrikaSearchEngineDailyMetric",
  "MetrikaSearchPhraseDailyMetric",
  "MetrikaGeoDailyMetric",
  "TechnicalSnapshot",
  "ReportSnapshot",
  "AuditEvent",
  "IdempotencyKey",
  "OutboxEvent",
  "JobRun",
  "Notification",
] as const;

export type TenantOwnedModel = (typeof TENANT_OWNED_MODELS)[number];

export function isTenantOwnedModel(model: string): model is TenantOwnedModel {
  return TENANT_OWNED_MODELS.some((candidate) => candidate === model);
}
