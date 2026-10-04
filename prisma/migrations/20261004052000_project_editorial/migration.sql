CREATE TYPE "ProjectEditorialEntityType" AS ENUM ('DEVELOPER', 'DEVELOPMENT', 'BUILDING', 'INVENTORY', 'AGENT');

CREATE TABLE "EntityEditorial" (
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "entityType" "ProjectEditorialEntityType" NOT NULL,
  "entityUid" VARCHAR(26) NOT NULL,
  "shortDescription" VARCHAR(500),
  "description" VARCHAR(4000),
  "faq" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "presentationNotes" VARCHAR(2000),
  "mediaOrder" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "mediaOrderPolicyVersion" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "EntityEditorial_pkey" PRIMARY KEY ("organizationId", "projectId", "entityType", "entityUid")
);

CREATE TABLE "EntityMediaOrderPolicy" (
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "entityType" "ProjectEditorialEntityType" NOT NULL,
  "entityUid" VARCHAR(26) NOT NULL,
  "sourceMediaOrder" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isImageOrderChangeAllowed" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "EntityMediaOrderPolicy_pkey" PRIMARY KEY ("organizationId", "projectId", "entityType", "entityUid")
);

CREATE INDEX "EntityEditorial_projectId_entityType_idx" ON "EntityEditorial"("projectId", "entityType");
CREATE INDEX "EntityMediaOrderPolicy_projectId_entityType_idx" ON "EntityMediaOrderPolicy"("projectId", "entityType");

ALTER TABLE "EntityEditorial" ADD CONSTRAINT "EntityEditorial_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityMediaOrderPolicy" ADD CONSTRAINT "EntityMediaOrderPolicy_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EntityEditorial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EntityEditorial" FORCE ROW LEVEL SECURITY;
ALTER TABLE "EntityMediaOrderPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EntityMediaOrderPolicy" FORCE ROW LEVEL SECURITY;

CREATE POLICY "EntityEditorial_rls" ON "EntityEditorial"
  FOR SELECT TO PUBLIC USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND "projectId" = NULLIF(current_setting('app.project_id', true), '')
    )
  );
CREATE POLICY "EntityEditorial_admin_write" ON "EntityEditorial"
  FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin')
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

CREATE POLICY "EntityMediaOrderPolicy_rls" ON "EntityMediaOrderPolicy"
  FOR SELECT TO PUBLIC USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND "projectId" = NULLIF(current_setting('app.project_id', true), '')
    )
  );
CREATE POLICY "EntityMediaOrderPolicy_job_write" ON "EntityMediaOrderPolicy"
  FOR ALL TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) = 'job'
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "projectId" = NULLIF(current_setting('app.project_id', true), '')
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) = 'job'
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "projectId" = NULLIF(current_setting('app.project_id', true), '')
  );

GRANT SELECT, INSERT, UPDATE ON TABLE "EntityEditorial", "EntityMediaOrderPolicy" TO ams_data_hub_web;
GRANT SELECT, INSERT, UPDATE ON TABLE "EntityMediaOrderPolicy" TO ams_data_hub_worker;
GRANT SELECT ON TABLE "EntityEditorial" TO ams_data_hub_worker;
GRANT SELECT ON TABLE "EntityEditorial", "EntityMediaOrderPolicy" TO ams_data_hub_backup;
