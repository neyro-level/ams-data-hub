CREATE TYPE "MediaRightsBasis" AS ENUM ('OWNED', 'LICENSED', 'PUBLIC_DOMAIN');

CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "storageKey" TEXT NOT NULL,
  "contentType" VARCHAR(127) NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "originalFileName" VARCHAR(255) NOT NULL,
  "rightsBasis" "MediaRightsBasis" NOT NULL,
  "source" VARCHAR(2048) NOT NULL,
  "license" VARCHAR(255),
  "uploadedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MediaAsset_sha256_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "MediaAsset_byteSize_check" CHECK ("byteSize" > 0 AND "byteSize" <= 20971520),
  CONSTRAINT "MediaAsset_license_check" CHECK ("rightsBasis" <> 'LICENSED' OR ("license" IS NOT NULL AND length(trim("license")) > 0))
);

CREATE UNIQUE INDEX "MediaAsset_projectId_sha256_key" ON "MediaAsset"("projectId", "sha256");
CREATE INDEX "MediaAsset_organizationId_createdAt_idx" ON "MediaAsset"("organizationId", "createdAt");
CREATE INDEX "MediaAsset_storageKey_idx" ON "MediaAsset"("storageKey");

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MediaAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MediaAsset" FORCE ROW LEVEL SECURITY;

CREATE POLICY "MediaAsset_rls" ON "MediaAsset"
  FOR ALL TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) = 'platform-admin'
    OR (
      current_setting('app.principal_kind', true) = 'tenant-user'
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  );

GRANT SELECT, INSERT ON TABLE "MediaAsset" TO ams_data_hub_web;
GRANT SELECT, INSERT ON TABLE "MediaAsset" TO ams_data_hub_worker;
GRANT SELECT ON TABLE "MediaAsset" TO ams_data_hub_backup;
