CREATE TYPE "SourceDatasetType" AS ENUM ('MIXED_REALTY', 'RESALE', 'NEW_BUILD', 'HOUSE', 'LAND', 'COMMERCIAL', 'AGENT');
CREATE TYPE "SourceTransportType" AS ENUM ('HTTPS_XML');
CREATE TYPE "SourceSharingPolicy" AS ENUM ('PROJECT_ONLY');
CREATE TYPE "SourceManualRunStatus" AS ENUM ('REQUESTED', 'CLAIMED', 'COMPLETED', 'FAILED');

CREATE TABLE "Source" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceKey" VARCHAR(128) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "adapterKey" VARCHAR(128) NOT NULL,
  "adapterVersion" VARCHAR(64) NOT NULL,
  "profileKey" VARCHAR(128) NOT NULL,
  "profileVersion" VARCHAR(64) NOT NULL,
  "datasetType" "SourceDatasetType" NOT NULL,
  "transportType" "SourceTransportType" NOT NULL DEFAULT 'HTTPS_XML',
  "sharingPolicy" "SourceSharingPolicy" NOT NULL DEFAULT 'PROJECT_ONLY',
  "schedulePolicy" JSONB NOT NULL,
  "safetyPolicyId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "lastAttemptAt" TIMESTAMPTZ(3),
  "lastSuccessAt" TIMESTAMPTZ(3),
  "lastGoodRevisionId" TEXT,
  "expectedNamespace" VARCHAR(500),
  "expectedProducer" VARCHAR(300),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Source_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Source_key_check" CHECK ("sourceKey" ~ '^[a-z][a-z0-9-]{1,127}$'),
  CONSTRAINT "Source_adapter_key_check" CHECK ("adapterKey" ~ '^[a-z][a-z0-9-]{1,127}$'),
  CONSTRAINT "Source_profile_key_check" CHECK ("profileKey" ~ '^[a-z][a-z0-9-]{1,127}$'),
  CONSTRAINT "Source_schedule_policy_check" CHECK (
    jsonb_typeof("schedulePolicy") = 'object'
    AND "schedulePolicy" ? 'mode'
    AND "schedulePolicy"->>'mode' IN ('MANUAL_ONLY', 'SCHEDULED')
  )
);

CREATE TABLE "SourceCredentialRef" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "endpointCredentialRefName" VARCHAR(128) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SourceCredentialRef_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SourceCredentialRef_name_check" CHECK ("endpointCredentialRefName" ~ '^[A-Z][A-Z0-9_]{0,127}$')
);

CREATE TABLE "SourceManualRunRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "status" "SourceManualRunStatus" NOT NULL DEFAULT 'REQUESTED',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SourceManualRunRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Source_organizationId_projectId_id_key" ON "Source"("organizationId", "projectId", "id");
CREATE UNIQUE INDEX "Source_project_key" ON "Source"("organizationId", "projectId", "sourceKey");
CREATE INDEX "Source_projectId_enabled_idx" ON "Source"("projectId", "enabled");
CREATE UNIQUE INDEX "SourceCredentialRef_sourceId_key" ON "SourceCredentialRef"("sourceId");
CREATE UNIQUE INDEX "SourceCredentialRef_scope_source_key" ON "SourceCredentialRef"("organizationId", "projectId", "sourceId");
CREATE INDEX "SourceCredentialRef_projectId_idx" ON "SourceCredentialRef"("projectId");
CREATE UNIQUE INDEX "SourceManualRunRequest_idempotency_key" ON "SourceManualRunRequest"("sourceId", "idempotencyKey");
CREATE INDEX "SourceManualRunRequest_project_status_created_idx" ON "SourceManualRunRequest"("projectId", "status", "createdAt");

ALTER TABLE "Source" ADD CONSTRAINT "Source_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceCredentialRef" ADD CONSTRAINT "SourceCredentialRef_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceCredentialRef" ADD CONSTRAINT "SourceCredentialRef_source_fkey"
  FOREIGN KEY ("organizationId", "projectId", "sourceId") REFERENCES "Source"("organizationId", "projectId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceManualRunRequest" ADD CONSTRAINT "SourceManualRunRequest_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceManualRunRequest" ADD CONSTRAINT "SourceManualRunRequest_source_fkey"
  FOREIGN KEY ("organizationId", "projectId", "sourceId") REFERENCES "Source"("organizationId", "projectId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Source" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Source" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SourceCredentialRef" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SourceCredentialRef" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SourceManualRunRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SourceManualRunRequest" FORCE ROW LEVEL SECURITY;

CREATE POLICY "Source_rls" ON "Source" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin'
  OR (
    current_setting('app.principal_kind', true) = 'job'
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
CREATE POLICY "Source_admin_write" ON "Source" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin')
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

CREATE POLICY "SourceCredentialRef_rls" ON "SourceCredentialRef" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin'
  OR (
    current_setting('app.principal_kind', true) = 'job'
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
CREATE POLICY "SourceCredentialRef_admin_write" ON "SourceCredentialRef" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin')
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

CREATE POLICY "SourceManualRunRequest_rls" ON "SourceManualRunRequest" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin'
  OR (
    current_setting('app.principal_kind', true) = 'job'
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
CREATE POLICY "SourceManualRunRequest_admin_insert" ON "SourceManualRunRequest" FOR INSERT TO PUBLIC
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');
CREATE POLICY "SourceManualRunRequest_job_update" ON "SourceManualRunRequest" FOR UPDATE TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) = 'job'
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) = 'job'
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  );

GRANT SELECT, INSERT, UPDATE ON TABLE "Source", "SourceCredentialRef" TO ams_data_hub_web;
GRANT SELECT, INSERT ON TABLE "SourceManualRunRequest" TO ams_data_hub_web;
GRANT SELECT ON TABLE "Source", "SourceCredentialRef" TO ams_data_hub_worker;
GRANT SELECT, UPDATE ON TABLE "SourceManualRunRequest" TO ams_data_hub_worker;
GRANT SELECT ON TABLE "Source", "SourceCredentialRef", "SourceManualRunRequest" TO ams_data_hub_backup;
