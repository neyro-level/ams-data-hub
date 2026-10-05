CREATE TYPE "ListingDevelopmentLinkStatus" AS ENUM ('CANDIDATE', 'CONFIRMED', 'REJECTED');

CREATE TABLE "ListingDevelopmentLink" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "inventoryUid" VARCHAR(26) NOT NULL,
  "developmentUid" VARCHAR(26),
  "candidateReason" VARCHAR(500) NOT NULL,
  "candidateConfidence" DECIMAL(5,4),
  "status" "ListingDevelopmentLinkStatus" NOT NULL DEFAULT 'CANDIDATE',
  "confirmedBy" TEXT,
  "confirmedAt" TIMESTAMPTZ(3),
  "sourceRevisionId" VARCHAR(128),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ListingDevelopmentLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ListingDevelopmentLink_confidence_check" CHECK ("candidateConfidence" IS NULL OR ("candidateConfidence" >= 0 AND "candidateConfidence" <= 1)),
  CONSTRAINT "ListingDevelopmentLink_decision_check" CHECK (
    ("status" = 'CANDIDATE' AND "confirmedBy" IS NULL AND "confirmedAt" IS NULL)
    OR ("status" IN ('CONFIRMED', 'REJECTED') AND "confirmedBy" IS NOT NULL AND "confirmedAt" IS NOT NULL)
  ),
  CONSTRAINT "ListingDevelopmentLink_confirmed_target_check" CHECK ("status" <> 'CONFIRMED' OR "developmentUid" IS NOT NULL)
);

CREATE UNIQUE INDEX "ListingDevelopmentLink_inventory_key" ON "ListingDevelopmentLink"("organizationId", "projectId", "inventoryUid");
CREATE INDEX "ListingDevelopmentLink_projectId_status_idx" ON "ListingDevelopmentLink"("projectId", "status");
CREATE INDEX "ListingDevelopmentLink_developmentUid_idx" ON "ListingDevelopmentLink"("developmentUid");

ALTER TABLE "ListingDevelopmentLink" ADD CONSTRAINT "ListingDevelopmentLink_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingDevelopmentLink" ADD CONSTRAINT "ListingDevelopmentLink_development_fkey"
  FOREIGN KEY ("developmentUid") REFERENCES "Development"("uid")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ListingDevelopmentLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ListingDevelopmentLink" FORCE ROW LEVEL SECURITY;

CREATE POLICY "ListingDevelopmentLink_rls" ON "ListingDevelopmentLink"
  FOR SELECT TO PUBLIC USING (
    current_setting('app.principal_kind', true) = 'platform-admin'
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
    )
  );
CREATE POLICY "ListingDevelopmentLink_job_insert" ON "ListingDevelopmentLink"
  FOR INSERT TO PUBLIC WITH CHECK (
    current_setting('app.principal_kind', true) = 'project-job'
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))
    AND "status" = 'CANDIDATE'
    AND "confirmedBy" IS NULL
    AND "confirmedAt" IS NULL
  );
CREATE POLICY "ListingDevelopmentLink_admin_update" ON "ListingDevelopmentLink"
  FOR UPDATE TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin')
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

GRANT SELECT, UPDATE ON TABLE "ListingDevelopmentLink" TO ams_data_hub_web;
GRANT SELECT, INSERT ON TABLE "ListingDevelopmentLink" TO ams_data_hub_worker;
GRANT SELECT ON TABLE "ListingDevelopmentLink" TO ams_data_hub_backup;
