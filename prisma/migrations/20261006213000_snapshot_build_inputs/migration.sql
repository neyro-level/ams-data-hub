-- Forward-only capture receipts; existing publication and Source policies stay intact.
CREATE TABLE "ProjectSnapshotSequence" (
  "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "lastReservedSequence" INTEGER NOT NULL CHECK ("lastReservedSequence" >= 0),
  PRIMARY KEY ("organizationId", "projectId"),
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE TABLE "SnapshotBuildInput" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "idempotencyKeyHash" CHAR(64) NOT NULL CHECK ("idempotencyKeyHash" ~ '^[a-f0-9]{64}$'),
  "requestHash" CHAR(64) NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  "inputSchemaVersion" INTEGER NOT NULL CHECK ("inputSchemaVersion" = 1),
  "projectorVersion" VARCHAR(64) NOT NULL CHECK (length("projectorVersion") > 0),
  "schemaMinor" INTEGER NOT NULL CHECK ("schemaMinor" >= 0),
  "publishSequence" INTEGER NOT NULL CHECK ("publishSequence" > 0),
  "projectStateRevision" INTEGER NOT NULL CHECK ("projectStateRevision" > 0),
  "catalogRevision" CHAR(64) NOT NULL CHECK ("catalogRevision" ~ '^[a-f0-9]{64}$'),
  "inputHash" CHAR(64) NOT NULL CHECK ("inputHash" ~ '^[a-f0-9]{64}$'),
  "capturedAt" TIMESTAMPTZ(3) NOT NULL,
  "captureTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  UNIQUE ("organizationId", "projectId", "id"),
  UNIQUE ("organizationId", "projectId", "idempotencyKeyHash"),
  UNIQUE ("organizationId", "projectId", "publishSequence"),
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE TABLE "SnapshotBuildInputPart" (
  "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "buildInputId" TEXT NOT NULL,
  "kind" VARCHAR(64) NOT NULL CHECK ("kind" IN ('project','subscription','sources','inventory','catalog','media','agents','contacts','editorial','media-order','url-policy','urls','redirects','tombstones','listing-links','prices','shared-media','lifecycle')),
  "partIndex" INTEGER NOT NULL CHECK ("partIndex" >= 0),
  "payloadHash" CHAR(64) NOT NULL CHECK ("payloadHash" ~ '^[a-f0-9]{64}$'),
  "payload" JSONB NOT NULL CHECK (jsonb_typeof("payload") = 'array' AND octet_length("payload"::text) <= 2097152),
  PRIMARY KEY ("buildInputId", "kind", "partIndex"),
  FOREIGN KEY ("organizationId", "projectId", "buildInputId") REFERENCES "SnapshotBuildInput"("organizationId", "projectId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE FUNCTION snapshot_input_scope(organization_id TEXT, project_id TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
  SELECT current_setting('app.principal_kind', true) = 'project-job'
    AND current_setting('app.actor_id', true) = 'snapshot-input'
    AND organization_id = NULLIF(current_setting('app.organization_id', true), '')
    AND project_id = NULLIF(current_setting('app.project_ids', true), '')
$$;
ALTER TABLE "ProjectSnapshotSequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectSnapshotSequence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SnapshotBuildInput" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SnapshotBuildInput" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SnapshotBuildInputPart" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SnapshotBuildInputPart" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ProjectSnapshotSequence_rls" ON "ProjectSnapshotSequence" FOR ALL TO PUBLIC
  USING (snapshot_input_scope("organizationId", "projectId")) WITH CHECK (snapshot_input_scope("organizationId", "projectId"));
CREATE POLICY "SnapshotBuildInput_rls" ON "SnapshotBuildInput" FOR SELECT TO PUBLIC USING (snapshot_input_scope("organizationId", "projectId"));
CREATE POLICY "SnapshotBuildInput_insert" ON "SnapshotBuildInput" FOR INSERT TO PUBLIC WITH CHECK (snapshot_input_scope("organizationId", "projectId"));
CREATE POLICY "SnapshotBuildInputPart_rls" ON "SnapshotBuildInputPart" FOR SELECT TO PUBLIC USING (snapshot_input_scope("organizationId", "projectId"));
CREATE POLICY "SnapshotBuildInputPart_insert" ON "SnapshotBuildInputPart" FOR INSERT TO PUBLIC WITH CHECK (snapshot_input_scope("organizationId", "projectId"));
GRANT SELECT, INSERT, UPDATE ON "ProjectSnapshotSequence" TO ams_data_hub_worker;
GRANT SELECT, INSERT ON "SnapshotBuildInput", "SnapshotBuildInputPart" TO ams_data_hub_worker;
GRANT SELECT ON "ProjectSnapshotSequence", "SnapshotBuildInput", "SnapshotBuildInputPart" TO ams_data_hub_backup;

CREATE FUNCTION protect_snapshot_sequence() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."organizationId", NEW."projectId") IS DISTINCT FROM (OLD."organizationId", OLD."projectId")
    OR NEW."lastReservedSequence" <= OLD."lastReservedSequence" THEN RAISE EXCEPTION 'SNAPSHOT_SEQUENCE_NOT_INCREASING'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProjectSnapshotSequence_monotonic" BEFORE UPDATE ON "ProjectSnapshotSequence"
  FOR EACH ROW EXECUTE FUNCTION protect_snapshot_sequence();

CREATE FUNCTION protect_snapshot_input() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'SNAPSHOT_INPUT_IMMUTABLE'; END IF;
  IF TG_TABLE_NAME = 'SnapshotBuildInput' THEN
    IF NEW."captureTransactionId" <> txid_current() THEN RAISE EXCEPTION 'SNAPSHOT_INPUT_TRANSACTION_INVALID'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ProjectSnapshotSequence" WHERE "organizationId" = NEW."organizationId"
      AND "projectId" = NEW."projectId" AND "lastReservedSequence" = NEW."publishSequence")
    THEN RAISE EXCEPTION 'SNAPSHOT_INPUT_SEQUENCE_INVALID'; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM "SnapshotBuildInput" WHERE "id" = NEW."buildInputId"
      AND "organizationId" = NEW."organizationId" AND "projectId" = NEW."projectId"
      AND "captureTransactionId" = txid_current()) THEN RAISE EXCEPTION 'SNAPSHOT_INPUT_CAPTURE_CLOSED'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SnapshotBuildInput_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "SnapshotBuildInput" FOR EACH ROW EXECUTE FUNCTION protect_snapshot_input();
