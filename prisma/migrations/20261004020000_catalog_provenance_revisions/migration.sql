CREATE TYPE "CatalogEntityType" AS ENUM ('DEVELOPER', 'DEVELOPMENT', 'BUILDING');
CREATE TYPE "CatalogChangeKind" AS ENUM ('CREATE', 'UPDATE', 'RELINK', 'MERGE', 'MERGE_REASSIGN');
CREATE TYPE "CatalogProvenanceSource" AS ENUM ('MANUAL_ADMIN');

CREATE TABLE "CatalogChangeSet" (
  "id" TEXT NOT NULL,
  "actorId" VARCHAR(191) NOT NULL,
  "action" VARCHAR(120) NOT NULL,
  "source" "CatalogProvenanceSource" NOT NULL DEFAULT 'MANUAL_ADMIN',
  "correlationId" VARCHAR(191) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogChangeSet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CatalogChangeSet_actor_check" CHECK (length(btrim("actorId")) > 0),
  CONSTRAINT "CatalogChangeSet_action_check" CHECK (length(btrim("action")) > 0),
  CONSTRAINT "CatalogChangeSet_correlation_check" CHECK (length(btrim("correlationId")) > 0)
);

CREATE TABLE "CatalogEntityVersion" (
  "id" TEXT NOT NULL,
  "changeSetId" TEXT NOT NULL,
  "entityType" "CatalogEntityType" NOT NULL,
  "entityUid" VARCHAR(26) NOT NULL,
  "version" INTEGER NOT NULL,
  "changeKind" "CatalogChangeKind" NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogEntityVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CatalogEntityVersion_uid_check" CHECK ("entityUid" ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT "CatalogEntityVersion_version_check" CHECK ("version" > 0),
  CONSTRAINT "CatalogEntityVersion_snapshot_check" CHECK (jsonb_typeof("snapshot") = 'object')
);

CREATE TABLE "FactProvenance" (
  "id" TEXT NOT NULL,
  "changeSetId" TEXT NOT NULL,
  "entityVersionId" TEXT NOT NULL,
  "entityType" "CatalogEntityType" NOT NULL,
  "entityUid" VARCHAR(26) NOT NULL,
  "fieldPath" VARCHAR(160) NOT NULL,
  "valueSnapshot" JSONB NOT NULL,
  "source" "CatalogProvenanceSource" NOT NULL DEFAULT 'MANUAL_ADMIN',
  "actorId" VARCHAR(191) NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FactProvenance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FactProvenance_uid_check" CHECK ("entityUid" ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT "FactProvenance_field_check" CHECK (length(btrim("fieldPath")) > 0),
  CONSTRAINT "FactProvenance_actor_check" CHECK (length(btrim("actorId")) > 0),
  CONSTRAINT "FactProvenance_value_check" CHECK (jsonb_typeof("valueSnapshot") = 'object')
);

CREATE INDEX "CatalogChangeSet_createdAt_idx" ON "CatalogChangeSet"("createdAt");
CREATE INDEX "CatalogChangeSet_correlationId_idx" ON "CatalogChangeSet"("correlationId");
CREATE UNIQUE INDEX "CatalogEntityVersion_entityType_entityUid_version_key" ON "CatalogEntityVersion"("entityType", "entityUid", "version");
CREATE UNIQUE INDEX "CatalogEntityVersion_id_changeSetId_entityType_entityUid_key" ON "CatalogEntityVersion"("id", "changeSetId", "entityType", "entityUid");
CREATE INDEX "CatalogEntityVersion_changeSetId_idx" ON "CatalogEntityVersion"("changeSetId");
CREATE INDEX "CatalogEntityVersion_entityType_entityUid_createdAt_idx" ON "CatalogEntityVersion"("entityType", "entityUid", "createdAt");
CREATE UNIQUE INDEX "FactProvenance_entityVersionId_fieldPath_key" ON "FactProvenance"("entityVersionId", "fieldPath");
CREATE INDEX "FactProvenance_changeSetId_idx" ON "FactProvenance"("changeSetId");
CREATE INDEX "FactProvenance_entityType_entityUid_fieldPath_recordedAt_idx" ON "FactProvenance"("entityType", "entityUid", "fieldPath", "recordedAt");

ALTER TABLE "CatalogEntityVersion" ADD CONSTRAINT "CatalogEntityVersion_changeSetId_fkey"
  FOREIGN KEY ("changeSetId") REFERENCES "CatalogChangeSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FactProvenance" ADD CONSTRAINT "FactProvenance_entityVersionId_fkey"
  FOREIGN KEY ("entityVersionId", "changeSetId", "entityType", "entityUid")
  REFERENCES "CatalogEntityVersion"("id", "changeSetId", "entityType", "entityUid") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "deny_catalog_history_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'catalog history is immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "CatalogChangeSet_immutable" BEFORE UPDATE OR DELETE ON "CatalogChangeSet"
  FOR EACH ROW EXECUTE FUNCTION "deny_catalog_history_mutation"();
CREATE TRIGGER "CatalogEntityVersion_immutable" BEFORE UPDATE OR DELETE ON "CatalogEntityVersion"
  FOR EACH ROW EXECUTE FUNCTION "deny_catalog_history_mutation"();
CREATE TRIGGER "FactProvenance_immutable" BEFORE UPDATE OR DELETE ON "FactProvenance"
  FOR EACH ROW EXECUTE FUNCTION "deny_catalog_history_mutation"();

ALTER TABLE "CatalogChangeSet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogEntityVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FactProvenance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogChangeSet" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CatalogEntityVersion" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FactProvenance" FORCE ROW LEVEL SECURITY;

DO $policies$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['CatalogChangeSet', 'CatalogEntityVersion', 'FactProvenance']
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO PUBLIC USING (current_setting(''app.principal_kind'', true) IN (''platform-admin'', ''job'', ''system-job''))', table_name || '_read', table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO PUBLIC WITH CHECK (current_setting(''app.principal_kind'', true) = ''platform-admin'')', table_name || '_insert', table_name);
  END LOOP;
END
$policies$;

GRANT SELECT, INSERT ON TABLE "CatalogChangeSet", "CatalogEntityVersion", "FactProvenance" TO ams_data_hub_web;
GRANT SELECT ON TABLE "CatalogChangeSet", "CatalogEntityVersion", "FactProvenance" TO ams_data_hub_worker, ams_data_hub_backup;
