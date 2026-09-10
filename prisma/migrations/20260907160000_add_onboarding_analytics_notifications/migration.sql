CREATE TYPE "SearchEngine" AS ENUM ('YANDEX', 'GOOGLE');
CREATE TYPE "SearchDevice" AS ENUM ('DESKTOP', 'MOBILE');
CREATE TYPE "IntegrationStatus" AS ENUM ('PENDING', 'CONNECTING', 'CONNECTED', 'ACTION_REQUIRED', 'FAILED');
CREATE TYPE "ProviderOperationStatus" AS ENUM ('PENDING', 'DISPATCHING', 'STARTED', 'COMPLETED', 'ACTION_REQUIRED', 'FAILED');
CREATE TYPE "NotificationCategory" AS ENUM ('ONBOARDING', 'INTEGRATION', 'REPORT', 'RANKING', 'COMPETITOR', 'DATA_FRESHNESS', 'QUEUE', 'ACCESS');
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');
CREATE TYPE "NotificationVisibility" AS ENUM ('PLATFORM_TEAM', 'PLATFORM_ADMIN_ONLY');

ALTER TABLE "ProviderConnection"
  ADD COLUMN "status" "IntegrationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "statusCode" TEXT,
  ADD COLUMN "lastCheckedAt" TIMESTAMPTZ(3),
  ADD COLUMN "connectedAt" TIMESTAMPTZ(3);

UPDATE "ProviderConnection"
SET "status" = 'CONNECTED', "connectedAt" = CURRENT_TIMESTAMP
WHERE "enabled" = true;

ALTER TABLE "WebmasterQueryDailyMetric"
  ADD COLUMN "demand" DECIMAL(12,4),
  ADD COLUMN "relevantUrl" TEXT,
  ADD COLUMN "regionKey" TEXT;

DROP INDEX "RankingCapture_trackedQueryId_capturedAt_source_key";
ALTER TABLE "RankingCapture"
  ADD COLUMN "engine" "SearchEngine" NOT NULL DEFAULT 'YANDEX',
  ADD COLUMN "device" "SearchDevice" NOT NULL DEFAULT 'DESKTOP',
  ADD COLUMN "regionKey" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "regionName" TEXT,
  ADD COLUMN "relevantUrl" TEXT;
CREATE UNIQUE INDEX "RankingCapture_query_time_source_target_key"
  ON "RankingCapture"("trackedQueryId", "capturedAt", "source", "engine", "device", "regionKey");

CREATE TABLE "SearchTarget" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "engine" "SearchEngine" NOT NULL,
  "device" "SearchDevice" NOT NULL,
  "regionKey" TEXT NOT NULL,
  "regionName" TEXT NOT NULL,
  "regionIndex" INTEGER,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchTarget_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SearchTarget_site_tenant_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SearchTarget_siteId_engine_device_regionKey_key" ON "SearchTarget"("siteId", "engine", "device", "regionKey");
CREATE UNIQUE INDEX "SearchTarget_organizationId_id_key" ON "SearchTarget"("organizationId", "id");
CREATE INDEX "SearchTarget_siteId_enabled_idx" ON "SearchTarget"("siteId", "enabled");

CREATE TABLE "ProviderOperation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "provider" "Provider" NOT NULL,
  "operation" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "status" "ProviderOperationStatus" NOT NULL DEFAULT 'PENDING',
  "externalId" TEXT,
  "price" DECIMAL(12,4),
  "currency" TEXT,
  "safeErrorCode" TEXT,
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderOperation_site_tenant_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProviderOperation_operationKey_key" ON "ProviderOperation"("operationKey");
CREATE UNIQUE INDEX "ProviderOperation_organizationId_id_key" ON "ProviderOperation"("organizationId", "id");
CREATE INDEX "ProviderOperation_siteId_provider_createdAt_idx" ON "ProviderOperation"("siteId", "provider", "createdAt");

CREATE TABLE "MetrikaSearchEngineDailyMetric" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "periodKey" "ReportPeriodKey" NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "engine" "SearchEngine" NOT NULL,
  "visits" INTEGER NOT NULL,
  "users" INTEGER NOT NULL,
  "goalReaches" INTEGER NOT NULL,
  "uniqueTargetVisits" INTEGER NOT NULL,
  "conversionRate" DECIMAL(8,4),
  "sourceRunId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetrikaSearchEngineDailyMetric_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MetrikaSearchEngine_site_tenant_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MetrikaSearchEngine_source_tenant_fkey" FOREIGN KEY ("organizationId", "sourceRunId") REFERENCES "SourceRun"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MetrikaSearchEngine_site_period_date_engine_key" ON "MetrikaSearchEngineDailyMetric"("siteId", "periodKey", "date", "engine");
CREATE INDEX "MetrikaSearchEngine_site_period_date_idx" ON "MetrikaSearchEngineDailyMetric"("siteId", "periodKey", "date");
CREATE INDEX "MetrikaSearchEngine_sourceRunId_idx" ON "MetrikaSearchEngineDailyMetric"("sourceRunId");

