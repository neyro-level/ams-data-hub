-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- DropIndex
DROP INDEX "LandingPageDailyMetric_siteId_date_idx";

-- DropIndex
DROP INDEX "MetrikaDeviceDailyMetric_siteId_date_idx";

-- DropIndex
DROP INDEX "MetrikaGoalDailyMetric_siteId_date_idx";

-- DropIndex
DROP INDEX "WebmasterQueryDailyMetric_siteId_date_idx";

-- DropIndex
DROP INDEX "WebmasterQueryDailyMetric_siteId_normalizedQuery_date_idx";

-- AlterTable
ALTER TABLE "LandingPageDailyMetric" ALTER COLUMN "periodKey" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MetrikaDeviceDailyMetric" ALTER COLUMN "periodKey" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MetrikaGoalDailyMetric" ALTER COLUMN "periodKey" DROP DEFAULT;

-- AlterTable
ALTER TABLE "WebmasterQueryDailyMetric" ALTER COLUMN "periodKey" DROP DEFAULT;

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeMarker" JSONB,
    "afterMarker" JSONB,
    "source" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "organizationScope" TEXT NOT NULL,
    "organizationId" TEXT,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL,
    "response" JSONB,
    "errorCode" TEXT,
    "outboxEventId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastErrorCode" TEXT,
    "correlationId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "outboxEventId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL,
    "attempt" INTEGER NOT NULL,
    "workerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "safeErrorCode" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_createdAt_idx" ON "AuditEvent"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_outboxEventId_key" ON "IdempotencyKey"("outboxEventId");

-- CreateIndex
CREATE INDEX "IdempotencyKey_status_expiresAt_idx" ON "IdempotencyKey"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_organizationId_createdAt_idx" ON "IdempotencyKey"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_scope_organizationScope_key_key" ON "IdempotencyKey"("scope", "organizationScope", "key");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_lockedAt_idx" ON "OutboxEvent"("lockedAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_organizationId_topic_createdAt_idx" ON "OutboxEvent"("organizationId", "topic", "createdAt");

-- CreateIndex
CREATE INDEX "JobRun_status_startedAt_idx" ON "JobRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_organizationId_jobType_startedAt_idx" ON "JobRun"("organizationId", "jobType", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_outboxEventId_attempt_key" ON "JobRun"("outboxEventId", "attempt");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "OutboxEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "OutboxEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "WebmasterQueryDailyMetric_siteId_periodKey_date_norm_query_dev_" RENAME TO "WebmasterQueryDailyMetric_siteId_periodKey_date_normalizedQ_key";

-- RenameIndex
ALTER INDEX "WebmasterQueryDailyMetric_siteId_periodKey_normalizedQuery_date" RENAME TO "WebmasterQueryDailyMetric_siteId_periodKey_normalizedQuery__idx";
