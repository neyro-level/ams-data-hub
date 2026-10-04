CREATE TYPE "CatalogLifecycleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

CREATE TABLE "Region" (
  "uid" VARCHAR(26) NOT NULL,
  "code" VARCHAR(12) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "normalizedName" VARCHAR(160) NOT NULL,
  "lifecycle" "CatalogLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Region_pkey" PRIMARY KEY ("uid"),
  CONSTRAINT "Region_uid_check" CHECK ("uid" ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT "Region_code_check" CHECK ("code" ~ '^RU-[A-Z]{2,3}$'),
  CONSTRAINT "Region_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 160),
  CONSTRAINT "Region_normalized_name_check" CHECK (
    length(btrim("normalizedName")) BETWEEN 1 AND 160
    AND "normalizedName" = lower("normalizedName")
  )
);

CREATE TABLE "RegionAlias" (
  "regionUid" VARCHAR(26) NOT NULL,
  "value" VARCHAR(160) NOT NULL,
  "normalizedValue" VARCHAR(160) NOT NULL,
  CONSTRAINT "RegionAlias_pkey" PRIMARY KEY ("regionUid", "normalizedValue"),
  CONSTRAINT "RegionAlias_value_check" CHECK (length(btrim("value")) BETWEEN 1 AND 160),
  CONSTRAINT "RegionAlias_normalized_value_check" CHECK (
    length(btrim("normalizedValue")) BETWEEN 1 AND 160
    AND "normalizedValue" = lower("normalizedValue")
  )
);

CREATE TABLE "City" (
  "uid" VARCHAR(26) NOT NULL,
  "regionUid" VARCHAR(26) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "normalizedName" VARCHAR(160) NOT NULL,
  "lifecycle" "CatalogLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "City_pkey" PRIMARY KEY ("uid"),
  CONSTRAINT "City_uid_check" CHECK ("uid" ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT "City_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 160),
  CONSTRAINT "City_normalized_name_check" CHECK (
    length(btrim("normalizedName")) BETWEEN 1 AND 160
    AND "normalizedName" = lower("normalizedName")
  )
);

CREATE TABLE "CityAlias" (
  "cityUid" VARCHAR(26) NOT NULL,
  "value" VARCHAR(160) NOT NULL,
  "normalizedValue" VARCHAR(160) NOT NULL,
  CONSTRAINT "CityAlias_pkey" PRIMARY KEY ("cityUid", "normalizedValue"),
  CONSTRAINT "CityAlias_value_check" CHECK (length(btrim("value")) BETWEEN 1 AND 160),
  CONSTRAINT "CityAlias_normalized_value_check" CHECK (
    length(btrim("normalizedValue")) BETWEEN 1 AND 160
    AND "normalizedValue" = lower("normalizedValue")
  )
);

CREATE TABLE "District" (
  "uid" VARCHAR(26) NOT NULL,
  "cityUid" VARCHAR(26) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "normalizedName" VARCHAR(160) NOT NULL,
  "lifecycle" "CatalogLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "District_pkey" PRIMARY KEY ("uid"),
  CONSTRAINT "District_uid_check" CHECK ("uid" ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT "District_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 160),
  CONSTRAINT "District_normalized_name_check" CHECK (
    length(btrim("normalizedName")) BETWEEN 1 AND 160
    AND "normalizedName" = lower("normalizedName")
  )
);

CREATE TABLE "DistrictAlias" (
  "districtUid" VARCHAR(26) NOT NULL,
  "value" VARCHAR(160) NOT NULL,
  "normalizedValue" VARCHAR(160) NOT NULL,
  CONSTRAINT "DistrictAlias_pkey" PRIMARY KEY ("districtUid", "normalizedValue"),
  CONSTRAINT "DistrictAlias_value_check" CHECK (length(btrim("value")) BETWEEN 1 AND 160),
  CONSTRAINT "DistrictAlias_normalized_value_check" CHECK (
    length(btrim("normalizedValue")) BETWEEN 1 AND 160
    AND "normalizedValue" = lower("normalizedValue")
  )
);

CREATE UNIQUE INDEX "Region_code_key" ON "Region"("code");
CREATE UNIQUE INDEX "Region_normalizedName_key" ON "Region"("normalizedName");
CREATE INDEX "Region_lifecycle_normalizedName_idx" ON "Region"("lifecycle", "normalizedName");
CREATE INDEX "RegionAlias_normalizedValue_idx" ON "RegionAlias"("normalizedValue");
CREATE UNIQUE INDEX "City_regionUid_normalizedName_key" ON "City"("regionUid", "normalizedName");
CREATE INDEX "City_lifecycle_normalizedName_idx" ON "City"("lifecycle", "normalizedName");
CREATE INDEX "CityAlias_normalizedValue_idx" ON "CityAlias"("normalizedValue");
CREATE UNIQUE INDEX "District_cityUid_normalizedName_key" ON "District"("cityUid", "normalizedName");
CREATE INDEX "District_lifecycle_normalizedName_idx" ON "District"("lifecycle", "normalizedName");
CREATE INDEX "DistrictAlias_normalizedValue_idx" ON "DistrictAlias"("normalizedValue");

ALTER TABLE "RegionAlias" ADD CONSTRAINT "RegionAlias_regionUid_fkey"
  FOREIGN KEY ("regionUid") REFERENCES "Region"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "City" ADD CONSTRAINT "City_regionUid_fkey"
  FOREIGN KEY ("regionUid") REFERENCES "Region"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CityAlias" ADD CONSTRAINT "CityAlias_cityUid_fkey"
  FOREIGN KEY ("cityUid") REFERENCES "City"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "District" ADD CONSTRAINT "District_cityUid_fkey"
  FOREIGN KEY ("cityUid") REFERENCES "City"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DistrictAlias" ADD CONSTRAINT "DistrictAlias_districtUid_fkey"
  FOREIGN KEY ("districtUid") REFERENCES "District"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "deny_shared_catalog_uid_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."uid" IS DISTINCT FROM OLD."uid" THEN
    RAISE EXCEPTION 'Shared catalog uid is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Region_uid_immutable" BEFORE UPDATE ON "Region"
  FOR EACH ROW EXECUTE FUNCTION "deny_shared_catalog_uid_mutation"();
CREATE TRIGGER "City_uid_immutable" BEFORE UPDATE ON "City"
  FOR EACH ROW EXECUTE FUNCTION "deny_shared_catalog_uid_mutation"();
CREATE TRIGGER "District_uid_immutable" BEFORE UPDATE ON "District"
  FOR EACH ROW EXECUTE FUNCTION "deny_shared_catalog_uid_mutation"();

INSERT INTO "Region" ("uid", "code", "name", "normalizedName", "updatedAt") VALUES
  ('01M41T6Q00Y9AEKKB9XDD94GSG', 'RU-KDA', 'Краснодарский край', 'краснодарский край', CURRENT_TIMESTAMP),
  ('01M41T6Q01YB1D9EC0GQKMR95N', 'RU-CR', 'Республика Крым', 'республика крым', CURRENT_TIMESTAMP),
  ('01M41T6Q02TQEE1GX1T4NG9C7E', 'RU-SEV', 'г. Севастополь', 'г. севастополь', CURRENT_TIMESTAMP),
  ('01M41T6Q03ET4K0KF746JC0C63', 'RU-ROS', 'Ростовская область', 'ростовская область', CURRENT_TIMESTAMP);

INSERT INTO "RegionAlias" ("regionUid", "value", "normalizedValue") VALUES
  ('01M41T6Q00Y9AEKKB9XDD94GSG', 'Кубань', 'кубань'),
  ('01M41T6Q01YB1D9EC0GQKMR95N', 'Крым', 'крым'),
  ('01M41T6Q02TQEE1GX1T4NG9C7E', 'Севастополь', 'севастополь'),
  ('01M41T6Q03ET4K0KF746JC0C63', 'Ростовская обл.', 'ростовская обл.');

INSERT INTO "City" ("uid", "regionUid", "name", "normalizedName", "updatedAt") VALUES
  ('01M41T6Q04BADHXSERJHZFXKCH', '01M41T6Q00Y9AEKKB9XDD94GSG', 'Краснодар', 'краснодар', CURRENT_TIMESTAMP),
  ('01M41T6Q052F51RZX5628BV9N6', '01M41T6Q02TQEE1GX1T4NG9C7E', 'Севастополь', 'севастополь', CURRENT_TIMESTAMP),
  ('01M41T6Q06MZSPS0T4TQKDA8QC', '01M41T6Q03ET4K0KF746JC0C63', 'Ростов-на-Дону', 'ростов-на-дону', CURRENT_TIMESTAMP);

INSERT INTO "CityAlias" ("cityUid", "value", "normalizedValue") VALUES
  ('01M41T6Q04BADHXSERJHZFXKCH', 'г. Краснодар', 'г. краснодар'),
  ('01M41T6Q052F51RZX5628BV9N6', 'г. Севастополь', 'г. севастополь'),
  ('01M41T6Q06MZSPS0T4TQKDA8QC', 'Ростов', 'ростов');

ALTER TABLE "Region" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RegionAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "City" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CityAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "District" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DistrictAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Region" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RegionAlias" FORCE ROW LEVEL SECURITY;
ALTER TABLE "City" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CityAlias" FORCE ROW LEVEL SECURITY;
ALTER TABLE "District" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DistrictAlias" FORCE ROW LEVEL SECURITY;

DO $policies$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Region', 'RegionAlias', 'City', 'CityAlias', 'District', 'DistrictAlias']
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO PUBLIC USING (current_setting(''app.principal_kind'', true) IN (''platform-admin'', ''tenant-user'', ''api-client'', ''job'', ''system-job''))',
      table_name || '_read', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO PUBLIC WITH CHECK (current_setting(''app.principal_kind'', true) = ''platform-admin'')',
      table_name || '_insert', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO PUBLIC USING (current_setting(''app.principal_kind'', true) = ''platform-admin'') WITH CHECK (current_setting(''app.principal_kind'', true) = ''platform-admin'')',
      table_name || '_update', table_name
    );
  END LOOP;
END
$policies$;

GRANT SELECT, INSERT, UPDATE ON TABLE
  "Region", "RegionAlias", "City", "CityAlias", "District", "DistrictAlias"
TO ams_data_hub_web;
GRANT SELECT ON TABLE
  "Region", "RegionAlias", "City", "CityAlias", "District", "DistrictAlias"
TO ams_data_hub_worker, ams_data_hub_backup;