CREATE TABLE "MetrikaSearchPhraseDailyMetric" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "periodKey" "ReportPeriodKey" NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "engine" "SearchEngine" NOT NULL,
  "phrase" TEXT NOT NULL,
  "normalizedPhrase" TEXT NOT NULL,
  "visits" INTEGER NOT NULL,
  "users" INTEGER NOT NULL,
  "goalReaches" INTEGER NOT NULL,
  "uniqueTargetVisits" INTEGER NOT NULL,
  "sourceRunId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetrikaSearchPhraseDailyMetric_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MetrikaSearchPhrase_site_tenant_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MetrikaSearchPhrase_source_tenant_fkey" FOREIGN KEY ("organizationId", "sourceRunId") REFERENCES "SourceRun"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MetrikaSearchPhrase_site_period_date_engine_phrase_key" ON "MetrikaSearchPhraseDailyMetric"("siteId", "periodKey", "date", "engine", "normalizedPhrase");
CREATE INDEX "MetrikaSearchPhrase_site_period_date_idx" ON "MetrikaSearchPhraseDailyMetric"("siteId", "periodKey", "date");
CREATE INDEX "MetrikaSearchPhrase_sourceRunId_idx" ON "MetrikaSearchPhraseDailyMetric"("sourceRunId");

CREATE TABLE "MetrikaGeoDailyMetric" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "periodKey" "ReportPeriodKey" NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "regionKey" TEXT NOT NULL,
  "regionName" TEXT NOT NULL,
  "visits" INTEGER NOT NULL,
  "users" INTEGER NOT NULL,
  "goalReaches" INTEGER NOT NULL,
  "uniqueTargetVisits" INTEGER NOT NULL,
  "sourceRunId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetrikaGeoDailyMetric_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MetrikaGeo_site_tenant_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MetrikaGeo_source_tenant_fkey" FOREIGN KEY ("organizationId", "sourceRunId") REFERENCES "SourceRun"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MetrikaGeo_site_period_date_region_key" ON "MetrikaGeoDailyMetric"("siteId", "periodKey", "date", "regionKey");
CREATE INDEX "MetrikaGeo_site_period_date_idx" ON "MetrikaGeoDailyMetric"("siteId", "periodKey", "date");
CREATE INDEX "MetrikaGeo_sourceRunId_idx" ON "MetrikaGeoDailyMetric"("sourceRunId");

CREATE TABLE "CompetitorSnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "capturedAt" TIMESTAMPTZ(3) NOT NULL,
  "engine" "SearchEngine" NOT NULL,
  "device" "SearchDevice" NOT NULL,
  "regionKey" TEXT NOT NULL,
  "regionName" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "visibility" DECIMAL(10,4),
  "averagePosition" DECIMAL(8,4),
  "top3" INTEGER NOT NULL DEFAULT 0,
  "top10" INTEGER NOT NULL DEFAULT 0,
  "top30" INTEGER NOT NULL DEFAULT 0,
  "top50" INTEGER NOT NULL DEFAULT 0,
  "top100" INTEGER NOT NULL DEFAULT 0,
  "queryCount" INTEGER NOT NULL,
  "sourceRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompetitorSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompetitorSnapshot_site_tenant_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CompetitorSnapshot_source_tenant_fkey" FOREIGN KEY ("organizationId", "sourceRunId") REFERENCES "SourceRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CompetitorSnapshot_site_time_target_domain_key" ON "CompetitorSnapshot"("siteId", "capturedAt", "engine", "device", "regionKey", "domain");
CREATE INDEX "CompetitorSnapshot_site_engine_device_time_idx" ON "CompetitorSnapshot"("siteId", "engine", "device", "capturedAt");
CREATE INDEX "CompetitorSnapshot_sourceRunId_idx" ON "CompetitorSnapshot"("sourceRunId");

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "projectId" TEXT,
  "siteId" TEXT,
  "category" "NotificationCategory" NOT NULL,
  "severity" "NotificationSeverity" NOT NULL,
  "visibility" "NotificationVisibility" NOT NULL DEFAULT 'PLATFORM_TEAM',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "route" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "dedupKey" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_scope_check" CHECK (("projectId" IS NULL AND "siteId" IS NULL) OR "organizationId" IS NOT NULL),
  CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Notification_project_tenant_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Notification_site_tenant_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Notification_dedupKey_key" ON "Notification"("dedupKey");
CREATE INDEX "Notification_visibility_occurredAt_idx" ON "Notification"("visibility", "occurredAt");
CREATE INDEX "Notification_organizationId_occurredAt_idx" ON "Notification"("organizationId", "occurredAt");
CREATE INDEX "Notification_projectId_occurredAt_idx" ON "Notification"("projectId", "occurredAt");
CREATE INDEX "Notification_siteId_occurredAt_idx" ON "Notification"("siteId", "occurredAt");

CREATE TABLE "NotificationRead" (
  "notificationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "readAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("notificationId", "userId"),
  CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "NotificationRead_userId_readAt_idx" ON "NotificationRead"("userId", "readAt");

ALTER TABLE "SearchTarget" ADD CONSTRAINT "SearchTarget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderOperation" ADD CONSTRAINT "ProviderOperation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetrikaSearchEngineDailyMetric" ADD CONSTRAINT "MetrikaSearchEngineDailyMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetrikaSearchPhraseDailyMetric" ADD CONSTRAINT "MetrikaSearchPhraseDailyMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetrikaGeoDailyMetric" ADD CONSTRAINT "MetrikaGeoDailyMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompetitorSnapshot" ADD CONSTRAINT "CompetitorSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
