CREATE TYPE "PriceObservationBasis" AS ENUM ('TOTAL', 'PER_SQUARE_METER');
CREATE UNIQUE INDEX "Building_developmentUid_uid_key" ON "Building"("developmentUid", "uid");

ALTER TABLE "Development"
  ADD COLUMN "addressLine" VARCHAR(500),
  ADD COLUMN "latitude" DECIMAL(10,7),
  ADD COLUMN "longitude" DECIMAL(10,7),
  ADD CONSTRAINT "Development_coordinate_pair_check" CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
  ADD CONSTRAINT "Development_latitude_check" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "Development_longitude_check" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);

CREATE TABLE "DevelopmentExternalIdentity" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "developmentUid" VARCHAR(26) NOT NULL,
  "externalId" VARCHAR(240) NOT NULL,
  "firstObservedAt" TIMESTAMPTZ(3) NOT NULL,
  "lastObservedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "DevelopmentExternalIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DevelopmentExternalIdentity_observation_order_check" CHECK ("lastObservedAt" >= "firstObservedAt")
);

CREATE TABLE "PriceObservation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "developmentUid" VARCHAR(26) NOT NULL,
  "buildingUid" VARCHAR(26),
  "externalId" VARCHAR(240) NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "basis" "PriceObservationBasis" NOT NULL DEFAULT 'TOTAL',
  "areaM2" DECIMAL(12,2),
  "roomCount" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PriceObservation_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "PriceObservation_area_check" CHECK ("areaM2" IS NULL OR "areaM2" > 0),
  CONSTRAINT "PriceObservation_room_count_check" CHECK ("roomCount" IS NULL OR "roomCount" >= 0)
);

CREATE TABLE "SharedMediaAsset" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "developmentUid" VARCHAR(26) NOT NULL,
  "buildingUid" VARCHAR(26),
  "externalId" VARCHAR(240) NOT NULL,
  "kind" "MediaSourceKind" NOT NULL DEFAULT 'DEVELOPMENT_IMAGE',
  "position" INTEGER NOT NULL,
  "sourceUrl" VARCHAR(2048) NOT NULL,
  "canonicalSourceUrl" VARCHAR(2048) NOT NULL,
  "rightsBasis" "MediaRightsBasis" NOT NULL,
  "attribution" VARCHAR(500),
  "license" VARCHAR(255),
  "observedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SharedMediaAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SharedMediaAsset_position_check" CHECK ("position" >= 0),
  CONSTRAINT "SharedMediaAsset_licensed_attribution_check" CHECK ("rightsBasis" <> 'LICENSED' OR length(trim("attribution")) > 0 AND "attribution" IS NOT NULL)
);

CREATE UNIQUE INDEX "DevelopmentExternalIdentity_scope_key" ON "DevelopmentExternalIdentity"("organizationId", "projectId", "sourceId", "externalId");
CREATE INDEX "DevelopmentExternalIdentity_development_observed_idx" ON "DevelopmentExternalIdentity"("developmentUid", "lastObservedAt");
CREATE UNIQUE INDEX "PriceObservation_scope_key" ON "PriceObservation"("organizationId", "projectId", "sourceId", "externalId", "observedAt", "basis");
CREATE INDEX "PriceObservation_development_observed_idx" ON "PriceObservation"("developmentUid", "observedAt");
CREATE INDEX "PriceObservation_building_observed_idx" ON "PriceObservation"("buildingUid", "observedAt");
CREATE UNIQUE INDEX "SharedMediaAsset_scope_key" ON "SharedMediaAsset"("organizationId", "projectId", "sourceId", "developmentUid", "canonicalSourceUrl");
CREATE INDEX "SharedMediaAsset_development_position_idx" ON "SharedMediaAsset"("developmentUid", "position");
CREATE INDEX "SharedMediaAsset_building_position_idx" ON "SharedMediaAsset"("buildingUid", "position");

ALTER TABLE "DevelopmentExternalIdentity" ADD CONSTRAINT "DevelopmentExternalIdentity_project_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DevelopmentExternalIdentity" ADD CONSTRAINT "DevelopmentExternalIdentity_source_fkey" FOREIGN KEY ("organizationId", "projectId", "sourceId") REFERENCES "Source"("organizationId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DevelopmentExternalIdentity" ADD CONSTRAINT "DevelopmentExternalIdentity_development_fkey" FOREIGN KEY ("developmentUid") REFERENCES "Development"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_project_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_source_fkey" FOREIGN KEY ("organizationId", "projectId", "sourceId") REFERENCES "Source"("organizationId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_development_fkey" FOREIGN KEY ("developmentUid") REFERENCES "Development"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_building_fkey" FOREIGN KEY ("developmentUid", "buildingUid") REFERENCES "Building"("developmentUid", "uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SharedMediaAsset" ADD CONSTRAINT "SharedMediaAsset_project_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SharedMediaAsset" ADD CONSTRAINT "SharedMediaAsset_source_fkey" FOREIGN KEY ("organizationId", "projectId", "sourceId") REFERENCES "Source"("organizationId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SharedMediaAsset" ADD CONSTRAINT "SharedMediaAsset_development_fkey" FOREIGN KEY ("developmentUid") REFERENCES "Development"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SharedMediaAsset" ADD CONSTRAINT "SharedMediaAsset_building_fkey" FOREIGN KEY ("developmentUid", "buildingUid") REFERENCES "Building"("developmentUid", "uid") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DevelopmentExternalIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DevelopmentExternalIdentity" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PriceObservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceObservation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SharedMediaAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SharedMediaAsset" FORCE ROW LEVEL SECURITY;

CREATE POLICY "DevelopmentExternalIdentity_rls" ON "DevelopmentExternalIdentity" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff') OR
  (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job') AND
   "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND
   (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))))
);
CREATE POLICY "PriceObservation_rls" ON "PriceObservation" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff') OR
  (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job') AND
   "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND
   (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))))
);
CREATE POLICY "SharedMediaAsset_rls" ON "SharedMediaAsset" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff') OR
  (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job') AND
   "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND
   (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))))
);

CREATE POLICY "DevelopmentExternalIdentity_write" ON "DevelopmentExternalIdentity" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin' OR (current_setting('app.principal_kind', true) IN ('job', 'project-job') AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))))
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin' OR (current_setting('app.principal_kind', true) IN ('job', 'project-job') AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))));
CREATE POLICY "PriceObservation_write" ON "PriceObservation" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin' OR (current_setting('app.principal_kind', true) IN ('job', 'project-job') AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))))
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin' OR (current_setting('app.principal_kind', true) IN ('job', 'project-job') AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))));
CREATE POLICY "SharedMediaAsset_write" ON "SharedMediaAsset" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin' OR (current_setting('app.principal_kind', true) IN ('job', 'project-job') AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))))
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin' OR (current_setting('app.principal_kind', true) IN ('job', 'project-job') AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))));

GRANT SELECT, INSERT, UPDATE ON TABLE "DevelopmentExternalIdentity", "PriceObservation", "SharedMediaAsset" TO ams_data_hub_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE "DevelopmentExternalIdentity", "PriceObservation", "SharedMediaAsset" TO ams_data_hub_web;
GRANT SELECT ON TABLE "DevelopmentExternalIdentity", "PriceObservation", "SharedMediaAsset" TO ams_data_hub_backup;
