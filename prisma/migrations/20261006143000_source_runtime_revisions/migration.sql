CREATE TYPE "SourceRevisionStatus" AS ENUM ('PENDING', 'STAGED', 'SUSPICIOUS', 'REJECTED', 'FAILED', 'GOOD');

CREATE TABLE "SourceSafetyPolicy" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "policy" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  UNIQUE ("organizationId", "projectId", "id"),
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "SourceRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL CHECK ("sourceVersion" > 0),
  "baseLastGoodRevisionId" TEXT,
  "adapterKey" VARCHAR(128) NOT NULL,
  "adapterVersion" VARCHAR(64) NOT NULL,
  "profileKey" VARCHAR(128) NOT NULL,
  "profileVersion" VARCHAR(64) NOT NULL,
  "safetyPolicy" JSONB NOT NULL,
  "safetyPolicyVersion" INTEGER,
  "status" "SourceRevisionStatus" NOT NULL DEFAULT 'PENDING',
  "sequence" INTEGER CHECK ("sequence" > 0),
  "rawStorageKey" VARCHAR(512),
  "rawArtifactHash" CHAR(64) CHECK ("rawArtifactHash" ~ '^[a-f0-9]{64}$'),
  "rawByteCount" INTEGER CHECK ("rawByteCount" BETWEEN 0 AND 268435456),
  "normalizedContentHash" CHAR(64) CHECK ("normalizedContentHash" ~ '^[a-f0-9]{64}$'),
  "recordCount" INTEGER NOT NULL DEFAULT 0 CHECK ("recordCount" BETWEEN 0 AND 100000),
  "invalidRecordCount" INTEGER NOT NULL DEFAULT 0 CHECK ("invalidRecordCount" BETWEEN 0 AND 100000),
  "safetyAnalysis" JSONB,
  "failedStage" VARCHAR(64),
  "failureCode" VARCHAR(120) CHECK ("failureCode" ~ '^[A-Z][A-Z0-9_]{2,119}$'),
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  UNIQUE ("organizationId", "projectId", "sourceId", "id"),
  UNIQUE ("sourceId", "sequence"),
  FOREIGN KEY ("organizationId", "projectId", "sourceId") REFERENCES "Source"("organizationId", "projectId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "SourceRevision_good_metadata" CHECK ("status" <> 'GOOD' OR (
    "sequence" IS NOT NULL AND "rawStorageKey" IS NOT NULL AND "rawArtifactHash" IS NOT NULL
    AND "rawByteCount" IS NOT NULL AND "normalizedContentHash" IS NOT NULL AND "completedAt" IS NOT NULL
  ))
);
CREATE INDEX "SourceRevision_projectId_sourceId_status_idx" ON "SourceRevision"("projectId", "sourceId", "status");
CREATE TABLE "SourceRevisionRecord" (
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "externalId" VARCHAR(240) NOT NULL CHECK (length(btrim("externalId")) > 0),
  "orderKey" VARCHAR(1920) NOT NULL CHECK ("orderKey" ~ '^[a-f0-9]+$'),
  "inventoryUid" VARCHAR(26) NOT NULL CHECK ("inventoryUid" ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  "recordHash" CHAR(64) NOT NULL CHECK ("recordHash" ~ '^[a-f0-9]{64}$'),
  "payload" JSONB NOT NULL CHECK (octet_length("payload"::text) <= 2000000),
  PRIMARY KEY ("revisionId", "externalId"),
  UNIQUE ("revisionId", "orderKey"),
  FOREIGN KEY ("organizationId", "projectId", "sourceId", "revisionId") REFERENCES "SourceRevision"("organizationId", "projectId", "sourceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "SourceRevisionRecord_projectId_sourceId_revisionId_idx" ON "SourceRevisionRecord"("projectId", "sourceId", "revisionId");
-- Do not invent historical revisions or clear existing Last Good pointers. Any
-- legacy dangling pointer stops this forward migration for explicit remediation.
ALTER TABLE "Source" ADD CONSTRAINT "Source_last_good_revision_fkey"
  FOREIGN KEY ("organizationId", "projectId", "id", "lastGoodRevisionId") REFERENCES "SourceRevision"("organizationId", "projectId", "sourceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE FUNCTION source_runtime_scope(organization_id TEXT, project_id TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
  SELECT current_setting('app.principal_kind', true) = 'platform-admin' OR (
    current_setting('app.principal_kind', true) = 'project-job'
    AND current_setting('app.actor_id', true) = 'source-import'
    AND organization_id = NULLIF(current_setting('app.organization_id', true), '')
    AND project_id = NULLIF(current_setting('app.project_ids', true), '')
  )
$$;
ALTER TABLE "SourceSafetyPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SourceSafetyPolicy" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SourceRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SourceRevision" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SourceRevisionRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SourceRevisionRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SourceSafetyPolicy_rls" ON "SourceSafetyPolicy" FOR SELECT TO PUBLIC USING (source_runtime_scope("organizationId", "projectId"));
CREATE POLICY "SourceSafetyPolicy_admin_write" ON "SourceSafetyPolicy" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin') WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');
CREATE POLICY "SourceRevision_rls" ON "SourceRevision" FOR ALL TO PUBLIC
  USING (source_runtime_scope("organizationId", "projectId")) WITH CHECK (source_runtime_scope("organizationId", "projectId"));
CREATE POLICY "SourceRevisionRecord_rls" ON "SourceRevisionRecord" FOR ALL TO PUBLIC
  USING (source_runtime_scope("organizationId", "projectId")) WITH CHECK (source_runtime_scope("organizationId", "projectId"));
CREATE POLICY "Source_runtime_update" ON "Source" FOR UPDATE TO PUBLIC
  USING (source_runtime_scope("organizationId", "projectId")) WITH CHECK (source_runtime_scope("organizationId", "projectId"));
GRANT SELECT, INSERT, UPDATE ON "SourceSafetyPolicy", "SourceRevision", "SourceRevisionRecord" TO ams_data_hub_web;
GRANT SELECT ON "SourceSafetyPolicy" TO ams_data_hub_worker;
GRANT SELECT, INSERT, UPDATE ON "SourceRevision", "SourceRevisionRecord" TO ams_data_hub_worker;
GRANT UPDATE ON "Source" TO ams_data_hub_worker;
GRANT SELECT ON "SourceSafetyPolicy", "SourceRevision", "SourceRevisionRecord" TO ams_data_hub_backup;
CREATE POLICY "DataSafetyState_source_read" ON "DataSafetyState" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'project-job' AND current_setting('app.actor_id', true) = 'source-import'
);

CREATE FUNCTION protect_good_source_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."status" = 'GOOD') THEN
    RAISE EXCEPTION 'SOURCE_REVISION_IMMUTABLE';
  END IF;
  IF NEW."status" = 'GOOD' THEN
    IF TG_OP <> 'UPDATE' OR OLD."status" <> 'STAGED' THEN RAISE EXCEPTION 'SOURCE_REVISION_TRANSITION_INVALID'; END IF;
    IF (SELECT count(*) FROM "SourceRevisionRecord" WHERE "revisionId" = NEW."id") <> NEW."recordCount" THEN
      RAISE EXCEPTION 'SOURCE_REVISION_COUNT_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SourceRevision_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "SourceRevision" FOR EACH ROW EXECUTE FUNCTION protect_good_source_revision();
CREATE FUNCTION protect_source_revision_record() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE revision_status "SourceRevisionStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SOURCE_REVISION_RECORD_DELETE_DENIED'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."revisionId", NEW."externalId", NEW."organizationId", NEW."projectId", NEW."sourceId") IS DISTINCT FROM
    (OLD."revisionId", OLD."externalId", OLD."organizationId", OLD."projectId", OLD."sourceId") THEN RAISE EXCEPTION 'SOURCE_REVISION_RECORD_SCOPE_IMMUTABLE'; END IF;
  SELECT "status" INTO revision_status FROM "SourceRevision" WHERE "id" = NEW."revisionId" FOR SHARE;
  IF revision_status IS NULL OR revision_status <> 'PENDING' THEN RAISE EXCEPTION 'SOURCE_REVISION_RECORD_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SourceRevisionRecord_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "SourceRevisionRecord" FOR EACH ROW EXECUTE FUNCTION protect_source_revision_record();
CREATE FUNCTION enforce_source_last_good() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."lastGoodRevisionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "SourceRevision" WHERE "id" = NEW."lastGoodRevisionId" AND "organizationId" = NEW."organizationId"
      AND "projectId" = NEW."projectId" AND "sourceId" = NEW."id" AND "status" = 'GOOD'
  ) THEN RAISE EXCEPTION 'SOURCE_LAST_GOOD_INVALID'; END IF;
  IF TG_OP = 'UPDATE' AND OLD."lastGoodRevisionId" IS NOT NULL AND NEW."lastGoodRevisionId" IS NULL THEN
    RAISE EXCEPTION 'SOURCE_LAST_GOOD_CLEAR_DENIED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Source_last_good_guard" BEFORE INSERT OR UPDATE ON "Source" FOR EACH ROW EXECUTE FUNCTION enforce_source_last_good();

CREATE FUNCTION lock_source_runtime_policy_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0));
  NEW."version" := OLD."version" + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER "SourceSafetyPolicy_runtime_lock" BEFORE UPDATE ON "SourceSafetyPolicy" FOR EACH ROW EXECUTE FUNCTION lock_source_runtime_policy_change();
CREATE FUNCTION lock_source_runtime_project_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0));
  RETURN NULL;
END $$;
-- Statement-level ordering acquires the shared lock BEFORE any Project row
-- lock, including mixed status/slug updates whose key lock conflicts with FK
-- checks made by runtime inserts. A row trigger would invert that ordering.
CREATE TRIGGER "Project_source_runtime_state_lock" BEFORE UPDATE OF "serviceState", "status" ON "Project"
  FOR EACH STATEMENT EXECUTE FUNCTION lock_source_runtime_project_change();