CREATE TRIGGER "SnapshotBuildInputPart_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "SnapshotBuildInputPart" FOR EACH ROW EXECUTE FUNCTION protect_snapshot_input();

-- Enforce complete sections and contiguous parts at commit, not just in TypeScript.
CREATE FUNCTION check_snapshot_input_complete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE input_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'SnapshotBuildInput' THEN input_id := NEW."id"; ELSE input_id := NEW."buildInputId"; END IF;
  IF (SELECT count(DISTINCT "kind") FROM "SnapshotBuildInputPart" WHERE "buildInputId" = input_id) <> 18
    OR EXISTS (SELECT 1 FROM "SnapshotBuildInputPart" WHERE "buildInputId" = input_id
      GROUP BY "kind" HAVING min("partIndex") <> 0 OR max("partIndex") + 1 <> count(*))
  THEN RAISE EXCEPTION 'SNAPSHOT_INPUT_INCOMPLETE'; END IF;
  IF (SELECT count(*) > 2048 OR sum(jsonb_array_length("payload")) > 50000
      OR sum(octet_length("payload"::text)) > 67108864
      FROM "SnapshotBuildInputPart" WHERE "buildInputId" = input_id)
  THEN RAISE EXCEPTION 'SNAPSHOT_INPUT_LIMIT_EXCEEDED'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "SnapshotBuildInput_complete" AFTER INSERT ON "SnapshotBuildInput"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_snapshot_input_complete();
CREATE CONSTRAINT TRIGGER "SnapshotBuildInputPart_complete" AFTER INSERT ON "SnapshotBuildInputPart"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_snapshot_input_complete();
