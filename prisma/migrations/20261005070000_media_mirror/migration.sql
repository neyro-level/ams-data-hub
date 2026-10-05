CREATE TYPE "MediaSourceKind" AS ENUM ('LISTING_IMAGE', 'AGENT_PHOTO', 'DEVELOPMENT_IMAGE', 'OTHER');
CREATE TYPE "MediaMirrorStatus" AS ENUM ('MIRRORED', 'WARNING');

CREATE TABLE "MediaSource" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceRevisionId" VARCHAR(128) NOT NULL,
  "entityType" VARCHAR(64) NOT NULL,
  "entityUid" VARCHAR(240) NOT NULL,
  "kind" "MediaSourceKind" NOT NULL,
  "position" INTEGER NOT NULL,
  "sourceUrl" VARCHAR(2048) NOT NULL,
  "canonicalSourceUrl" VARCHAR(2048) NOT NULL,
  "isImageOrderChangeAllowed" BOOLEAN NOT NULL DEFAULT false,
  "status" "MediaMirrorStatus" NOT NULL,
  "warningCode" VARCHAR(80),
  "assetId" TEXT,
  "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "lastAttemptAt" TIMESTAMPTZ(3) NOT NULL,
  "mirroredAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "MediaSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MediaSource_position_check" CHECK ("position" >= 0),
  CONSTRAINT "MediaSource_status_check" CHECK (
    ("status" = 'MIRRORED' AND "assetId" IS NOT NULL AND "warningCode" IS NULL AND "mirroredAt" IS NOT NULL)
    OR "status" = 'WARNING'
  )
);

CREATE UNIQUE INDEX "MediaSource_scope_identity_key" ON "MediaSource"(
  "organizationId", "projectId", "sourceId", "entityType", "entityUid", "kind", "canonicalSourceUrl"
);
CREATE INDEX "MediaSource_project_entity_position_idx" ON "MediaSource"("projectId", "entityType", "entityUid", "position");
CREATE INDEX "MediaSource_project_status_attempt_idx" ON "MediaSource"("projectId", "status", "lastAttemptAt");
CREATE INDEX "MediaSource_assetId_idx" ON "MediaSource"("assetId");

ALTER TABLE "MediaSource" ADD CONSTRAINT "MediaSource_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaSource" ADD CONSTRAINT "MediaSource_source_fkey"
  FOREIGN KEY ("organizationId", "projectId", "sourceId") REFERENCES "Source"("organizationId", "projectId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaSource" ADD CONSTRAINT "MediaSource_asset_fkey"
  FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MediaSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MediaSource" FORCE ROW LEVEL SECURITY;

CREATE POLICY "MediaSource_rls" ON "MediaSource" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff') OR (
    current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
CREATE POLICY "MediaSource_job_write" ON "MediaSource" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))))
  WITH CHECK (current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))));

DROP POLICY "MediaAsset_rls" ON "MediaAsset";
CREATE POLICY "MediaAsset_rls" ON "MediaAsset" FOR ALL TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff') OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
    )
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) = 'platform-admin' OR (
      current_setting('app.principal_kind', true) = 'tenant-user'
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    ) OR (
      current_setting('app.principal_kind', true) IN ('job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
    )
  );

GRANT SELECT, INSERT, UPDATE ON TABLE "MediaSource" TO ams_data_hub_worker;
GRANT SELECT ON TABLE "MediaSource" TO ams_data_hub_web, ams_data_hub_backup;
