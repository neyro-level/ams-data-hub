CREATE TYPE "ProjectServiceState" AS ENUM ('ACTIVE', 'SUSPENDED');

ALTER TABLE "Project"
  ADD COLUMN "serviceState" "ProjectServiceState" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "siteBaseUrl" TEXT,
  ADD COLUMN "publicUrlPolicyVersion" TEXT,
  ADD COLUMN "notes" TEXT;
