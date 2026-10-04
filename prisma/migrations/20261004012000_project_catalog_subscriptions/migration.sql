CREATE TYPE "CatalogSubscriptionMode" AS ENUM ('ALL_SHARED', 'CURATED');
CREATE TYPE "CatalogSelectionDecision" AS ENUM ('INCLUDE', 'EXCLUDE');

CREATE TABLE "ProjectCatalogSubscription" (
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "mode" "CatalogSubscriptionMode" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProjectCatalogSubscription_pkey" PRIMARY KEY ("organizationId", "projectId")
);

CREATE TABLE "ProjectCatalogSubscriptionCity" (
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "cityUid" VARCHAR(26) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCatalogSubscriptionCity_pkey" PRIMARY KEY ("organizationId", "projectId", "cityUid")
);

CREATE TABLE "ProjectCatalogSubscriptionSelection" (
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "developmentUid" VARCHAR(26) NOT NULL,
  "decision" "CatalogSelectionDecision" NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCatalogSubscriptionSelection_pkey" PRIMARY KEY ("organizationId", "projectId", "developmentUid")
);

CREATE INDEX "ProjectCatalogSubscription_projectId_idx" ON "ProjectCatalogSubscription"("projectId");
CREATE INDEX "ProjectCatalogSubscriptionCity_cityUid_idx" ON "ProjectCatalogSubscriptionCity"("cityUid");
CREATE INDEX "ProjectCatalogSubscriptionSelection_developmentUid_decision_idx"
  ON "ProjectCatalogSubscriptionSelection"("developmentUid", "decision");

ALTER TABLE "ProjectCatalogSubscription"
  ADD CONSTRAINT "ProjectCatalogSubscription_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectCatalogSubscriptionCity"
  ADD CONSTRAINT "ProjectCatalogSubscriptionCity_subscription_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "ProjectCatalogSubscription"("organizationId", "projectId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectCatalogSubscriptionCity"
  ADD CONSTRAINT "ProjectCatalogSubscriptionCity_city_fkey"
  FOREIGN KEY ("cityUid") REFERENCES "City"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectCatalogSubscriptionSelection"
  ADD CONSTRAINT "ProjectCatalogSubscriptionSelection_subscription_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "ProjectCatalogSubscription"("organizationId", "projectId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectCatalogSubscriptionSelection"
  ADD CONSTRAINT "ProjectCatalogSubscriptionSelection_development_fkey"
  FOREIGN KEY ("developmentUid") REFERENCES "Development"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectCatalogSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectCatalogSubscriptionCity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectCatalogSubscriptionSelection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectCatalogSubscription" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProjectCatalogSubscriptionCity" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProjectCatalogSubscriptionSelection" FORCE ROW LEVEL SECURITY;

CREATE POLICY "ProjectCatalogSubscription_rls" ON "ProjectCatalogSubscription"
  FOR SELECT TO PUBLIC USING (
    current_setting('app.principal_kind', true) = 'platform-admin'
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
    )
  );
CREATE POLICY "ProjectCatalogSubscription_admin_write" ON "ProjectCatalogSubscription"
  FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin')
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

CREATE POLICY "ProjectCatalogSubscriptionCity_rls" ON "ProjectCatalogSubscriptionCity"
  FOR SELECT TO PUBLIC USING (
    current_setting('app.principal_kind', true) = 'platform-admin'
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
    )
  );
CREATE POLICY "ProjectCatalogSubscriptionCity_admin_write" ON "ProjectCatalogSubscriptionCity"
  FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin')
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

CREATE POLICY "ProjectCatalogSubscriptionSelection_rls" ON "ProjectCatalogSubscriptionSelection"
  FOR SELECT TO PUBLIC USING (
    current_setting('app.principal_kind', true) = 'platform-admin'
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
    )
  );
CREATE POLICY "ProjectCatalogSubscriptionSelection_admin_write" ON "ProjectCatalogSubscriptionSelection"
  FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin')
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "ProjectCatalogSubscription", "ProjectCatalogSubscriptionCity", "ProjectCatalogSubscriptionSelection"
TO ams_data_hub_web;
GRANT SELECT ON TABLE
  "ProjectCatalogSubscription", "ProjectCatalogSubscriptionCity", "ProjectCatalogSubscriptionSelection"
TO ams_data_hub_worker, ams_data_hub_backup;
