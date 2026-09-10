-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('SEO_ANALYST', 'CLIENT_VIEWER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'PLANNED', 'DISABLED');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('YANDEX_WEBMASTER', 'YANDEX_METRIKA', 'TOPVISOR');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED', 'NOT_CONFIGURED', 'ACCESS_DENIED', 'QUOTA_LIMITED', 'STALE');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('DAILY', 'MANUAL', 'PREFLIGHT', 'BACKFILL');

-- CreateEnum
CREATE TYPE "GoalCategory" AS ENUM ('LEAD_SUBMIT', 'PHONE_CLICK', 'MESSENGER_CLICK', 'FORM_START', 'FILE_DOWNLOAD', 'OTHER');

-- CreateEnum
CREATE TYPE "GoalDirection" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "ReportFreshness" AS ENUM ('FRESH', 'STALE', 'PARTIAL', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "ReportPeriodKey" AS ENUM ('WEEK', 'MONTH', 'QUARTER', 'HALF_YEAR');

-- CreateEnum
CREATE TYPE "RankingSource" AS ENUM ('OWNER_PROVIDED', 'TOPVISOR');

-- CreateEnum
CREATE TYPE "WebmasterQueryOrderBy" AS ENUM ('TOTAL_SHOWS', 'TOTAL_CLICKS');

-- CreateEnum
CREATE TYPE "WebmasterDevice" AS ENUM ('ALL', 'DESKTOP', 'MOBILE', 'TABLET', 'MOBILE_AND_TABLET');

-- CreateEnum
CREATE TYPE "TechnicalSnapshotKind" AS ENUM ('WEBMASTER_DIAGNOSTICS', 'WEBMASTER_SITEMAPS', 'WEBMASTER_INDEXING_HISTORY', 'WEBMASTER_SEARCH_EVENTS_HISTORY', 'WEBMASTER_BROKEN_INTERNAL_LINKS_HISTORY', 'WEBMASTER_EXTERNAL_LINKS_HISTORY', 'WEBMASTER_PAGES_IN_SEARCH_HISTORY', 'WEBMASTER_SQI_HISTORY', 'METRICA_ALL_TRAFFIC_META', 'METRICA_YANDEX_ORGANIC_META', 'METRICA_GOALS_SUMMARY_META');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "systemRole" "SystemRole" NOT NULL DEFAULT 'CLIENT_VIEWER',
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "activeOrganizationId" TEXT,
    "activeTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "idToken" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThresholdProfile" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "minimumShows" INTEGER NOT NULL,
    "maximumCtrPercent" DECIMAL(6,2) NOT NULL,
    "maximumAveragePosition" DECIMAL(6,2) NOT NULL,
    "showsDropPercent" DECIMAL(6,2) NOT NULL,
    "clicksDropPercent" DECIMAL(6,2) NOT NULL,
    "positionWorsenedDelta" DECIMAL(6,2) NOT NULL,
    "pagesInSearchDropPercent" DECIMAL(6,2) NOT NULL,
    "organicVisitsDropPercent" DECIMAL(6,2) NOT NULL,
    "goalConversionDropPercent" DECIMAL(6,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThresholdProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryClusterProfile" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueryClusterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryClusterGroup" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "brandTermsJson" JSONB NOT NULL,
    "termsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueryClusterGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL,
    "thresholdProfileId" TEXT NOT NULL,
    "clusterProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "externalId" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "settingsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalDefinition" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "externalGoalId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "GoalCategory" NOT NULL,
    "direction" "GoalDirection" NOT NULL,
    "includeInSeoConversion" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalDefinitionSite" (
    "goalDefinitionId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,

    CONSTRAINT "GoalDefinitionSite_pkey" PRIMARY KEY ("goalDefinitionId","siteId")
);

-- CreateTable
CREATE TABLE "TrackedQuerySet" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "source" "RankingSource" NOT NULL,
    "baselineLabel" TEXT NOT NULL,
    "expectedCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedQuerySet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedQuery" (
    "id" TEXT NOT NULL,
    "trackedQuerySetId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "baselineCurrentPosition" INTEGER,
    "baselinePreviousPosition" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "status" "SyncRunStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "sitesProcessed" INTEGER NOT NULL DEFAULT 0,
    "safeError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRun" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "status" "SourceStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "rowsReceived" INTEGER,
    "safeErrorCode" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebmasterDailyMetric" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "shows" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "ctr" DECIMAL(8,4),
    "averagePosition" DECIMAL(8,4),
    "sourceRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebmasterDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebmasterQueryDailyMetric" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "queryId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "orderBy" "WebmasterQueryOrderBy" NOT NULL,
    "device" "WebmasterDevice" NOT NULL,
    "shows" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "ctr" DECIMAL(8,4),
    "averagePosition" DECIMAL(8,4),
    "averageClickPosition" DECIMAL(8,4),
    "sourceRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebmasterQueryDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetrikaDailyMetric" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "visits" INTEGER NOT NULL,
    "users" INTEGER NOT NULL,
    "pageviews" INTEGER NOT NULL,
    "bounceRate" DECIMAL(8,4) NOT NULL,
    "pageDepth" DECIMAL(8,4) NOT NULL,
    "averageVisitDurationSeconds" INTEGER NOT NULL,
    "goalReaches" INTEGER NOT NULL,
    "uniqueTargetVisits" INTEGER NOT NULL,
    "uniqueTargetUsers" INTEGER NOT NULL,
    "allVisits" INTEGER NOT NULL,
    "conversionRate" DECIMAL(8,4),
    "sourceRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetrikaDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingPageDailyMetric" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "path" TEXT NOT NULL,
    "visits" INTEGER NOT NULL,
    "users" INTEGER NOT NULL,
    "pageviews" INTEGER NOT NULL,
    "bounceRate" DECIMAL(8,4) NOT NULL,
    "pageDepth" DECIMAL(8,4) NOT NULL,
    "averageVisitDurationSeconds" INTEGER NOT NULL,
    "goalReaches" INTEGER NOT NULL,
    "targetVisits" INTEGER NOT NULL,
    "conversionRate" DECIMAL(8,4),
    "sourceRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandingPageDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetrikaDeviceDailyMetric" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "device" TEXT NOT NULL,
    "visits" INTEGER NOT NULL,
    "users" INTEGER NOT NULL,
    "goalReaches" INTEGER NOT NULL,
    "conversionRate" DECIMAL(8,4),
    "sourceRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetrikaDeviceDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetrikaGoalDailyMetric" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "externalGoalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "GoalCategory" NOT NULL,
    "direction" "GoalDirection" NOT NULL,
    "reaches" INTEGER NOT NULL,
    "visits" INTEGER NOT NULL,
    "users" INTEGER NOT NULL,
    "conversionRate" DECIMAL(8,4),
    "sourceRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetrikaGoalDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingCapture" (
    "id" TEXT NOT NULL,
    "trackedQueryId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "position" INTEGER,
    "source" "RankingSource" NOT NULL,
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankingCapture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalSnapshot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "kind" "TechnicalSnapshotKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicalSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "periodKey" "ReportPeriodKey" NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "freshness" "ReportFreshness" NOT NULL,
    "payload" JSONB NOT NULL,
    "sourceRunSetJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_activeOrganizationId_idx" ON "Session"("activeOrganizationId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_issuer_accountId_key" ON "Account"("issuer", "accountId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Member_userId_idx" ON "Member"("userId");

-- CreateIndex
CREATE INDEX "Member_organizationId_idx" ON "Member"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_organizationId_userId_key" ON "Member"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Invitation_inviterId_idx" ON "Invitation"("inviterId");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_idx" ON "Invitation"("organizationId");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ThresholdProfile_slug_key" ON "ThresholdProfile"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "QueryClusterProfile_slug_key" ON "QueryClusterProfile"("slug");

-- CreateIndex
CREATE INDEX "QueryClusterGroup_profileId_order_idx" ON "QueryClusterGroup"("profileId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "QueryClusterGroup_profileId_slug_key" ON "QueryClusterGroup"("profileId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE INDEX "Project_organizationId_idx" ON "Project"("organizationId");

-- CreateIndex
CREATE INDEX "Project_thresholdProfileId_idx" ON "Project"("thresholdProfileId");

-- CreateIndex
CREATE INDEX "Project_clusterProfileId_idx" ON "Project"("clusterProfileId");

-- CreateIndex
CREATE INDEX "Site_projectId_idx" ON "Site"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_projectId_slug_key" ON "Site"("projectId", "slug");

-- CreateIndex
CREATE INDEX "ProviderConnection_siteId_idx" ON "ProviderConnection"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_siteId_provider_key" ON "ProviderConnection"("siteId", "provider");

-- CreateIndex
CREATE INDEX "GoalDefinition_projectId_idx" ON "GoalDefinition"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "GoalDefinition_projectId_externalGoalId_key" ON "GoalDefinition"("projectId", "externalGoalId");

-- CreateIndex
CREATE INDEX "GoalDefinitionSite_siteId_idx" ON "GoalDefinitionSite"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedQuerySet_siteId_key" ON "TrackedQuerySet"("siteId");

-- CreateIndex
CREATE INDEX "TrackedQuery_trackedQuerySetId_idx" ON "TrackedQuery"("trackedQuerySetId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedQuery_trackedQuerySetId_normalizedQuery_key" ON "TrackedQuery"("trackedQuerySetId", "normalizedQuery");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- CreateIndex
CREATE INDEX "SourceRun_siteId_provider_startedAt_idx" ON "SourceRun"("siteId", "provider", "startedAt");

-- CreateIndex
CREATE INDEX "SourceRun_syncRunId_idx" ON "SourceRun"("syncRunId");

-- CreateIndex
CREATE INDEX "WebmasterDailyMetric_siteId_date_idx" ON "WebmasterDailyMetric"("siteId", "date");

-- CreateIndex
CREATE INDEX "WebmasterDailyMetric_sourceRunId_idx" ON "WebmasterDailyMetric"("sourceRunId");

-- CreateIndex
CREATE UNIQUE INDEX "WebmasterDailyMetric_siteId_date_key" ON "WebmasterDailyMetric"("siteId", "date");

-- CreateIndex
CREATE INDEX "WebmasterQueryDailyMetric_siteId_date_idx" ON "WebmasterQueryDailyMetric"("siteId", "date");

-- CreateIndex
CREATE INDEX "WebmasterQueryDailyMetric_siteId_normalizedQuery_date_idx" ON "WebmasterQueryDailyMetric"("siteId", "normalizedQuery", "date");

-- CreateIndex
CREATE INDEX "WebmasterQueryDailyMetric_sourceRunId_idx" ON "WebmasterQueryDailyMetric"("sourceRunId");

-- CreateIndex
CREATE UNIQUE INDEX "WebmasterQueryDailyMetric_siteId_date_normalizedQuery_devic_key" ON "WebmasterQueryDailyMetric"("siteId", "date", "normalizedQuery", "device", "orderBy");

-- CreateIndex
CREATE INDEX "MetrikaDailyMetric_siteId_date_idx" ON "MetrikaDailyMetric"("siteId", "date");

-- CreateIndex
CREATE INDEX "MetrikaDailyMetric_sourceRunId_idx" ON "MetrikaDailyMetric"("sourceRunId");

-- CreateIndex
CREATE UNIQUE INDEX "MetrikaDailyMetric_siteId_date_key" ON "MetrikaDailyMetric"("siteId", "date");

-- CreateIndex
CREATE INDEX "LandingPageDailyMetric_siteId_date_idx" ON "LandingPageDailyMetric"("siteId", "date");

-- CreateIndex
CREATE INDEX "LandingPageDailyMetric_sourceRunId_idx" ON "LandingPageDailyMetric"("sourceRunId");

-- CreateIndex
CREATE UNIQUE INDEX "LandingPageDailyMetric_siteId_date_path_key" ON "LandingPageDailyMetric"("siteId", "date", "path");

-- CreateIndex
CREATE INDEX "MetrikaDeviceDailyMetric_siteId_date_idx" ON "MetrikaDeviceDailyMetric"("siteId", "date");

-- CreateIndex
CREATE INDEX "MetrikaDeviceDailyMetric_sourceRunId_idx" ON "MetrikaDeviceDailyMetric"("sourceRunId");

-- CreateIndex
CREATE UNIQUE INDEX "MetrikaDeviceDailyMetric_siteId_date_device_key" ON "MetrikaDeviceDailyMetric"("siteId", "date", "device");

-- CreateIndex
CREATE INDEX "MetrikaGoalDailyMetric_siteId_date_idx" ON "MetrikaGoalDailyMetric"("siteId", "date");

-- CreateIndex
CREATE INDEX "MetrikaGoalDailyMetric_sourceRunId_idx" ON "MetrikaGoalDailyMetric"("sourceRunId");

-- CreateIndex
CREATE UNIQUE INDEX "MetrikaGoalDailyMetric_siteId_date_externalGoalId_key" ON "MetrikaGoalDailyMetric"("siteId", "date", "externalGoalId");

-- CreateIndex
CREATE INDEX "RankingCapture_trackedQueryId_capturedAt_idx" ON "RankingCapture"("trackedQueryId", "capturedAt");

-- CreateIndex
CREATE INDEX "RankingCapture_sourceRunId_idx" ON "RankingCapture"("sourceRunId");

-- CreateIndex
CREATE UNIQUE INDEX "RankingCapture_trackedQueryId_capturedAt_source_key" ON "RankingCapture"("trackedQueryId", "capturedAt", "source");

-- CreateIndex
CREATE INDEX "TechnicalSnapshot_siteId_capturedAt_idx" ON "TechnicalSnapshot"("siteId", "capturedAt");

-- CreateIndex
CREATE INDEX "TechnicalSnapshot_sourceRunId_idx" ON "TechnicalSnapshot"("sourceRunId");

-- CreateIndex
CREATE INDEX "TechnicalSnapshot_kind_idx" ON "TechnicalSnapshot"("kind");

-- CreateIndex
CREATE INDEX "ReportSnapshot_siteId_periodKey_generatedAt_idx" ON "ReportSnapshot"("siteId", "periodKey", "generatedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryClusterGroup" ADD CONSTRAINT "QueryClusterGroup_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "QueryClusterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_thresholdProfileId_fkey" FOREIGN KEY ("thresholdProfileId") REFERENCES "ThresholdProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clusterProfileId_fkey" FOREIGN KEY ("clusterProfileId") REFERENCES "QueryClusterProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalDefinition" ADD CONSTRAINT "GoalDefinition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalDefinitionSite" ADD CONSTRAINT "GoalDefinitionSite_goalDefinitionId_fkey" FOREIGN KEY ("goalDefinitionId") REFERENCES "GoalDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalDefinitionSite" ADD CONSTRAINT "GoalDefinitionSite_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedQuerySet" ADD CONSTRAINT "TrackedQuerySet_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedQuery" ADD CONSTRAINT "TrackedQuery_trackedQuerySetId_fkey" FOREIGN KEY ("trackedQuerySetId") REFERENCES "TrackedQuerySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRun" ADD CONSTRAINT "SourceRun_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRun" ADD CONSTRAINT "SourceRun_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebmasterDailyMetric" ADD CONSTRAINT "WebmasterDailyMetric_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebmasterDailyMetric" ADD CONSTRAINT "WebmasterDailyMetric_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "SourceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebmasterQueryDailyMetric" ADD CONSTRAINT "WebmasterQueryDailyMetric_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebmasterQueryDailyMetric" ADD CONSTRAINT "WebmasterQueryDailyMetric_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "SourceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetrikaDailyMetric" ADD CONSTRAINT "MetrikaDailyMetric_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetrikaDailyMetric" ADD CONSTRAINT "MetrikaDailyMetric_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "SourceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingPageDailyMetric" ADD CONSTRAINT "LandingPageDailyMetric_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingPageDailyMetric" ADD CONSTRAINT "LandingPageDailyMetric_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "SourceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetrikaDeviceDailyMetric" ADD CONSTRAINT "MetrikaDeviceDailyMetric_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetrikaDeviceDailyMetric" ADD CONSTRAINT "MetrikaDeviceDailyMetric_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "SourceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetrikaGoalDailyMetric" ADD CONSTRAINT "MetrikaGoalDailyMetric_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetrikaGoalDailyMetric" ADD CONSTRAINT "MetrikaGoalDailyMetric_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "SourceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingCapture" ADD CONSTRAINT "RankingCapture_trackedQueryId_fkey" FOREIGN KEY ("trackedQueryId") REFERENCES "TrackedQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingCapture" ADD CONSTRAINT "RankingCapture_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "SourceRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalSnapshot" ADD CONSTRAINT "TechnicalSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalSnapshot" ADD CONSTRAINT "TechnicalSnapshot_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "SourceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
