BEGIN;
ALTER TABLE "OperationalActionRequest" ADD COLUMN "ackRotationPhase" VARCHAR(7), ADD COLUMN "ackCredentialVersion" INTEGER;
ALTER TABLE "OperationalActionRequest" ADD CONSTRAINT "OperationalActionRequest_ack_rotation_check" CHECK (
  ("ackRotationPhase" IS NULL AND "ackCredentialVersion" IS NULL)
  OR ("action"='ACK_ROTATE' AND "ackRotationPhase" IN ('STAGE','PROMOTE') AND "ackCredentialVersion" BETWEEN 1 AND 2147483646));
CREATE FUNCTION operational_ack_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."action"='ACK_ROTATE' AND (NEW."ackRotationPhase" IS NULL OR NEW."ackCredentialVersion" IS NULL)
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_REFERENCE_INVALID'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "OperationalActionRequest_ack_request_guard" BEFORE INSERT ON "OperationalActionRequest"
  FOR EACH ROW EXECUTE FUNCTION operational_ack_request_guard();

CREATE TABLE "SnapshotAckRotationReceipt" (
  "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "phase" VARCHAR(7) NOT NULL, "previousVersion" INTEGER NOT NULL, "credentialVersion" INTEGER NOT NULL,
  "previousCurrentTokenHash" VARCHAR(255) NOT NULL, "previousNextTokenHash" VARCHAR(255),
  "currentTokenHash" VARCHAR(255) NOT NULL, "nextTokenHash" VARCHAR(255),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SnapshotAckRotationReceipt_pkey" PRIMARY KEY ("organizationId","projectId","requestId"),
  CONSTRAINT "SnapshotAckRotationReceipt_organizationId_projectId_credentialVersion_key" UNIQUE ("organizationId","projectId","credentialVersion"),
  CONSTRAINT "SnapshotAckRotationReceipt_organizationId_projectId_requestId_fkey" FOREIGN KEY ("organizationId","projectId","requestId")
    REFERENCES "OperationalActionRequest"("organizationId","projectId",id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "SnapshotAckRotationReceipt_transition_check" CHECK ("previousVersion">0 AND "credentialVersion"::bigint="previousVersion"::bigint+1
    AND (("phase"='STAGE' AND "previousNextTokenHash" IS NULL AND "currentTokenHash"="previousCurrentTokenHash" AND "nextTokenHash" IS NOT NULL)
      OR ("phase"='PROMOTE' AND "previousNextTokenHash" IS NOT NULL AND "currentTokenHash"="previousNextTokenHash" AND "nextTokenHash" IS NULL)))
);
CREATE FUNCTION snapshot_ack_rotation_scope(org TEXT, project TEXT) RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT current_setting('app.principal_kind',true)='project-job' AND current_setting('app.actor_id',true)='snapshot-ack-rotation'
    AND org=NULLIF(current_setting('app.organization_id',true),'') AND project=NULLIF(current_setting('app.project_ids',true),'')
    AND org<>'*' AND project<>'*' AND position(',' in project)=0
$$;
ALTER TABLE "SnapshotAckRotationReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SnapshotAckRotationReceipt" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SnapshotAckRotationReceipt_rls" ON "SnapshotAckRotationReceipt" FOR SELECT TO PUBLIC
  USING (snapshot_ack_rotation_scope("organizationId","projectId"));
CREATE POLICY "SnapshotAckRotationReceipt_insert" ON "SnapshotAckRotationReceipt" FOR INSERT TO PUBLIC
  WITH CHECK (snapshot_ack_rotation_scope("organizationId","projectId"));
GRANT SELECT, INSERT ON "SnapshotAckRotationReceipt" TO ams_data_hub_worker;
GRANT SELECT ON "SnapshotAckRotationReceipt" TO ams_data_hub_backup;

-- Full accepted lease is independently revalidated before credential row locks.
CREATE FUNCTION snapshot_ack_rotation_live_request(org TEXT, project TEXT, request TEXT)
RETURNS "OperationalActionRequest" LANGUAGE plpgsql AS $$
DECLARE r "OperationalActionRequest"; event_id TEXT; job_id TEXT;
BEGIN
  IF snapshot_ack_rotation_scope(org,project) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'ACK_ROTATION_ACCESS_DENIED'; END IF;
  PERFORM set_config('app.actor_id','operations-executor',true);
  SELECT * INTO r FROM "OperationalActionRequest" WHERE "organizationId"=org AND "projectId"=project AND id=request;
  IF NOT FOUND OR r.action<>'ACK_ROTATE' OR r.status<>'RUNNING' OR r."ackRotationPhase" IS NULL OR r."ackCredentialVersion" IS NULL
    OR r."leaseJobRunId" IS NULL OR r."leaseAttempt" IS NULL OR r."leaseWorkerId" IS NULL OR r."leaseAcquiredAt" IS NULL
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_REFERENCE_INVALID'; END IF;
  SELECT e.id INTO event_id FROM "OutboxEvent" e WHERE e.id=r."outboxEventId" AND e."organizationId"=org
    AND e.status='PROCESSING' AND e."schemaVersion"=1 AND e.attempts=r."leaseAttempt"
    AND e."lockedBy"=r."leaseWorkerId" AND e."lockedAt"=r."leaseAcquiredAt"
    AND e.topic='operations-control.ack.rotate.request' AND e.payload=jsonb_build_object('schemaVersion',1,
      'organizationId',org,'projectId',project,'requestId',request,'action','ACK_ROTATE') FOR UPDATE;
  SELECT j.id INTO job_id FROM "JobRun" j JOIN "OutboxEvent" e ON e.id=j."outboxEventId" WHERE j.id=r."leaseJobRunId"
    AND j."outboxEventId"=event_id AND j."organizationId"=org AND j.status='RUNNING' AND j.attempt=r."leaseAttempt"
    AND j."workerId"=r."leaseWorkerId" AND j."startedAt"=r."leaseAcquiredAt" AND j."jobType"=e.topic
    AND j."correlationId"=e."correlationId" FOR UPDATE OF j;
  IF event_id IS NULL OR job_id IS NULL THEN RAISE EXCEPTION 'OUTBOX_OPERATION_LEASE_LOST'; END IF;
  PERFORM 1 FROM "OperationalActionRequest" WHERE "organizationId"=org AND "projectId"=project AND id=request FOR UPDATE;
  PERFORM set_config('app.actor_id','snapshot-ack-rotation',true);
  RETURN r;
END $$;

CREATE FUNCTION lock_snapshot_ack_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org TEXT := NULLIF(current_setting('app.organization_id',true),''); project TEXT := NULLIF(current_setting('app.project_ids',true),'');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0));
  IF org IS NOT NULL AND project IS NOT NULL AND project<>'*' AND position(',' in project)=0 THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('["snapshot-publication",' || to_json(org)::text || ',' || to_json(project)::text || ']',0));
    PERFORM pg_advisory_xact_lock(hashtextextended('["snapshot-input",' || to_json(org)::text || ',' || to_json(project)::text || ']',0));
    PERFORM pg_advisory_xact_lock(hashtextextended('["snapshot-ack-rotation",' || to_json(org)::text || ',' || to_json(project)::text || ']',0));
  END IF;
  IF current_setting('app.actor_id',true)='snapshot-ack-rotation' THEN
    IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'ACK_CREDENTIAL_NOT_CONFIGURED'; END IF;
    PERFORM snapshot_ack_rotation_live_request(org,project,NULLIF(current_setting('app.ack_rotation_request_id',true),''));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "ProjectAckCredential_writer_lock" BEFORE INSERT OR UPDATE OR DELETE ON "ProjectAckCredential"
  FOR EACH STATEMENT EXECUTE FUNCTION lock_snapshot_ack_writer();

