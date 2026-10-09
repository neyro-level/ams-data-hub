BEGIN;
-- Operation intent is not a successful storage receipt. Existing immutable
-- revisions are untouched; no legacy receipts or intents are manufactured.
CREATE TABLE "RawArtifactPutAttempt" (
  "revisionId" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
  "rawArtifactHash" CHAR(64) NOT NULL CHECK ("rawArtifactHash" ~ '^[a-f0-9]{64}$'),
  "storageKey" VARCHAR(512) NOT NULL,
  "byteCount" INTEGER NOT NULL CHECK ("byteCount" BETWEEN 0 AND 268435456),
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','STORED')),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "storedAt" TIMESTAMPTZ(3),
  CONSTRAINT "RawArtifactPutAttempt_scope_revision_key" UNIQUE ("organizationId","projectId","sourceId","revisionId"),
  CHECK ("storageKey" = 'source-artifacts/' || "rawArtifactHash"),
  CHECK ((status='PENDING' AND "storedAt" IS NULL) OR (status='STORED' AND "storedAt" IS NOT NULL AND "storedAt">="createdAt")),
  FOREIGN KEY ("organizationId","projectId","sourceId","revisionId")
    REFERENCES "SourceRevision"("organizationId","projectId","sourceId",id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("organizationId","projectId") REFERENCES "Project"("organizationId",id) ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "RawArtifactPutAttempt_project_hash_status_idx"
  ON "RawArtifactPutAttempt"("organizationId","projectId","rawArtifactHash",status);

CREATE TABLE "RawArtifactDeletion" (
  id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "rawArtifactHash" CHAR(64) NOT NULL CHECK ("rawArtifactHash" ~ '^[a-f0-9]{64}$'),
  "storageKey" VARCHAR(512) NOT NULL,
  policy JSONB NOT NULL CHECK (jsonb_typeof(policy)='object' AND octet_length(policy::text)<=4096),
  CHECK (policy ?& ARRAY['lastGoodRevisions','recentDays','documentedPurpose']
    AND policy-ARRAY['lastGoodRevisions','recentDays','documentedPurpose']='{}'::jsonb
    AND jsonb_typeof(policy->'lastGoodRevisions')='number' AND (policy->>'lastGoodRevisions')::numeric BETWEEN 1 AND 1000
    AND (policy->>'lastGoodRevisions')::numeric=trunc((policy->>'lastGoodRevisions')::numeric)
    AND jsonb_typeof(policy->'recentDays')='number' AND (policy->>'recentDays')::numeric BETWEEN 1 AND 3650
    AND (policy->>'recentDays')::numeric=trunc((policy->>'recentDays')::numeric)
    AND (policy->'documentedPurpose'='null'::jsonb OR (jsonb_typeof(policy->'documentedPurpose')='string'
      AND length(btrim(policy->>'documentedPurpose')) BETWEEN 1 AND 255))
    AND ((policy->>'lastGoodRevisions')::numeric=3 AND (policy->>'recentDays')::numeric=30
      OR jsonb_typeof(policy->'documentedPurpose')='string')),
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACKNOWLEDGED','DELETED')),
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3),
  "lastFailureCode" VARCHAR(64) CHECK ("lastFailureCode" IN ('RAW_DELETE_IO_UNKNOWN','RAW_DELETE_LEASE_LOST')),
  CHECK ("storageKey"='source-artifacts/' || "rawArtifactHash"),
  CHECK ((status='PENDING' AND "acknowledgedAt" IS NULL AND "completedAt" IS NULL)
    OR (status='ACKNOWLEDGED' AND "acknowledgedAt" IS NOT NULL AND "acknowledgedAt">="requestedAt" AND "completedAt" IS NULL AND "lastFailureCode" IS NULL)
    OR (status='DELETED' AND "acknowledgedAt" IS NOT NULL AND "completedAt" IS NOT NULL AND "acknowledgedAt">="requestedAt" AND "completedAt">="acknowledgedAt" AND "lastFailureCode" IS NULL)),
  FOREIGN KEY ("organizationId","projectId") REFERENCES "Project"("organizationId",id) ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "RawArtifactDeletion_project_hash_status_idx"
  ON "RawArtifactDeletion"("organizationId","projectId","rawArtifactHash",status);
CREATE UNIQUE INDEX "RawArtifactDeletion_one_unsettled_hash"
  ON "RawArtifactDeletion"("organizationId","projectId","rawArtifactHash") WHERE status IN ('PENDING','ACKNOWLEDGED');

CREATE FUNCTION raw_artifact_operation_scope(org TEXT, project TEXT) RETURNS BOOLEAN LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT current_setting('app.principal_kind',true)='platform-admin' OR (
    current_setting('app.principal_kind',true)='project-job'
    AND current_setting('app.actor_id',true) IN ('source-import','raw-artifact-retention')
    AND org=NULLIF(current_setting('app.organization_id',true),'')
    AND project=NULLIF(current_setting('app.project_ids',true),'')
    AND project<>'*' AND project NOT LIKE '%,%')
$$;
CREATE FUNCTION raw_artifact_deletion_scope(org TEXT, project TEXT) RETURNS BOOLEAN LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.raw_artifact_operation_scope(org,project) AND (
    current_setting('app.principal_kind',true)='platform-admin'
    OR current_setting('app.actor_id',true)='raw-artifact-retention')
$$;
ALTER TABLE "RawArtifactPutAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RawArtifactPutAttempt" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RawArtifactDeletion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RawArtifactDeletion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RawArtifactPutAttempt_rls" ON "RawArtifactPutAttempt" FOR SELECT TO PUBLIC USING (raw_artifact_operation_scope("organizationId","projectId"));
CREATE POLICY "RawArtifactPutAttempt_insert" ON "RawArtifactPutAttempt" FOR INSERT TO PUBLIC WITH CHECK (source_runtime_scope("organizationId","projectId"));
CREATE POLICY "RawArtifactPutAttempt_update" ON "RawArtifactPutAttempt" FOR UPDATE TO PUBLIC USING (source_runtime_scope("organizationId","projectId")) WITH CHECK (source_runtime_scope("organizationId","projectId"));
CREATE POLICY "RawArtifactDeletion_rls" ON "RawArtifactDeletion" FOR SELECT TO PUBLIC USING (raw_artifact_operation_scope("organizationId","projectId"));
CREATE POLICY "RawArtifactDeletion_insert" ON "RawArtifactDeletion" FOR INSERT TO PUBLIC WITH CHECK (raw_artifact_deletion_scope("organizationId","projectId"));
CREATE POLICY "RawArtifactDeletion_update" ON "RawArtifactDeletion" FOR UPDATE TO PUBLIC USING (raw_artifact_deletion_scope("organizationId","projectId")) WITH CHECK (raw_artifact_deletion_scope("organizationId","projectId"));
GRANT SELECT,INSERT,UPDATE ON "RawArtifactPutAttempt","RawArtifactDeletion" TO ams_data_hub_worker;
GRANT SELECT ON "RawArtifactPutAttempt","RawArtifactDeletion" TO ams_data_hub_backup;
-- No web SELECT/INSERT/UPDATE and no DELETE grant: this is private storage
-- capability metadata, not a normal tenant or public DTO surface.

CREATE FUNCTION protect_raw_artifact_put_attempt() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.status='STORED') THEN RAISE EXCEPTION 'RAW_PUT_JOURNAL_IMMUTABLE'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PENDING' OR NEW."storedAt" IS NOT NULL THEN RAISE EXCEPTION 'RAW_PUT_JOURNAL_TRANSITION_INVALID'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public."SourceRevision" r WHERE r.id=NEW."revisionId" AND r."organizationId"=NEW."organizationId"
      AND r."projectId"=NEW."projectId" AND r."sourceId"=NEW."sourceId" AND r.status='PENDING'
      AND r."rawArtifactHash" IS NULL AND r."rawStorageKey" IS NULL AND r."rawByteCount" IS NULL)
    THEN RAISE EXCEPTION 'RAW_PUT_JOURNAL_REVISION_INVALID'; END IF;
  ELSE
    IF (NEW."revisionId",NEW."organizationId",NEW."projectId",NEW."sourceId",NEW."rawArtifactHash",NEW."storageKey",NEW."byteCount",NEW."createdAt")
      IS DISTINCT FROM (OLD."revisionId",OLD."organizationId",OLD."projectId",OLD."sourceId",OLD."rawArtifactHash",OLD."storageKey",OLD."byteCount",OLD."createdAt")
      OR NEW.status<>'STORED' THEN RAISE EXCEPTION 'RAW_PUT_JOURNAL_TRANSITION_INVALID'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "RawArtifactPutAttempt_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "RawArtifactPutAttempt"
  FOR EACH ROW EXECUTE FUNCTION protect_raw_artifact_put_attempt();

