-- Expand: every tenant-owned record receives a nullable ownership column first.
-- Contract/non-null/composite foreign keys follow only after backfill proof and dual-write cutover.
ALTER TABLE "Site" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "ProviderConnection" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "GoalDefinition" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "GoalDefinitionSite" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "TrackedQuerySet" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "TrackedQuery" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "SyncRun" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "SourceRun" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "WebmasterDailyMetric" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "WebmasterQueryDailyMetric" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "MetrikaDailyMetric" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "LandingPageDailyMetric" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "MetrikaDeviceDailyMetric" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "MetrikaGoalDailyMetric" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "RankingCapture" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "TechnicalSnapshot" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "ReportSnapshot" ADD COLUMN "organizationId" TEXT;

-- Deterministic backfill from the nearest existing parent ownership.
UPDATE "Site" AS site
SET "organizationId" = project."organizationId"
FROM "Project" AS project
WHERE site."projectId" = project.id AND site."organizationId" IS NULL;

UPDATE "ProviderConnection" AS connection
SET "organizationId" = site."organizationId"
FROM "Site" AS site
WHERE connection."siteId" = site.id AND connection."organizationId" IS NULL;

UPDATE "GoalDefinition" AS goal
SET "organizationId" = project."organizationId"
FROM "Project" AS project
WHERE goal."projectId" = project.id AND goal."organizationId" IS NULL;

UPDATE "GoalDefinitionSite" AS scope
SET "organizationId" = goal."organizationId"
FROM "GoalDefinition" AS goal
WHERE scope."goalDefinitionId" = goal.id AND scope."organizationId" IS NULL;

UPDATE "TrackedQuerySet" AS query_set
SET "organizationId" = site."organizationId"
FROM "Site" AS site
WHERE query_set."siteId" = site.id AND query_set."organizationId" IS NULL;

UPDATE "TrackedQuery" AS query
SET "organizationId" = query_set."organizationId"
FROM "TrackedQuerySet" AS query_set
WHERE query."trackedQuerySetId" = query_set.id AND query."organizationId" IS NULL;

UPDATE "SourceRun" AS source_run
SET "organizationId" = site."organizationId"
FROM "Site" AS site
WHERE source_run."siteId" = site.id AND source_run."organizationId" IS NULL;

UPDATE "SyncRun" AS sync_run
SET "organizationId" = source."organizationId"
FROM (
  SELECT "syncRunId", MIN("organizationId") AS "organizationId"
  FROM "SourceRun"
  WHERE "organizationId" IS NOT NULL
  GROUP BY "syncRunId"
  HAVING COUNT(DISTINCT "organizationId") = 1
) AS source
WHERE sync_run.id = source."syncRunId" AND sync_run."organizationId" IS NULL;

UPDATE "WebmasterDailyMetric" AS metric
SET "organizationId" = site."organizationId"
FROM "Site" AS site
WHERE metric."siteId" = site.id AND metric."organizationId" IS NULL;

UPDATE "WebmasterQueryDailyMetric" AS metric
SET "organizationId" = site."organizationId"
FROM "Site" AS site
WHERE metric."siteId" = site.id AND metric."organizationId" IS NULL;

UPDATE "MetrikaDailyMetric" AS metric
SET "organizationId" = site."organizationId"
FROM "Site" AS site
WHERE metric."siteId" = site.id AND metric."organizationId" IS NULL;

UPDATE "LandingPageDailyMetric" AS metric
SET "organizationId" = site."organizationId"
FROM "Site" AS site
WHERE metric."siteId" = site.id AND metric."organizationId" IS NULL;

UPDATE "MetrikaDeviceDailyMetric" AS metric
SET "organizationId" = site."organizationId"
FROM "Site" AS site
WHERE metric."siteId" = site.id AND metric."organizationId" IS NULL;

UPDATE "MetrikaGoalDailyMetric" AS metric
SET "organizationId" = site."organizationId"
FROM "Site" AS site
WHERE metric."siteId" = site.id AND metric."organizationId" IS NULL;

UPDATE "RankingCapture" AS capture
SET "organizationId" = query."organizationId"
FROM "TrackedQuery" AS query
WHERE capture."trackedQueryId" = query.id AND capture."organizationId" IS NULL;

UPDATE "TechnicalSnapshot" AS snapshot
SET "organizationId" = site."organizationId"
FROM "Site" AS site
WHERE snapshot."siteId" = site.id AND snapshot."organizationId" IS NULL;

UPDATE "ReportSnapshot" AS snapshot
SET "organizationId" = site."organizationId"
FROM "Site" AS site
WHERE snapshot."siteId" = site.id AND snapshot."organizationId" IS NULL;

-- Query support for the dual-write/backfill validation phase.
CREATE INDEX "Site_organizationId_idx" ON "Site"("organizationId");
CREATE INDEX "ProviderConnection_organizationId_idx" ON "ProviderConnection"("organizationId");
CREATE INDEX "GoalDefinition_organizationId_idx" ON "GoalDefinition"("organizationId");
CREATE INDEX "GoalDefinitionSite_organizationId_idx" ON "GoalDefinitionSite"("organizationId");
CREATE INDEX "TrackedQuerySet_organizationId_idx" ON "TrackedQuerySet"("organizationId");
CREATE INDEX "TrackedQuery_organizationId_idx" ON "TrackedQuery"("organizationId");
CREATE INDEX "SyncRun_organizationId_idx" ON "SyncRun"("organizationId");
CREATE INDEX "SourceRun_organizationId_idx" ON "SourceRun"("organizationId");
CREATE INDEX "WebmasterDailyMetric_organizationId_idx" ON "WebmasterDailyMetric"("organizationId");
CREATE INDEX "WebmasterQueryDailyMetric_organizationId_idx" ON "WebmasterQueryDailyMetric"("organizationId");
CREATE INDEX "MetrikaDailyMetric_organizationId_idx" ON "MetrikaDailyMetric"("organizationId");
CREATE INDEX "LandingPageDailyMetric_organizationId_idx" ON "LandingPageDailyMetric"("organizationId");
CREATE INDEX "MetrikaDeviceDailyMetric_organizationId_idx" ON "MetrikaDeviceDailyMetric"("organizationId");
CREATE INDEX "MetrikaGoalDailyMetric_organizationId_idx" ON "MetrikaGoalDailyMetric"("organizationId");
CREATE INDEX "RankingCapture_organizationId_idx" ON "RankingCapture"("organizationId");
CREATE INDEX "TechnicalSnapshot_organizationId_idx" ON "TechnicalSnapshot"("organizationId");
CREATE INDEX "ReportSnapshot_organizationId_idx" ON "ReportSnapshot"("organizationId");