CREATE FUNCTION snapshot_ack_rotation_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "OperationalActionRequest"; request TEXT := NULLIF(current_setting('app.ack_rotation_request_id',true),'');
BEGIN
  IF current_setting('app.actor_id',true)<>'snapshot-ack-rotation' THEN RETURN NEW; END IF;
  r := snapshot_ack_rotation_live_request(NEW."organizationId",NEW."projectId",request);
  IF to_jsonb(NEW)-ARRAY['currentTokenHash','nextTokenHash','version','rotatedAt','updatedAt']
       <>to_jsonb(OLD)-ARRAY['currentTokenHash','nextTokenHash','version','rotatedAt','updatedAt']
    OR OLD.version<>r."ackCredentialVersion" OR NEW.version::bigint<>OLD.version::bigint+1
    OR NEW."currentTokenHash" !~ '^scrypt[$][A-Za-z0-9_-]{22}[$][A-Za-z0-9_-]{43}$'
    OR (NEW."nextTokenHash" IS NOT NULL AND NEW."nextTokenHash" !~ '^scrypt[$][A-Za-z0-9_-]{22}[$][A-Za-z0-9_-]{43}$')
    OR (r."ackRotationPhase"='STAGE' AND (OLD."nextTokenHash" IS NOT NULL OR NEW."nextTokenHash" IS NULL
      OR NEW."currentTokenHash"<>OLD."currentTokenHash" OR NEW."nextTokenHash"=OLD."currentTokenHash" OR NEW."rotatedAt" IS NOT NULL))
    OR (r."ackRotationPhase"='PROMOTE' AND (OLD."nextTokenHash" IS NULL OR NEW."nextTokenHash" IS NOT NULL
      OR NEW."currentTokenHash" IS DISTINCT FROM OLD."nextTokenHash" OR NEW."rotatedAt" IS NULL OR NOT EXISTS (
        SELECT 1 FROM "SnapshotAckRotationReceipt" p WHERE p."organizationId"=NEW."organizationId" AND p."projectId"=NEW."projectId"
          AND p.phase='STAGE' AND p."credentialVersion"=OLD.version AND p."currentTokenHash"=OLD."currentTokenHash" AND p."nextTokenHash"=OLD."nextTokenHash")))
  THEN RAISE EXCEPTION 'ACK_ROTATION_TRANSITION_INVALID'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProjectAckCredential_rotation_transition" BEFORE UPDATE ON "ProjectAckCredential"
  FOR EACH ROW EXECUTE FUNCTION snapshot_ack_rotation_transition_guard();