-- Intent settlement and revision receipt share a transaction. Check their
-- final state at commit, allowing either write order but never an isolated
-- manufactured STORED result or removal of an already-settled receipt.
CREATE FUNCTION check_raw_artifact_put_receipt() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public."RawArtifactPutAttempt"; revision public."SourceRevision"; revision_id TEXT;
BEGIN
  IF TG_TABLE_NAME='RawArtifactPutAttempt' THEN revision_id:=NEW."revisionId"; ELSE revision_id:=NEW.id; END IF;
  SELECT * INTO attempt FROM public."RawArtifactPutAttempt" WHERE "revisionId"=revision_id;
  IF NOT FOUND THEN RETURN NULL; END IF; -- Historical revisions have no invented operation journal.
  SELECT * INTO revision FROM public."SourceRevision" WHERE id=revision_id AND "organizationId"=attempt."organizationId"
    AND "projectId"=attempt."projectId" AND "sourceId"=attempt."sourceId";
  IF NOT FOUND OR (attempt.status='STORED' AND (
    revision."rawStorageKey" IS DISTINCT FROM attempt."storageKey"
    OR revision."rawArtifactHash" IS DISTINCT FROM attempt."rawArtifactHash"
    OR revision."rawByteCount" IS DISTINCT FROM attempt."byteCount"))
    OR (attempt.status='PENDING' AND (revision."rawStorageKey" IS NOT NULL OR revision."rawArtifactHash" IS NOT NULL OR revision."rawByteCount" IS NOT NULL))
  THEN RAISE EXCEPTION 'RAW_PUT_JOURNAL_RECEIPT_MISMATCH'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "RawArtifactPutAttempt_receipt_guard" AFTER INSERT OR UPDATE ON "RawArtifactPutAttempt"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_raw_artifact_put_receipt();
