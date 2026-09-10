-- Contract: make the completed ownership backfill load-bearing.
-- This migration refuses to run if a production dataset contains unknown or cross-tenant rows.
DO $validation$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Site" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "Site" AS child JOIN "Project" AS parent ON parent.id = child."projectId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "ProviderConnection" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "ProviderConnection" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "GoalDefinition" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "GoalDefinition" AS child JOIN "Project" AS parent ON parent.id = child."projectId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "GoalDefinitionSite" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "GoalDefinitionSite" AS child JOIN "GoalDefinition" AS parent ON parent.id = child."goalDefinitionId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "GoalDefinitionSite" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "TrackedQuerySet" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "TrackedQuerySet" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "TrackedQuery" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "TrackedQuery" AS child JOIN "TrackedQuerySet" AS parent ON parent.id = child."trackedQuerySetId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "SyncRun" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "SourceRun" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "SourceRun" AS child JOIN "SyncRun" AS parent ON parent.id = child."syncRunId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "SourceRun" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "WebmasterDailyMetric" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "WebmasterDailyMetric" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "WebmasterDailyMetric" AS child JOIN "SourceRun" AS parent ON parent.id = child."sourceRunId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "WebmasterQueryDailyMetric" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "WebmasterQueryDailyMetric" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "WebmasterQueryDailyMetric" AS child JOIN "SourceRun" AS parent ON parent.id = child."sourceRunId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "MetrikaDailyMetric" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "MetrikaDailyMetric" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "MetrikaDailyMetric" AS child JOIN "SourceRun" AS parent ON parent.id = child."sourceRunId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "LandingPageDailyMetric" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "LandingPageDailyMetric" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "LandingPageDailyMetric" AS child JOIN "SourceRun" AS parent ON parent.id = child."sourceRunId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "MetrikaDeviceDailyMetric" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "MetrikaDeviceDailyMetric" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "MetrikaDeviceDailyMetric" AS child JOIN "SourceRun" AS parent ON parent.id = child."sourceRunId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "MetrikaGoalDailyMetric" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "MetrikaGoalDailyMetric" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "MetrikaGoalDailyMetric" AS child JOIN "SourceRun" AS parent ON parent.id = child."sourceRunId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "RankingCapture" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "RankingCapture" AS child JOIN "TrackedQuery" AS parent ON parent.id = child."trackedQueryId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "RankingCapture" AS child JOIN "SourceRun" AS parent ON parent.id = child."sourceRunId" WHERE child."sourceRunId" IS NOT NULL AND child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "TechnicalSnapshot" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "TechnicalSnapshot" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "TechnicalSnapshot" AS child JOIN "SourceRun" AS parent ON parent.id = child."sourceRunId" WHERE child."organizationId" <> parent."organizationId"
    UNION ALL SELECT 1 FROM "ReportSnapshot" WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM "ReportSnapshot" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"
  ) THEN
    RAISE EXCEPTION 'Tenant ownership is incomplete or inconsistent. Run verify:tenant-ownership and resolve every count before applying this migration.';
  END IF;
END
$validation$;

ALTER TABLE "Site" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ProviderConnection" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "GoalDefinition" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "GoalDefinitionSite" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "TrackedQuerySet" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "TrackedQuery" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "SyncRun" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "SourceRun" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "WebmasterDailyMetric" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "WebmasterQueryDailyMetric" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "MetrikaDailyMetric" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "LandingPageDailyMetric" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "MetrikaDeviceDailyMetric" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "MetrikaGoalDailyMetric" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "RankingCapture" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "TechnicalSnapshot" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ReportSnapshot" ALTER COLUMN "organizationId" SET NOT NULL;

-- PostgreSQL requires an exact unique key on every composite FK target.
CREATE UNIQUE INDEX "Project_organizationId_id_key" ON "Project"("organizationId", "id");
CREATE UNIQUE INDEX "Site_organizationId_id_key" ON "Site"("organizationId", "id");
CREATE UNIQUE INDEX "GoalDefinition_organizationId_id_key" ON "GoalDefinition"("organizationId", "id");
CREATE UNIQUE INDEX "TrackedQuerySet_organizationId_id_key" ON "TrackedQuerySet"("organizationId", "id");
CREATE UNIQUE INDEX "TrackedQuery_organizationId_id_key" ON "TrackedQuery"("organizationId", "id");
CREATE UNIQUE INDEX "SyncRun_organizationId_id_key" ON "SyncRun"("organizationId", "id");
CREATE UNIQUE INDEX "SourceRun_organizationId_id_key" ON "SourceRun"("organizationId", "id");