CREATE FUNCTION snapshot_ack_rotation_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' OR pg_trigger_depth()<>2 OR snapshot_ack_rotation_scope(NEW."organizationId",NEW."projectId") IS DISTINCT FROM TRUE
    OR NEW."requestId" IS DISTINCT FROM NULLIF(current_setting('app.ack_rotation_request_id',true),'')
  THEN RAISE EXCEPTION 'ACK_ROTATION_RECEIPT_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SnapshotAckRotationReceipt_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "SnapshotAckRotationReceipt"
  FOR EACH ROW EXECUTE FUNCTION snapshot_ack_rotation_receipt_guard();
CREATE FUNCTION snapshot_ack_rotation_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "OperationalActionRequest";
BEGIN
  IF current_setting('app.actor_id',true)='snapshot-ack-rotation' THEN
    r := snapshot_ack_rotation_live_request(NEW."organizationId",NEW."projectId",NULLIF(current_setting('app.ack_rotation_request_id',true),''));
    INSERT INTO "SnapshotAckRotationReceipt" ("organizationId","projectId","requestId",phase,"previousVersion","credentialVersion",
      "previousCurrentTokenHash","previousNextTokenHash","currentTokenHash","nextTokenHash")
    VALUES (NEW."organizationId",NEW."projectId",r.id,r."ackRotationPhase",OLD.version,NEW.version,
      OLD."currentTokenHash",OLD."nextTokenHash",NEW."currentTokenHash",NEW."nextTokenHash");
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProjectAckCredential_rotation_receipt" AFTER UPDATE ON "ProjectAckCredential"
  FOR EACH ROW EXECUTE FUNCTION snapshot_ack_rotation_record();

