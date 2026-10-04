CREATE TABLE "ProjectPublicContact" (
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "phone" VARCHAR(40) NOT NULL,
  "email" VARCHAR(320),
  "addressPublic" VARCHAR(500),
  "messengers" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "hours" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProjectPublicContact_pkey" PRIMARY KEY ("organizationId", "projectId")
);

CREATE INDEX "ProjectPublicContact_projectId_idx" ON "ProjectPublicContact"("projectId");

ALTER TABLE "ProjectPublicContact"
  ADD CONSTRAINT "ProjectPublicContact_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectPublicContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectPublicContact" FORCE ROW LEVEL SECURITY;

CREATE POLICY "ProjectPublicContact_rls" ON "ProjectPublicContact"
  FOR SELECT TO PUBLIC USING (
    current_setting('app.principal_kind', true) = 'platform-admin'
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
    )
  );

CREATE POLICY "ProjectPublicContact_admin_insert" ON "ProjectPublicContact"
  FOR INSERT TO PUBLIC
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

CREATE POLICY "ProjectPublicContact_admin_update" ON "ProjectPublicContact"
  FOR UPDATE TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin')
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

GRANT SELECT, INSERT, UPDATE ON TABLE "ProjectPublicContact" TO ams_data_hub_web;
GRANT SELECT ON TABLE "ProjectPublicContact" TO ams_data_hub_worker, ams_data_hub_backup;
