BEGIN;
-- Forward-only narrow metadata proof; no private facts, new grants or historical rewrites.
CREATE FUNCTION snapshot_rollback_operation_proof(org TEXT, project TEXT, request TEXT, source_sequence INTEGER)
RETURNS TABLE ("sourceDeliveryRunId" TEXT, "deliveryRunId" TEXT, "manifestSha256" TEXT,
  "publishSequence" INTEGER, "stagedAt" TIMESTAMPTZ, "publishedAt" TIMESTAMPTZ)
LANGUAGE SQL STABLE AS $$
  SELECT v."sourceDeliveryRunId", r.id, b."manifestSha256"::text, v."publishSequence", b."stagedAt", r."publishedAt"
  FROM "SnapshotRollbackReservation" v
  JOIN "SnapshotRollbackBinding" b ON (b."organizationId",b."projectId",b."requestId")=(v."organizationId",v."projectId",v."requestId")
  JOIN "SnapshotBuildInput" i ON (i."organizationId",i."projectId",i.id)=(v."organizationId",v."projectId",v."rootBuildInputId")
  JOIN "DeliveryRun" r ON (r."organizationId",r."projectId",r."publishSequence")=(v."organizationId",v."projectId",v."publishSequence")
  JOIN LATERAL snapshot_rollback_approved_source(org,project,source_sequence) s
    ON (s."sourceDeliveryRunId",s."rootBuildInputId",s."inputHash")=(v."sourceDeliveryRunId",v."rootBuildInputId",v."inputHash")
  WHERE snapshot_publication_scope(org,project) AND v."organizationId"=org AND v."projectId"=project AND v."requestId"=request
    AND v."sourcePublishSequence"=source_sequence AND v."publishSequence">source_sequence
    AND v."inputHash"=i."inputHash" AND b."publishSequence"=v."publishSequence" AND b."stagedAt" IS NOT NULL
    AND r."manifestSha256"=b."manifestSha256" AND r."manifestKey"='snapshots/' || project || '/' || b."manifestSha256"
    AND r."publishedAt"=v."createdAt"
$$;

-- Before any request rows, preserve global -> publication -> input ordering even
-- for direct executor SQL. Other writer tables/roles keep their existing locks.
CREATE FUNCTION lock_operational_snapshot_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org TEXT := NULLIF(current_setting('app.organization_id',true),'');
  project TEXT := NULLIF(current_setting('app.project_ids',true),'');
BEGIN
  IF operational_executor_scope(org,project) IS TRUE THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0));
    PERFORM pg_advisory_xact_lock(hashtextextended('["snapshot-publication",' || to_json(org)::text || ',' || to_json(project)::text || ']',0));
    PERFORM pg_advisory_xact_lock(hashtextextended('["snapshot-input",' || to_json(org)::text || ',' || to_json(project)::text || ']',0));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "OperationalActionRequest_snapshot_writer_lock" BEFORE UPDATE ON "OperationalActionRequest"
  FOR EACH STATEMENT EXECUTE FUNCTION lock_operational_snapshot_writer();

DROP TRIGGER "OperationalActionRequest_lifecycle_update_guard" ON "OperationalActionRequest";
CREATE TRIGGER "OperationalActionRequest_lifecycle_update_guard" BEFORE UPDATE ON "OperationalActionRequest"
  FOR EACH ROW WHEN (NEW."status" <> 'FAILED' AND NOT (NEW."status"='SUCCEEDED'
    AND NEW."action" IN ('SNAPSHOT_BUILD','SNAPSHOT_PUBLISH','SNAPSHOT_ROLLBACK')))
  EXECUTE FUNCTION operational_action_lifecycle_guard();

CREATE FUNCTION operational_snapshot_rollback_success_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof RECORD;
BEGIN
  IF pg_trigger_depth()>1 AND OLD."outboxEventId" IS NOT NULL AND NEW."outboxEventId" IS NULL
    AND to_jsonb(NEW)-'outboxEventId'=to_jsonb(OLD)-'outboxEventId' THEN RETURN NEW; END IF;
  IF operational_executor_scope(NEW."organizationId",NEW."projectId") IS DISTINCT FROM TRUE OR OLD."status"<>'RUNNING'
    OR to_jsonb(NEW)-ARRAY['status','finishedAt','result','updatedAt'] <> to_jsonb(OLD)-ARRAY['status','finishedAt','result','updatedAt']
    OR NEW."sourcePublishSequence" IS NULL OR NEW."startedAt" IS NULL OR NEW."finishedAt" IS NULL
    OR NEW."finishedAt"<NEW."startedAt" OR NEW."safeErrorCode" IS NOT NULL
    OR NEW."leaseJobRunId" IS NULL OR NEW."leaseAttempt" IS NULL OR NEW."leaseAttempt"<1
    OR NEW."leaseWorkerId" IS NULL OR NEW."leaseAcquiredAt" IS NULL
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_TRANSITION_INVALID'; END IF;
  PERFORM set_config('app.actor_id','snapshot-publication',true);
  -- OLD is still RUNNING during BEFORE UPDATE. This checks the entire accepted
  -- request + IDs-only PROCESSING outbox + actual RUNNING JobRun tuple.
  PERFORM snapshot_rollback_live_lease(NEW."organizationId",NEW."projectId",NEW.id,NEW."sourcePublishSequence",
    NEW."leaseJobRunId",NEW."leaseAttempt",NEW."leaseWorkerId",NEW."leaseAcquiredAt");
  SELECT * INTO proof FROM snapshot_rollback_operation_proof(NEW."organizationId",NEW."projectId",NEW.id,NEW."sourcePublishSequence");
  IF NOT FOUND OR NEW."finishedAt"<proof."stagedAt" OR NEW."finishedAt"<proof."publishedAt"
    OR NEW."result" IS DISTINCT FROM jsonb_build_object('action','SNAPSHOT_ROLLBACK',
      'sourcePublishSequence',NEW."sourcePublishSequence",'sourceDeliveryRunId',proof."sourceDeliveryRunId",
      'deliveryRunId',proof."deliveryRunId",'publishSequence',proof."publishSequence",'manifestSha256',proof."manifestSha256")
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_RESULT_INVALID'; END IF;
  PERFORM set_config('app.actor_id','operations-executor',true);
  RETURN NEW;
END $$;
CREATE TRIGGER "OperationalActionRequest_snapshot_rollback_success_guard" BEFORE UPDATE ON "OperationalActionRequest"
  FOR EACH ROW WHEN (NEW."status"='SUCCEEDED' AND NEW."action"='SNAPSHOT_ROLLBACK')
  EXECUTE FUNCTION operational_snapshot_rollback_success_guard();
COMMIT;
