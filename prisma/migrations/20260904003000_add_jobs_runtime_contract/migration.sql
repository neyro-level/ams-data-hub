-- Workstream 6: sync/job correlation and outbox delivery contract.
CREATE TYPE "RetentionRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

ALTER TABLE "SyncRun"
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "projectSlug" TEXT,
  ADD COLUMN "sitesSucceeded" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sitesPartial" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sitesFailed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "correlationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000000';

UPDATE "SyncRun" AS sr
SET
  "projectId" = p."id",
  "projectSlug" = p."slug"
FROM "SourceRun" AS sor
JOIN "Site" AS s ON s."id" = sor."siteId"
JOIN "Project" AS p ON p."id" = s."projectId"
WHERE sor."syncRunId" = sr."id"
  AND sr."projectId" IS NULL;

ALTER TABLE "SyncRun"
  ALTER COLUMN "projectId" SET NOT NULL,
  ALTER COLUMN "projectSlug" SET NOT NULL;

ALTER TABLE "SourceRun"
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "correlationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000000';

UPDATE "SourceRun" AS sor
SET "projectId" = s."projectId"
FROM "Site" AS s
WHERE s."id" = sor."siteId"
  AND sor."projectId" IS NULL;

ALTER TABLE "SourceRun"
  ALTER COLUMN "projectId" SET NOT NULL;

ALTER TABLE "OutboxEvent"
  ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "SyncRun_projectId_startedAt_idx" ON "SyncRun"("projectId", "startedAt");
CREATE INDEX "SourceRun_projectId_provider_startedAt_idx" ON "SourceRun"("projectId", "provider", "startedAt");

CREATE TABLE "RetentionRun" (
  "id" TEXT NOT NULL,
  "status" "RetentionRunStatus" NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "deletedOutboxEvents" INTEGER NOT NULL DEFAULT 0,
  "deletedJobRuns" INTEGER NOT NULL DEFAULT 0,
  "safeErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RetentionRun_status_startedAt_idx" ON "RetentionRun"("status", "startedAt");
