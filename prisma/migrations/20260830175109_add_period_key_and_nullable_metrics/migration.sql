ALTER TABLE "MetrikaDailyMetric"
  ALTER COLUMN "users" DROP NOT NULL,
  ALTER COLUMN "pageviews" DROP NOT NULL,
  ALTER COLUMN "bounceRate" DROP NOT NULL,
  ALTER COLUMN "pageDepth" DROP NOT NULL,
  ALTER COLUMN "averageVisitDurationSeconds" DROP NOT NULL,
  ALTER COLUMN "uniqueTargetUsers" DROP NOT NULL,
  ALTER COLUMN "allVisits" DROP NOT NULL;
ALTER TABLE "WebmasterQueryDailyMetric"
  ADD COLUMN "periodKey" "ReportPeriodKey" NOT NULL DEFAULT 'MONTH';
DROP INDEX IF EXISTS "WebmasterQueryDailyMetric_siteId_date_normalizedQuery_device_orderBy_key";
DROP INDEX IF EXISTS "WebmasterQueryDailyMetric_siteId_date_normalizedQuery_devic_key";
CREATE UNIQUE INDEX "WebmasterQueryDailyMetric_siteId_periodKey_date_norm_query_dev_ord_key"
  ON "WebmasterQueryDailyMetric"("siteId", "periodKey", "date", "normalizedQuery", "device", "orderBy");
CREATE INDEX "WebmasterQueryDailyMetric_siteId_periodKey_date_idx"
  ON "WebmasterQueryDailyMetric"("siteId", "periodKey", "date");
CREATE INDEX "WebmasterQueryDailyMetric_siteId_periodKey_normalizedQuery_date_idx"
  ON "WebmasterQueryDailyMetric"("siteId", "periodKey", "normalizedQuery", "date");

ALTER TABLE "LandingPageDailyMetric"
  ADD COLUMN "periodKey" "ReportPeriodKey" NOT NULL DEFAULT 'MONTH';
DROP INDEX IF EXISTS "LandingPageDailyMetric_siteId_date_path_key";
CREATE UNIQUE INDEX "LandingPageDailyMetric_siteId_periodKey_date_path_key"
  ON "LandingPageDailyMetric"("siteId", "periodKey", "date", "path");
CREATE INDEX "LandingPageDailyMetric_siteId_periodKey_date_idx"
  ON "LandingPageDailyMetric"("siteId", "periodKey", "date");

ALTER TABLE "MetrikaDeviceDailyMetric"
  ADD COLUMN "periodKey" "ReportPeriodKey" NOT NULL DEFAULT 'MONTH';
DROP INDEX IF EXISTS "MetrikaDeviceDailyMetric_siteId_date_device_key";
CREATE UNIQUE INDEX "MetrikaDeviceDailyMetric_siteId_periodKey_date_device_key"
  ON "MetrikaDeviceDailyMetric"("siteId", "periodKey", "date", "device");
CREATE INDEX "MetrikaDeviceDailyMetric_siteId_periodKey_date_idx"
  ON "MetrikaDeviceDailyMetric"("siteId", "periodKey", "date");

ALTER TABLE "MetrikaGoalDailyMetric"
  ADD COLUMN "periodKey" "ReportPeriodKey" NOT NULL DEFAULT 'MONTH';
DROP INDEX IF EXISTS "MetrikaGoalDailyMetric_siteId_date_externalGoalId_key";
CREATE UNIQUE INDEX "MetrikaGoalDailyMetric_siteId_periodKey_date_externalGoalId_key"
  ON "MetrikaGoalDailyMetric"("siteId", "periodKey", "date", "externalGoalId");
CREATE INDEX "MetrikaGoalDailyMetric_siteId_periodKey_date_idx"
  ON "MetrikaGoalDailyMetric"("siteId", "periodKey", "date");