ALTER TABLE "Site" ADD CONSTRAINT "Site_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoalDefinition" ADD CONSTRAINT "GoalDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoalDefinitionSite" ADD CONSTRAINT "GoalDefinitionSite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrackedQuerySet" ADD CONSTRAINT "TrackedQuerySet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrackedQuery" ADD CONSTRAINT "TrackedQuery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceRun" ADD CONSTRAINT "SourceRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebmasterDailyMetric" ADD CONSTRAINT "WebmasterDailyMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebmasterQueryDailyMetric" ADD CONSTRAINT "WebmasterQueryDailyMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetrikaDailyMetric" ADD CONSTRAINT "MetrikaDailyMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LandingPageDailyMetric" ADD CONSTRAINT "LandingPageDailyMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetrikaDeviceDailyMetric" ADD CONSTRAINT "MetrikaDeviceDailyMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetrikaGoalDailyMetric" ADD CONSTRAINT "MetrikaGoalDailyMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RankingCapture" ADD CONSTRAINT "RankingCapture_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TechnicalSnapshot" ADD CONSTRAINT "TechnicalSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Site" ADD CONSTRAINT "Site_org_project_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_org_site_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoalDefinition" ADD CONSTRAINT "GoalDefinition_org_project_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoalDefinitionSite" ADD CONSTRAINT "GoalDefinitionSite_org_goal_fkey" FOREIGN KEY ("organizationId", "goalDefinitionId") REFERENCES "GoalDefinition"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoalDefinitionSite" ADD CONSTRAINT "GoalDefinitionSite_org_site_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrackedQuerySet" ADD CONSTRAINT "TrackedQuerySet_org_site_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrackedQuery" ADD CONSTRAINT "TrackedQuery_org_set_fkey" FOREIGN KEY ("organizationId", "trackedQuerySetId") REFERENCES "TrackedQuerySet"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceRun" ADD CONSTRAINT "SourceRun_org_sync_fkey" FOREIGN KEY ("organizationId", "syncRunId") REFERENCES "SyncRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceRun" ADD CONSTRAINT "SourceRun_org_site_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebmasterDailyMetric" ADD CONSTRAINT "WebmasterDailyMetric_org_site_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebmasterDailyMetric" ADD CONSTRAINT "WebmasterDailyMetric_org_source_fkey" FOREIGN KEY ("organizationId", "sourceRunId") REFERENCES "SourceRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebmasterQueryDailyMetric" ADD CONSTRAINT "WebmasterQueryDailyMetric_org_site_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebmasterQueryDailyMetric" ADD CONSTRAINT "WebmasterQueryDailyMetric_org_source_fkey" FOREIGN KEY ("organizationId", "sourceRunId") REFERENCES "SourceRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetrikaDailyMetric" ADD CONSTRAINT "MetrikaDailyMetric_org_site_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetrikaDailyMetric" ADD CONSTRAINT "MetrikaDailyMetric_org_source_fkey" FOREIGN KEY ("organizationId", "sourceRunId") REFERENCES "SourceRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LandingPageDailyMetric" ADD CONSTRAINT "LandingPageDailyMetric_org_site_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LandingPageDailyMetric" ADD CONSTRAINT "LandingPageDailyMetric_org_source_fkey" FOREIGN KEY ("organizationId", "sourceRunId") REFERENCES "SourceRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetrikaDeviceDailyMetric" ADD CONSTRAINT "MetrikaDeviceDailyMetric_org_site_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetrikaDeviceDailyMetric" ADD CONSTRAINT "MetrikaDeviceDailyMetric_org_source_fkey" FOREIGN KEY ("organizationId", "sourceRunId") REFERENCES "SourceRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetrikaGoalDailyMetric" ADD CONSTRAINT "MetrikaGoalDailyMetric_org_site_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetrikaGoalDailyMetric" ADD CONSTRAINT "MetrikaGoalDailyMetric_org_source_fkey" FOREIGN KEY ("organizationId", "sourceRunId") REFERENCES "SourceRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RankingCapture" ADD CONSTRAINT "RankingCapture_org_query_fkey" FOREIGN KEY ("organizationId", "trackedQueryId") REFERENCES "TrackedQuery"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RankingCapture" ADD CONSTRAINT "RankingCapture_org_source_fkey" FOREIGN KEY ("organizationId", "sourceRunId") REFERENCES "SourceRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TechnicalSnapshot" ADD CONSTRAINT "TechnicalSnapshot_org_site_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TechnicalSnapshot" ADD CONSTRAINT "TechnicalSnapshot_org_source_fkey" FOREIGN KEY ("organizationId", "sourceRunId") REFERENCES "SourceRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_org_site_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
