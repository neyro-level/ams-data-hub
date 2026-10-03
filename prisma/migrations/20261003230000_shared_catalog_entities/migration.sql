CREATE TYPE "ConstructionStatus" AS ENUM ('PLANNED', 'UNDER_CONSTRUCTION', 'COMPLETED', 'SUSPENDED');

CREATE TABLE "Developer" (
  "uid" VARCHAR(26) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "normalizedName" VARCHAR(200) NOT NULL,
  "lifecycle" "CatalogLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "mergedIntoUid" VARCHAR(26),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Developer_pkey" PRIMARY KEY ("uid"),
  CONSTRAINT "Developer_uid_check" CHECK ("uid" ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT "Developer_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "Developer_normalized_name_check" CHECK (length(btrim("normalizedName")) BETWEEN 1 AND 200 AND "normalizedName" = lower("normalizedName")),
  CONSTRAINT "Developer_version_check" CHECK ("version" > 0),
  CONSTRAINT "Developer_merge_target_check" CHECK ("mergedIntoUid" IS NULL OR "mergedIntoUid" <> "uid")
);

CREATE TABLE "DeveloperAlias" (
  "developerUid" VARCHAR(26) NOT NULL,
  "value" VARCHAR(200) NOT NULL,
  "normalizedValue" VARCHAR(200) NOT NULL,
  CONSTRAINT "DeveloperAlias_pkey" PRIMARY KEY ("developerUid", "normalizedValue"),
  CONSTRAINT "DeveloperAlias_value_check" CHECK (length(btrim("value")) BETWEEN 1 AND 200),
  CONSTRAINT "DeveloperAlias_normalized_value_check" CHECK (length(btrim("normalizedValue")) BETWEEN 1 AND 200 AND "normalizedValue" = lower("normalizedValue"))
);

CREATE TABLE "Development" (
  "uid" VARCHAR(26) NOT NULL,
  "developerUid" VARCHAR(26) NOT NULL,
  "cityUid" VARCHAR(26) NOT NULL,
  "districtUid" VARCHAR(26),
  "name" VARCHAR(200) NOT NULL,
  "normalizedName" VARCHAR(200) NOT NULL,
  "lifecycle" "CatalogLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "mergedIntoUid" VARCHAR(26),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Development_pkey" PRIMARY KEY ("uid"),
  CONSTRAINT "Development_uid_check" CHECK ("uid" ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT "Development_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "Development_normalized_name_check" CHECK (length(btrim("normalizedName")) BETWEEN 1 AND 200 AND "normalizedName" = lower("normalizedName")),
  CONSTRAINT "Development_version_check" CHECK ("version" > 0),
  CONSTRAINT "Development_merge_target_check" CHECK ("mergedIntoUid" IS NULL OR "mergedIntoUid" <> "uid")
);

CREATE TABLE "DevelopmentAlias" (
  "developmentUid" VARCHAR(26) NOT NULL,
  "value" VARCHAR(200) NOT NULL,
  "normalizedValue" VARCHAR(200) NOT NULL,
  CONSTRAINT "DevelopmentAlias_pkey" PRIMARY KEY ("developmentUid", "normalizedValue"),
  CONSTRAINT "DevelopmentAlias_value_check" CHECK (length(btrim("value")) BETWEEN 1 AND 200),
  CONSTRAINT "DevelopmentAlias_normalized_value_check" CHECK (length(btrim("normalizedValue")) BETWEEN 1 AND 200 AND "normalizedValue" = lower("normalizedValue"))
);

CREATE TABLE "Building" (
  "uid" VARCHAR(26) NOT NULL,
  "developmentUid" VARCHAR(26) NOT NULL,
  "label" VARCHAR(160) NOT NULL,
  "normalizedLabel" VARCHAR(160) NOT NULL,
  "floors" INTEGER,
  "commissioningYear" INTEGER,
  "commissioningQuarter" INTEGER,
  "constructionStatus" "ConstructionStatus" NOT NULL DEFAULT 'PLANNED',
  "material" VARCHAR(120),
  "housingClass" VARCHAR(80),
  "lifecycle" "CatalogLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "mergedIntoUid" VARCHAR(26),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Building_pkey" PRIMARY KEY ("uid"),
  CONSTRAINT "Building_uid_check" CHECK ("uid" ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT "Building_label_check" CHECK (length(btrim("label")) BETWEEN 1 AND 160),
  CONSTRAINT "Building_normalized_label_check" CHECK (length(btrim("normalizedLabel")) BETWEEN 1 AND 160 AND "normalizedLabel" = lower("normalizedLabel")),
  CONSTRAINT "Building_floors_check" CHECK ("floors" IS NULL OR "floors" BETWEEN 1 AND 200),
  CONSTRAINT "Building_commissioning_year_check" CHECK ("commissioningYear" IS NULL OR "commissioningYear" BETWEEN 2000 AND 2200),
  CONSTRAINT "Building_commissioning_quarter_check" CHECK ("commissioningQuarter" IS NULL OR "commissioningQuarter" BETWEEN 1 AND 4),
  CONSTRAINT "Building_version_check" CHECK ("version" > 0),
  CONSTRAINT "Building_merge_target_check" CHECK ("mergedIntoUid" IS NULL OR "mergedIntoUid" <> "uid")
);

CREATE TABLE "BuildingAlias" (
  "buildingUid" VARCHAR(26) NOT NULL,
  "value" VARCHAR(160) NOT NULL,
  "normalizedValue" VARCHAR(160) NOT NULL,
  CONSTRAINT "BuildingAlias_pkey" PRIMARY KEY ("buildingUid", "normalizedValue"),
  CONSTRAINT "BuildingAlias_value_check" CHECK (length(btrim("value")) BETWEEN 1 AND 160),
  CONSTRAINT "BuildingAlias_normalized_value_check" CHECK (length(btrim("normalizedValue")) BETWEEN 1 AND 160 AND "normalizedValue" = lower("normalizedValue"))
);

CREATE UNIQUE INDEX "District_cityUid_uid_key" ON "District"("cityUid", "uid");
CREATE UNIQUE INDEX "Developer_normalizedName_key" ON "Developer"("normalizedName");
CREATE INDEX "Developer_lifecycle_normalizedName_idx" ON "Developer"("lifecycle", "normalizedName");
CREATE INDEX "Developer_mergedIntoUid_idx" ON "Developer"("mergedIntoUid");
CREATE INDEX "DeveloperAlias_normalizedValue_idx" ON "DeveloperAlias"("normalizedValue");
CREATE UNIQUE INDEX "Development_cityUid_normalizedName_key" ON "Development"("cityUid", "normalizedName");
CREATE INDEX "Development_developerUid_lifecycle_idx" ON "Development"("developerUid", "lifecycle");
CREATE INDEX "Development_districtUid_idx" ON "Development"("districtUid");
CREATE INDEX "Development_mergedIntoUid_idx" ON "Development"("mergedIntoUid");
CREATE INDEX "DevelopmentAlias_normalizedValue_idx" ON "DevelopmentAlias"("normalizedValue");
CREATE UNIQUE INDEX "Building_developmentUid_normalizedLabel_key" ON "Building"("developmentUid", "normalizedLabel");
CREATE INDEX "Building_constructionStatus_lifecycle_idx" ON "Building"("constructionStatus", "lifecycle");
CREATE INDEX "Building_mergedIntoUid_idx" ON "Building"("mergedIntoUid");
CREATE INDEX "BuildingAlias_normalizedValue_idx" ON "BuildingAlias"("normalizedValue");

ALTER TABLE "Developer" ADD CONSTRAINT "Developer_mergedIntoUid_fkey" FOREIGN KEY ("mergedIntoUid") REFERENCES "Developer"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeveloperAlias" ADD CONSTRAINT "DeveloperAlias_developerUid_fkey" FOREIGN KEY ("developerUid") REFERENCES "Developer"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Development" ADD CONSTRAINT "Development_developerUid_fkey" FOREIGN KEY ("developerUid") REFERENCES "Developer"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Development" ADD CONSTRAINT "Development_cityUid_fkey" FOREIGN KEY ("cityUid") REFERENCES "City"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Development" ADD CONSTRAINT "Development_district_fkey" FOREIGN KEY ("cityUid", "districtUid") REFERENCES "District"("cityUid", "uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Development" ADD CONSTRAINT "Development_mergedIntoUid_fkey" FOREIGN KEY ("mergedIntoUid") REFERENCES "Development"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DevelopmentAlias" ADD CONSTRAINT "DevelopmentAlias_developmentUid_fkey" FOREIGN KEY ("developmentUid") REFERENCES "Development"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Building" ADD CONSTRAINT "Building_developmentUid_fkey" FOREIGN KEY ("developmentUid") REFERENCES "Development"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Building" ADD CONSTRAINT "Building_mergedIntoUid_fkey" FOREIGN KEY ("mergedIntoUid") REFERENCES "Building"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuildingAlias" ADD CONSTRAINT "BuildingAlias_buildingUid_fkey" FOREIGN KEY ("buildingUid") REFERENCES "Building"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "Developer_uid_immutable" BEFORE UPDATE ON "Developer" FOR EACH ROW EXECUTE FUNCTION "deny_shared_catalog_uid_mutation"();
CREATE TRIGGER "Development_uid_immutable" BEFORE UPDATE ON "Development" FOR EACH ROW EXECUTE FUNCTION "deny_shared_catalog_uid_mutation"();
CREATE TRIGGER "Building_uid_immutable" BEFORE UPDATE ON "Building" FOR EACH ROW EXECUTE FUNCTION "deny_shared_catalog_uid_mutation"();

ALTER TABLE "Developer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeveloperAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Development" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DevelopmentAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Building" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BuildingAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Developer" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DeveloperAlias" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Development" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DevelopmentAlias" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Building" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BuildingAlias" FORCE ROW LEVEL SECURITY;

DO $policies$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Developer', 'DeveloperAlias', 'Development', 'DevelopmentAlias', 'Building', 'BuildingAlias']
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO PUBLIC USING (current_setting(''app.principal_kind'', true) IN (''platform-admin'', ''platform-staff'', ''tenant-user'', ''api-client'', ''job'', ''system-job''))', table_name || '_read', table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO PUBLIC WITH CHECK (current_setting(''app.principal_kind'', true) IN (''platform-admin'', ''platform-staff''))', table_name || '_insert', table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO PUBLIC USING (current_setting(''app.principal_kind'', true) IN (''platform-admin'', ''platform-staff'')) WITH CHECK (current_setting(''app.principal_kind'', true) IN (''platform-admin'', ''platform-staff''))', table_name || '_update', table_name);
  END LOOP;
END
$policies$;

GRANT SELECT, INSERT, UPDATE ON TABLE
  "Developer", "DeveloperAlias", "Development", "DevelopmentAlias", "Building", "BuildingAlias"
TO ams_data_hub_web;
GRANT SELECT ON TABLE
  "Developer", "DeveloperAlias", "Development", "DevelopmentAlias", "Building", "BuildingAlias"
TO ams_data_hub_worker, ams_data_hub_backup;