CREATE FUNCTION snapshot_ack_rotation_operation_proof(org TEXT, project TEXT, request TEXT)
RETURNS TABLE (phase TEXT,"previousCredentialVersion" INTEGER,"credentialVersion" INTEGER,"createdAt" TIMESTAMPTZ)
LANGUAGE SQL STABLE AS $$
  SELECT p.phase::text,p."previousVersion",p."credentialVersion",p."createdAt" FROM "SnapshotAckRotationReceipt" p
  WHERE snapshot_ack_rotation_scope(org,project) AND p."organizationId"=org AND p."projectId"=project AND p."requestId"=request
$$;
CREATE FUNCTION operational_ack_rotation_success_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof RECORD;
BEGIN
  IF pg_trigger_depth()>1 AND OLD."outboxEventId" IS NOT NULL AND NEW."outboxEventId" IS NULL
    AND to_jsonb(NEW)-'outboxEventId'=to_jsonb(OLD)-'outboxEventId' THEN RETURN NEW; END IF;
  IF operational_executor_scope(NEW."organizationId",NEW."projectId") IS DISTINCT FROM TRUE OR OLD.status<>'RUNNING'
    OR to_jsonb(NEW)-ARRAY['status','finishedAt','result','updatedAt']<>to_jsonb(OLD)-ARRAY['status','finishedAt','result','updatedAt']
    OR NEW."finishedAt" IS NULL OR NEW."startedAt" IS NULL OR NEW."finishedAt"<NEW."startedAt" OR NEW."safeErrorCode" IS NOT NULL
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_TRANSITION_INVALID'; END IF;
  PERFORM set_config('app.actor_id','snapshot-ack-rotation',true);
  PERFORM snapshot_ack_rotation_live_request(NEW."organizationId",NEW."projectId",NEW.id);
  SELECT * INTO proof FROM snapshot_ack_rotation_operation_proof(NEW."organizationId",NEW."projectId",NEW.id);
  IF NOT FOUND OR proof.phase<>NEW."ackRotationPhase" OR proof."previousCredentialVersion"<>NEW."ackCredentialVersion"
    OR NEW."finishedAt"<proof."createdAt" OR NEW.result IS DISTINCT FROM jsonb_build_object('action','ACK_ROTATE','phase',proof.phase,
      'previousCredentialVersion',proof."previousCredentialVersion",'credentialVersion',proof."credentialVersion")
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_RESULT_INVALID'; END IF;
  PERFORM set_config('app.actor_id','operations-executor',true); RETURN NEW;
END $$;
DROP TRIGGER "OperationalActionRequest_lifecycle_update_guard" ON "OperationalActionRequest";
CREATE TRIGGER "OperationalActionRequest_lifecycle_update_guard" BEFORE UPDATE ON "OperationalActionRequest"
  FOR EACH ROW WHEN (NEW.status<>'FAILED' AND NOT (NEW.status='SUCCEEDED'
    AND NEW.action IN ('SNAPSHOT_BUILD','SNAPSHOT_PUBLISH','SNAPSHOT_ROLLBACK','ACK_ROTATE')))
  EXECUTE FUNCTION operational_action_lifecycle_guard();
CREATE TRIGGER "OperationalActionRequest_ack_rotation_success_guard" BEFORE UPDATE ON "OperationalActionRequest"
  FOR EACH ROW WHEN (NEW.status='SUCCEEDED' AND NEW.action='ACK_ROTATE') EXECUTE FUNCTION operational_ack_rotation_success_guard();
COMMIT;
