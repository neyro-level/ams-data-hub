CREATE TYPE "InventoryLifecycleStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "InventoryLifecycleEventType" AS ENUM ('INACTIVATED', 'REACTIVATED');

CREATE TABLE "InventoryIdentity" (
  "uid" VARCHAR(26) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "externalOfferId" VARCHAR(240) NOT NULL,
  "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "missingGoodRuns" INTEGER NOT NULL DEFAULT 0,
  "missingSince" TIMESTAMPTZ(3),
  "sourceCreatedAt" TIMESTAMPTZ(3),
  "sourceUpdatedAt" TIMESTAMPTZ(3),
  "sourceHash" CHAR(64) NOT NULL,
  "normalizedHash" CHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryIdentity_pkey" PRIMARY KEY ("uid"),
  CONSTRAINT "InventoryIdentity_uid_check" CHECK ("uid" ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT "InventoryIdentity_external_offer_check" CHECK (length(btrim("externalOfferId")) > 0),
  CONSTRAINT "InventoryIdentity_missing_runs_check" CHECK ("missingGoodRuns" >= 0),
  CONSTRAINT "InventoryIdentity_hashes_check" CHECK ("sourceHash" ~ '^[a-f0-9]{64}$' AND "normalizedHash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "InventoryLifecycleEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "inventoryUid" VARCHAR(26) NOT NULL,
  "type" "InventoryLifecycleEventType" NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryLifecycleEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryIdentity_project_source_external_key"
  ON "InventoryIdentity"("organizationId", "projectId", "sourceId", "externalOfferId");
CREATE UNIQUE INDEX "InventoryIdentity_project_uid_key"
  ON "InventoryIdentity"("organizationId", "projectId", "uid");
CREATE INDEX "InventoryIdentity_project_source_status_idx"
  ON "InventoryIdentity"("projectId", "sourceId", "status");
CREATE INDEX "InventoryIdentity_source_missing_idx" ON "InventoryIdentity"("sourceId", "missingSince");
CREATE INDEX "InventoryLifecycleEvent_project_occurred_idx"
  ON "InventoryLifecycleEvent"("projectId", "occurredAt");
CREATE INDEX "InventoryLifecycleEvent_inventory_occurred_idx"
  ON "InventoryLifecycleEvent"("inventoryUid", "occurredAt");

ALTER TABLE "InventoryIdentity" ADD CONSTRAINT "InventoryIdentity_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryIdentity" ADD CONSTRAINT "InventoryIdentity_source_fkey"
  FOREIGN KEY ("organizationId", "projectId", "sourceId") REFERENCES "Source"("organizationId", "projectId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryLifecycleEvent" ADD CONSTRAINT "InventoryLifecycleEvent_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryLifecycleEvent" ADD CONSTRAINT "InventoryLifecycleEvent_inventory_fkey"
  FOREIGN KEY ("organizationId", "projectId", "inventoryUid") REFERENCES "InventoryIdentity"("organizationId", "projectId", "uid")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryIdentity" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InventoryLifecycleEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryLifecycleEvent" FORCE ROW LEVEL SECURITY;

CREATE POLICY "InventoryIdentity_rls" ON "InventoryIdentity" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin' OR (
    current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
CREATE POLICY "InventoryIdentity_job_write" ON "InventoryIdentity" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
  WITH CHECK (current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  );

CREATE POLICY "InventoryLifecycleEvent_rls" ON "InventoryLifecycleEvent" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin' OR (
    current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
CREATE POLICY "InventoryLifecycleEvent_job_insert" ON "InventoryLifecycleEvent" FOR INSERT TO PUBLIC
  WITH CHECK (current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  );

GRANT SELECT ON TABLE "InventoryIdentity", "InventoryLifecycleEvent" TO ams_data_hub_web;
GRANT SELECT, INSERT, UPDATE ON TABLE "InventoryIdentity" TO ams_data_hub_worker;
GRANT SELECT, INSERT ON TABLE "InventoryLifecycleEvent" TO ams_data_hub_worker;
GRANT SELECT ON TABLE "InventoryIdentity", "InventoryLifecycleEvent" TO ams_data_hub_backup;