CREATE CONSTRAINT TRIGGER "SourceRevision_raw_journal_guard" AFTER INSERT OR UPDATE ON "SourceRevision"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_raw_artifact_put_receipt();

CREATE FUNCTION protect_raw_artifact_deletion() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.status='DELETED') THEN RAISE EXCEPTION 'RAW_DELETE_JOURNAL_IMMUTABLE'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PENDING' OR NEW."acknowledgedAt" IS NOT NULL OR NEW."completedAt" IS NOT NULL OR NEW."lastFailureCode" IS NOT NULL
    THEN RAISE EXCEPTION 'RAW_DELETE_JOURNAL_TRANSITION_INVALID'; END IF;
  ELSE
    IF (NEW.id,NEW."organizationId",NEW."projectId",NEW."rawArtifactHash",NEW."storageKey",NEW.policy,NEW."requestedAt")
      IS DISTINCT FROM (OLD.id,OLD."organizationId",OLD."projectId",OLD."rawArtifactHash",OLD."storageKey",OLD.policy,OLD."requestedAt")
      OR (OLD.status='PENDING' AND NEW.status NOT IN ('PENDING','ACKNOWLEDGED'))
      OR (OLD.status='ACKNOWLEDGED' AND (NEW.status<>'DELETED' OR NEW."acknowledgedAt" IS DISTINCT FROM OLD."acknowledgedAt"))
    THEN RAISE EXCEPTION 'RAW_DELETE_JOURNAL_TRANSITION_INVALID'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "RawArtifactDeletion_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "RawArtifactDeletion"
  FOR EACH ROW EXECUTE FUNCTION protect_raw_artifact_deletion();
COMMIT;
