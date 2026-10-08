BEGIN;
CREATE TABLE "SourceManualApprovalReceipt" (
  "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "requestHash" CHAR(64) NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  "sourceVersion" INTEGER NOT NULL CHECK ("sourceVersion">0), "safetyPolicyVersion" INTEGER CHECK ("safetyPolicyVersion">0),
  "baseLastGoodRevisionId" TEXT, "previousGoodRecordCount" INTEGER CHECK ("previousGoodRecordCount">=0),
  "policy" JSONB NOT NULL CHECK (octet_length("policy"::text)<=4096),
  "originalAnalysis" JSONB NOT NULL CHECK (octet_length("originalAnalysis"::text)<=4096),
  "reviewedAnalysis" JSONB NOT NULL CHECK (octet_length("reviewedAnalysis"::text)<=4096),
  "sequence" INTEGER NOT NULL CHECK ("sequence">0), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("organizationId","projectId","revisionId"), UNIQUE ("organizationId","projectId","requestId"),
  UNIQUE ("organizationId","projectId","sourceId","revisionId"),
  FOREIGN KEY ("organizationId","projectId","requestId") REFERENCES "OperationalActionRequest"("organizationId","projectId","id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("organizationId","projectId","sourceId","revisionId") REFERENCES "SourceRevision"("organizationId","projectId","sourceId","id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
ALTER TABLE "SourceManualApprovalReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SourceManualApprovalReceipt" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SourceManualApprovalReceipt_rls" ON "SourceManualApprovalReceipt" FOR SELECT TO PUBLIC
  USING (source_runtime_scope("organizationId","projectId") OR snapshot_input_scope("organizationId","projectId")
    OR snapshot_publication_scope("organizationId","projectId"));
CREATE POLICY "SourceManualApprovalReceipt_insert" ON "SourceManualApprovalReceipt" FOR INSERT TO PUBLIC
  WITH CHECK (source_runtime_scope("organizationId","projectId") AND current_setting('app.actor_id',true)='source-import');
GRANT SELECT ON "SourceManualApprovalReceipt" TO ams_data_hub_web,ams_data_hub_backup;
GRANT SELECT,INSERT ON "SourceManualApprovalReceipt" TO ams_data_hub_worker;

-- Fixed actor bridge preserves org/project. The actual accepted request and
-- complete PROCESSING/RUNNING lease are locked, never supplied by a receipt caller.
CREATE FUNCTION source_manual_approval_request(org TEXT, project TEXT, source TEXT, revision TEXT, request TEXT)
RETURNS "OperationalActionRequest" LANGUAGE plpgsql AS $$
DECLARE q "OperationalActionRequest";
BEGIN
  IF current_setting('app.principal_kind',true) IS DISTINCT FROM 'project-job'
    OR current_setting('app.actor_id',true) IS DISTINCT FROM 'source-import'
    OR NULLIF(current_setting('app.organization_id',true),'') IS DISTINCT FROM org
    OR NULLIF(current_setting('app.project_ids',true),'') IS DISTINCT FROM project
    OR project='*' OR project LIKE '%,%' OR request IS NULL
  THEN RAISE EXCEPTION 'SOURCE_OPERATION_APPROVAL_INVALID'; END IF;
  PERFORM set_config('app.actor_id','operations-executor',true);
  SELECT * INTO q FROM "OperationalActionRequest" WHERE id=request AND "organizationId"=org AND "projectId"=project
    AND "sourceId"=source AND "sourceRevisionId"=revision AND action='SUSPICIOUS_APPROVE' AND status='RUNNING';
  IF NOT FOUND OR q."reason" IS NULL OR q."requestedBy" IS NULL OR q."leaseJobRunId" IS NULL
    OR q."leaseAttempt" IS NULL OR q."leaseWorkerId" IS NULL OR q."leaseAcquiredAt" IS NULL
  THEN RAISE EXCEPTION 'SOURCE_OPERATION_APPROVAL_INVALID'; END IF;
  PERFORM e.id FROM "OutboxEvent" e WHERE e.id=q."outboxEventId" AND e."organizationId"=org AND e.status='PROCESSING'
    AND e."schemaVersion"=1 AND e.topic='operations-control.suspicious.approve.request' AND e.attempts=q."leaseAttempt"
    AND e."lockedBy"=q."leaseWorkerId" AND e."lockedAt"=q."leaseAcquiredAt"
    AND e.payload=jsonb_build_object('schemaVersion',1,'organizationId',org,'projectId',project,'requestId',request,'action','SUSPICIOUS_APPROVE') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUTBOX_OPERATION_LEASE_LOST'; END IF;
  PERFORM j.id FROM "JobRun" j JOIN "OutboxEvent" e ON e.id=j."outboxEventId" WHERE j.id=q."leaseJobRunId"
    AND j."outboxEventId"=q."outboxEventId" AND j."organizationId"=org AND j.status='RUNNING'
    AND j.attempt=q."leaseAttempt" AND j."workerId"=q."leaseWorkerId" AND j."startedAt"=q."leaseAcquiredAt"
    AND j."jobType"=e.topic AND j."correlationId"=e."correlationId" FOR UPDATE OF j;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUTBOX_OPERATION_LEASE_LOST'; END IF;
  PERFORM id FROM "OperationalActionRequest" WHERE id=q.id FOR UPDATE;
  PERFORM set_config('app.actor_id','source-import',true); RETURN q;
END $$;

CREATE OR REPLACE FUNCTION protect_good_source_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE q "OperationalActionRequest"; baseline "SourceRevision"; current_source "Source";
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.status='GOOD') THEN RAISE EXCEPTION 'SOURCE_REVISION_IMMUTABLE'; END IF;
  IF NEW.status='GOOD' THEN
    IF TG_OP<>'UPDATE' OR OLD.status NOT IN ('STAGED','SUSPICIOUS') THEN RAISE EXCEPTION 'SOURCE_REVISION_TRANSITION_INVALID'; END IF;
    IF (SELECT count(*) FROM "SourceRevisionRecord" WHERE "revisionId"=NEW.id)<>NEW."recordCount" THEN RAISE EXCEPTION 'SOURCE_REVISION_COUNT_MISMATCH'; END IF;
    IF OLD.status='SUSPICIOUS' THEN
      q:=source_manual_approval_request(NEW."organizationId",NEW."projectId",NEW."sourceId",NEW.id,NULLIF(current_setting('app.source_approval_request_id',true),''));
      SELECT * INTO current_source FROM "Source" WHERE id=NEW."sourceId" AND "organizationId"=NEW."organizationId" AND "projectId"=NEW."projectId";
      IF NEW."baseLastGoodRevisionId" IS NOT NULL THEN
        SELECT * INTO baseline FROM "SourceRevision" WHERE id=NEW."baseLastGoodRevisionId" AND "sourceId"=NEW."sourceId"
          AND "organizationId"=NEW."organizationId" AND "projectId"=NEW."projectId" AND status='GOOD';
        IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_OPERATION_APPROVAL_INVALID'; END IF;
      END IF;
      IF current_source.id IS NULL OR NOT current_source.enabled OR current_source.version<>OLD."sourceVersion"
        OR current_source."lastGoodRevisionId" IS DISTINCT FROM OLD."baseLastGoodRevisionId"
        OR NEW.sequence IS DISTINCT FROM COALESCE(baseline.sequence,0)+1 OR NEW."invalidRecordCount"<>0
        OR OLD."safetyAnalysis"->>'disposition' IS DISTINCT FROM 'SUSPICIOUS'
        OR OLD."safetyAnalysis"->'metrics'->>'criticalIssueCount' IS DISTINCT FROM '0'
        OR NEW."safetyAnalysis"->>'disposition' IS DISTINCT FROM 'APPROVED' OR NEW."completedAt" IS NULL
        OR to_jsonb(NEW)-ARRAY['status','sequence','safetyAnalysis','completedAt']<>to_jsonb(OLD)-ARRAY['status','sequence','safetyAnalysis','completedAt']
        OR NEW."safetyAnalysis"-ARRAY['disposition','review'] IS DISTINCT FROM OLD."safetyAnalysis"-ARRAY['disposition','review']
        OR NEW."safetyAnalysis"->'review' IS DISTINCT FROM jsonb_build_object('reviewedBy',q."requestedBy",'reason',q.reason,
          'reviewedAt',to_char(NEW."completedAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      THEN RAISE EXCEPTION 'SOURCE_OPERATION_APPROVAL_INVALID'; END IF;
      IF NOT EXISTS (SELECT 1 FROM "Project" WHERE id=NEW."projectId" AND "organizationId"=NEW."organizationId" AND status='ACTIVE' AND "serviceState"='ACTIVE')
        OR NOT EXISTS (SELECT 1 FROM "DataSafetyState" WHERE id='global' AND NOT "jobsFrozen")
        OR (current_source."safetyPolicyId" IS NULL AND NEW."safetyPolicyVersion" IS NOT NULL)
        OR (current_source."safetyPolicyId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SourceSafetyPolicy" p WHERE p.id=current_source."safetyPolicyId"
          AND p."organizationId"=NEW."organizationId" AND p."projectId"=NEW."projectId" AND p.version=NEW."safetyPolicyVersion"
          AND CASE WHEN jsonb_typeof(p.policy)='object' AND octet_length(p.policy::text)<=4096 THEN
            (SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(p.policy)
              WHERE key IN ('maxRawArtifactBytes','allowEmpty','maxDropPercent','requireManualApprovalAboveDrop','deactivationEnabled',
                'inactiveAfterMissingGoodRuns','inactiveAfterMissingHours','sourceOverdueAfterHours','ackStaleAfterHours',
                'minRecordCount','maxRecordCount','maxGrowthPercent','maxInvalidPercent'))=NEW."safetyPolicy" ELSE FALSE END))
        OR EXISTS (SELECT 1 FROM "SourceRevisionRecord" record LEFT JOIN "InventoryIdentity" i ON i.uid=record."inventoryUid"
          AND i."organizationId"=record."organizationId" AND i."projectId"=record."projectId" AND i."sourceId"=record."sourceId" AND i."externalOfferId"=record."externalId"
          LEFT JOIN "SourceManualApprovalMutation" m ON m."organizationId"=record."organizationId" AND m."projectId"=record."projectId" AND m."requestId"=q.id AND m."inventoryUid"=i.uid
          WHERE record."revisionId"=NEW.id AND (i.uid IS NULL OR i.status<>'ACTIVE' OR i."normalizedHash"<>record."recordHash" OR i."sourceHash"<>NEW."rawArtifactHash"
            OR i."lastSeenAt"<>NEW."startedAt" OR i."missingGoodRuns"<>0 OR i."missingSince" IS NOT NULL OR m."afterState" IS DISTINCT FROM to_jsonb(i)))
        OR (NEW."baseLastGoodRevisionId" IS NOT NULL AND NEW."recordCount">0 AND EXISTS (SELECT 1 FROM "InventoryIdentity" i
          WHERE i."organizationId"=NEW."organizationId" AND i."projectId"=NEW."projectId" AND i."sourceId"=NEW."sourceId" AND i.status='ACTIVE'
            AND NOT EXISTS (SELECT 1 FROM "SourceRevisionRecord" record WHERE record."revisionId"=NEW.id AND record."externalId"=i."externalOfferId")
            AND NOT EXISTS (SELECT 1 FROM "SourceManualApprovalMutation" m WHERE m."organizationId"=NEW."organizationId" AND m."projectId"=NEW."projectId" AND m."requestId"=q.id AND m."inventoryUid"=i.uid)))
        OR EXISTS (SELECT 1 FROM "SourceManualApprovalMutation" m LEFT JOIN "InventoryIdentity" i ON i.uid=m."inventoryUid" AND i."organizationId"=m."organizationId" AND i."projectId"=m."projectId"
          WHERE m."organizationId"=NEW."organizationId" AND m."projectId"=NEW."projectId" AND m."requestId"=q.id
            AND (m."afterState" IS DISTINCT FROM to_jsonb(i) OR (m."beforeState"->>'status' IS DISTINCT FROM m."afterState"->>'status'
              AND m."beforeState" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "InventoryLifecycleEvent" e WHERE e."organizationId"=m."organizationId" AND e."projectId"=m."projectId"
                AND e."inventoryUid"=m."inventoryUid" AND e."occurredAt"=NEW."startedAt" AND e.type::text=CASE WHEN m."afterState"->>'status'='ACTIVE' THEN 'REACTIVATED' ELSE 'INACTIVATED' END))))
      THEN RAISE EXCEPTION 'SOURCE_APPROVAL_APPLY_INVALID'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION source_manual_approval_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' OR pg_trigger_depth()<>2 OR current_setting('app.actor_id',true) IS DISTINCT FROM 'source-import'
    OR NEW."requestId" IS DISTINCT FROM NULLIF(current_setting('app.source_approval_request_id',true),'')
  THEN RAISE EXCEPTION 'SOURCE_APPROVAL_RECEIPT_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TABLE "SourceManualApprovalMutation" (
  "organizationId" TEXT NOT NULL,"projectId" TEXT NOT NULL,"requestId" TEXT NOT NULL,"inventoryUid" VARCHAR(26) NOT NULL,
  "beforeState" JSONB CHECK (octet_length("beforeState"::text)<=4096),"afterState" JSONB NOT NULL CHECK (octet_length("afterState"::text)<=4096),
  PRIMARY KEY ("organizationId","projectId","requestId","inventoryUid"),
  FOREIGN KEY ("organizationId","projectId","requestId") REFERENCES "OperationalActionRequest"("organizationId","projectId","id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
ALTER TABLE "SourceManualApprovalMutation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SourceManualApprovalMutation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SourceManualApprovalMutation_rls" ON "SourceManualApprovalMutation" FOR SELECT TO PUBLIC USING (source_runtime_scope("organizationId","projectId"));
CREATE POLICY "SourceManualApprovalMutation_insert" ON "SourceManualApprovalMutation" FOR INSERT TO PUBLIC
  WITH CHECK (source_runtime_scope("organizationId","projectId") AND current_setting('app.actor_id',true)='source-import');
GRANT SELECT ON "SourceManualApprovalMutation" TO ams_data_hub_web,ams_data_hub_backup;
GRANT SELECT,INSERT ON "SourceManualApprovalMutation" TO ams_data_hub_worker;
CREATE TRIGGER "SourceManualApprovalMutation_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "SourceManualApprovalMutation"
  FOR EACH ROW EXECUTE FUNCTION source_manual_approval_receipt_guard();
CREATE FUNCTION source_manual_approval_inventory_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q "OperationalActionRequest"; r "SourceRevision"; record "SourceRevisionRecord"; expected_status "InventoryLifecycleStatus";
BEGIN
  IF current_setting('app.actor_id',true) IS DISTINCT FROM 'source-import'
    OR NULLIF(current_setting('app.source_approval_request_id',true),'') IS NULL THEN RETURN NEW; END IF;
  q:=source_manual_approval_request(NEW."organizationId",NEW."projectId",NEW."sourceId",NULLIF(current_setting('app.source_approval_revision_id',true),''),NULLIF(current_setting('app.source_approval_request_id',true),''));
  SELECT * INTO r FROM "SourceRevision" WHERE id=q."sourceRevisionId" AND "organizationId"=NEW."organizationId" AND "projectId"=NEW."projectId" AND "sourceId"=NEW."sourceId" AND status='SUSPICIOUS';
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_APPROVAL_APPLY_INVALID'; END IF;
  SELECT * INTO record FROM "SourceRevisionRecord" WHERE "revisionId"=r.id AND "externalId"=NEW."externalOfferId";
  IF FOUND THEN
    IF NEW.uid<>record."inventoryUid" OR NEW.status<>'ACTIVE' OR NEW."normalizedHash"<>record."recordHash" OR NEW."sourceHash"<>r."rawArtifactHash"
      OR NEW."lastSeenAt"<>r."startedAt" OR NEW."missingGoodRuns"<>0 OR NEW."missingSince" IS NOT NULL
      OR (TG_OP='INSERT' AND (NEW.version<>1 OR NEW."firstSeenAt"<>r."startedAt"))
      OR (TG_OP='UPDATE' AND (NEW.version<>OLD.version+1 OR OLD."lastSeenAt">r."startedAt"
        OR to_jsonb(NEW)-ARRAY['status','lastSeenAt','missingGoodRuns','missingSince','sourceHash','normalizedHash','version','updatedAt']
          <>to_jsonb(OLD)-ARRAY['status','lastSeenAt','missingGoodRuns','missingSince','sourceHash','normalizedHash','version','updatedAt']))
    THEN RAISE EXCEPTION 'SOURCE_APPROVAL_APPLY_INVALID'; END IF;
  ELSE
    IF TG_OP<>'UPDATE' OR OLD.status<>'ACTIVE' OR r."baseLastGoodRevisionId" IS NULL OR r."recordCount"=0
      OR OLD."lastSeenAt">r."startedAt" OR NEW."missingGoodRuns"<>OLD."missingGoodRuns"+1
      OR NEW."missingSince" IS DISTINCT FROM COALESCE(OLD."missingSince",r."startedAt") OR NEW.version<>OLD.version+1
      OR to_jsonb(NEW)-ARRAY['status','missingGoodRuns','missingSince','version','updatedAt']<>to_jsonb(OLD)-ARRAY['status','missingGoodRuns','missingSince','version','updatedAt']
    THEN RAISE EXCEPTION 'SOURCE_APPROVAL_APPLY_INVALID'; END IF;
    expected_status:=CASE WHEN (r."safetyPolicy"->>'deactivationEnabled')::boolean
      AND NEW."missingGoodRuns">=(r."safetyPolicy"->>'inactiveAfterMissingGoodRuns')::integer
      AND EXTRACT(EPOCH FROM (r."startedAt"-NEW."missingSince"))/3600>=(r."safetyPolicy"->>'inactiveAfterMissingHours')::numeric
      THEN 'INACTIVE'::"InventoryLifecycleStatus" ELSE 'ACTIVE'::"InventoryLifecycleStatus" END;
    IF NEW.status<>expected_status THEN RAISE EXCEPTION 'SOURCE_APPROVAL_APPLY_INVALID'; END IF;
  END IF;
  INSERT INTO "SourceManualApprovalMutation" ("organizationId","projectId","requestId","inventoryUid","beforeState","afterState")
    VALUES (NEW."organizationId",NEW."projectId",q.id,NEW.uid,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
  RETURN NEW;
END $$;
CREATE TRIGGER "InventoryIdentity_manual_approval_record" AFTER INSERT OR UPDATE ON "InventoryIdentity"
  FOR EACH ROW EXECUTE FUNCTION source_manual_approval_inventory_record();
CREATE TRIGGER "SourceManualApprovalReceipt_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "SourceManualApprovalReceipt"
  FOR EACH ROW EXECUTE FUNCTION source_manual_approval_receipt_guard();
CREATE FUNCTION source_manual_approval_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q "OperationalActionRequest"; previous_count INTEGER;
BEGIN
  IF OLD.status='SUSPICIOUS' AND NEW.status='GOOD' THEN
    q:=source_manual_approval_request(NEW."organizationId",NEW."projectId",NEW."sourceId",NEW.id,NULLIF(current_setting('app.source_approval_request_id',true),''));
    SELECT "recordCount" INTO previous_count FROM "SourceRevision" WHERE id=OLD."baseLastGoodRevisionId" AND "sourceId"=OLD."sourceId"
      AND "organizationId"=OLD."organizationId" AND "projectId"=OLD."projectId" AND status='GOOD';
    INSERT INTO "SourceManualApprovalReceipt" ("organizationId","projectId","sourceId","revisionId","requestId","requestHash",
      "sourceVersion","safetyPolicyVersion","baseLastGoodRevisionId","previousGoodRecordCount",policy,"originalAnalysis","reviewedAnalysis",sequence)
    VALUES (NEW."organizationId",NEW."projectId",NEW."sourceId",NEW.id,q.id,q."requestHash",OLD."sourceVersion",OLD."safetyPolicyVersion",
      OLD."baseLastGoodRevisionId",previous_count,OLD."safetyPolicy",OLD."safetyAnalysis",NEW."safetyAnalysis",NEW.sequence);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SourceRevision_manual_approval_receipt" AFTER UPDATE ON "SourceRevision"
  FOR EACH ROW EXECUTE FUNCTION source_manual_approval_record();
CREATE FUNCTION source_manual_approval_operation_proof(org TEXT, project TEXT, source TEXT, revision TEXT, request TEXT)
RETURNS TABLE (sequence INTEGER,"createdAt" TIMESTAMPTZ) LANGUAGE SQL STABLE AS $$
  SELECT p.sequence,p."createdAt" FROM "SourceManualApprovalReceipt" p JOIN "SourceRevision" r ON r.id=p."revisionId"
    AND r."organizationId"=p."organizationId" AND r."projectId"=p."projectId" AND r."sourceId"=p."sourceId"
  WHERE source_runtime_scope(org,project) AND current_setting('app.actor_id',true)='source-import'
    AND p."organizationId"=org AND p."projectId"=project AND p."sourceId"=source AND p."revisionId"=revision AND p."requestId"=request
    AND r.status='GOOD' AND r.sequence=p.sequence AND r."safetyPolicy"=p.policy AND r."safetyAnalysis"=p."reviewedAnalysis"
    AND r."baseLastGoodRevisionId" IS NOT DISTINCT FROM p."baseLastGoodRevisionId"
    AND r."sourceVersion"=p."sourceVersion" AND r."safetyPolicyVersion" IS NOT DISTINCT FROM p."safetyPolicyVersion"
$$;
CREATE FUNCTION operational_source_approval_success_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof RECORD;
BEGIN
  IF pg_trigger_depth()>1 AND OLD."outboxEventId" IS NOT NULL AND NEW."outboxEventId" IS NULL
    AND to_jsonb(NEW)-'outboxEventId'=to_jsonb(OLD)-'outboxEventId' THEN RETURN NEW; END IF;
  IF operational_executor_scope(NEW."organizationId",NEW."projectId") IS DISTINCT FROM TRUE OR OLD.status<>'RUNNING'
    OR to_jsonb(NEW)-ARRAY['status','finishedAt','result','updatedAt']<>to_jsonb(OLD)-ARRAY['status','finishedAt','result','updatedAt']
    OR NEW."finishedAt" IS NULL OR NEW."startedAt" IS NULL OR NEW."finishedAt"<NEW."startedAt" OR NEW."safeErrorCode" IS NOT NULL
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_TRANSITION_INVALID'; END IF;
  PERFORM set_config('app.actor_id','source-import',true);
  PERFORM source_manual_approval_request(NEW."organizationId",NEW."projectId",NEW."sourceId",NEW."sourceRevisionId",NEW.id);
  SELECT * INTO proof FROM source_manual_approval_operation_proof(NEW."organizationId",NEW."projectId",NEW."sourceId",NEW."sourceRevisionId",NEW.id);
  IF NOT FOUND OR NEW."finishedAt"<proof."createdAt" OR NEW.result IS DISTINCT FROM jsonb_build_object('action','SUSPICIOUS_APPROVE',
    'sourceRevisionId',NEW."sourceRevisionId",'sequence',proof.sequence,'snapshotTriggered',true)
    OR NOT EXISTS (SELECT 1 FROM "Source" WHERE id=NEW."sourceId" AND "organizationId"=NEW."organizationId" AND "projectId"=NEW."projectId" AND "lastGoodRevisionId"=NEW."sourceRevisionId")
    OR NOT EXISTS (SELECT 1 FROM "OutboxEvent" WHERE "organizationId"=NEW."organizationId" AND topic='snapshot.build.request'
      AND payload=jsonb_build_object('schemaVersion',1,'organizationId',NEW."organizationId",'projectId',NEW."projectId",
        'sourceId',NEW."sourceId",'sourceRevisionId',NEW."sourceRevisionId",'sourceRevisionSequence',proof.sequence))
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_RESULT_INVALID'; END IF;
  PERFORM set_config('app.actor_id','operations-executor',true); RETURN NEW;
END $$;
DROP TRIGGER "OperationalActionRequest_lifecycle_update_guard" ON "OperationalActionRequest";
CREATE TRIGGER "OperationalActionRequest_lifecycle_update_guard" BEFORE UPDATE ON "OperationalActionRequest"
  FOR EACH ROW WHEN (NEW.status<>'FAILED' AND NOT (NEW.status='SUCCEEDED'
    AND NEW.action IN ('SNAPSHOT_BUILD','SNAPSHOT_PUBLISH','SNAPSHOT_ROLLBACK','ACK_ROTATE','SUSPICIOUS_APPROVE')))
  EXECUTE FUNCTION operational_action_lifecycle_guard();
CREATE TRIGGER "OperationalActionRequest_source_approval_success_guard" BEFORE UPDATE ON "OperationalActionRequest"
  FOR EACH ROW WHEN (NEW.status='SUCCEEDED' AND NEW.action='SUSPICIOUS_APPROVE') EXECUTE FUNCTION operational_source_approval_success_guard();
COMMIT;
