-- Forward-only: exact selected-stage PUBLISH, with unchanged roles/grants and
-- immutable historical requests. A fixed actor bridge reads snapshot-owned
-- binding/header metadata only after the original exact Ops scope is proved.
DROP TRIGGER "OperationalActionRequest_lifecycle_update_guard" ON "OperationalActionRequest";
CREATE TRIGGER "OperationalActionRequest_lifecycle_update_guard" BEFORE UPDATE ON "OperationalActionRequest"
  FOR EACH ROW WHEN (NEW."status" <> 'FAILED'
    AND NOT (NEW."status" = 'SUCCEEDED' AND NEW."action" IN ('SNAPSHOT_BUILD', 'SNAPSHOT_PUBLISH')))
  EXECUTE FUNCTION operational_action_lifecycle_guard();

CREATE FUNCTION operational_snapshot_publish_success_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_id TEXT; job_id TEXT; valid_result BOOLEAN;
BEGIN
  IF pg_trigger_depth() > 1 AND OLD."outboxEventId" IS NOT NULL AND NEW."outboxEventId" IS NULL
    AND to_jsonb(NEW) - 'outboxEventId' = to_jsonb(OLD) - 'outboxEventId' THEN RETURN NEW; END IF;
  IF NOT operational_executor_scope(NEW."organizationId", NEW."projectId") OR OLD."status" <> 'RUNNING'
    OR to_jsonb(NEW) - ARRAY['status','finishedAt','result','updatedAt']
       <> to_jsonb(OLD) - ARRAY['status','finishedAt','result','updatedAt']
    OR NEW."buildInputId" IS NULL OR NEW."startedAt" IS NULL OR NEW."finishedAt" IS NULL
    OR NEW."finishedAt" < NEW."startedAt" OR NEW."safeErrorCode" IS NOT NULL
    OR NEW."leaseJobRunId" IS NULL OR NEW."leaseAttempt" IS NULL OR NEW."leaseAttempt" < 1
    OR NEW."leaseWorkerId" IS NULL OR NEW."leaseAcquiredAt" IS NULL
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_TRANSITION_INVALID'; END IF;
  SELECT e."id" INTO event_id FROM "OutboxEvent" e WHERE e."id" = NEW."outboxEventId"
    AND e."organizationId" = NEW."organizationId" AND e."status" = 'PROCESSING' AND e."schemaVersion" = 1
    AND e."attempts" = NEW."leaseAttempt" AND e."lockedBy" = NEW."leaseWorkerId" AND e."lockedAt" = NEW."leaseAcquiredAt"
    AND e."topic" = 'operations-control.snapshot.publish.request'
    AND e."payload" = jsonb_build_object('schemaVersion', 1, 'organizationId', NEW."organizationId",
      'projectId', NEW."projectId", 'requestId', NEW."id", 'action', 'SNAPSHOT_PUBLISH') FOR UPDATE;
  SELECT j."id" INTO job_id FROM "JobRun" j JOIN "OutboxEvent" e ON e."id" = j."outboxEventId"
    WHERE j."id" = NEW."leaseJobRunId" AND j."outboxEventId" = event_id AND j."organizationId" = NEW."organizationId"
      AND j."attempt" = NEW."leaseAttempt" AND j."workerId" = NEW."leaseWorkerId" AND j."startedAt" = NEW."leaseAcquiredAt"
      AND j."status" = 'RUNNING' AND j."jobType" = e."topic" AND j."correlationId" = e."correlationId" FOR UPDATE OF j;
  IF event_id IS NULL OR job_id IS NULL THEN RAISE EXCEPTION 'OUTBOX_OPERATION_LEASE_LOST'; END IF;
  PERFORM set_config('app.actor_id', 'snapshot-publication', true);
  SELECT EXISTS (SELECT 1 FROM "SnapshotArtifactStageReceipt" s
    JOIN "SnapshotPublicationBinding" b ON b."organizationId" = s."organizationId"
      AND b."projectId" = s."projectId" AND b."buildInputId" = s."buildInputId"
    JOIN "SnapshotBuildInput" i ON i."organizationId" = s."organizationId"
      AND i."projectId" = s."projectId" AND i."id" = s."buildInputId"
    JOIN "DeliveryRun" r ON r."organizationId" = s."organizationId" AND r."projectId" = s."projectId"
      AND r."publishSequence" = s."publishSequence"
    WHERE s."organizationId" = NEW."organizationId" AND s."projectId" = NEW."projectId"
      AND s."buildInputId" = NEW."buildInputId"
      AND s."inputHash" = i."inputHash" AND b."inputHash" = i."inputHash"
      AND s."idempotencyKeyHash" = i."idempotencyKeyHash"
      AND (s."requestHash" IS NULL OR s."requestHash" = i."requestHash")
      AND s."publishSequence" = i."publishSequence" AND b."publishSequence" = i."publishSequence"
      AND s."manifestSha256" = b."manifestSha256" AND r."manifestSha256" = b."manifestSha256"
      AND r."manifestKey" = 'snapshots/' || NEW."projectId" || '/' || b."manifestSha256"
      AND r."publishedAt" = i."capturedAt" AND NEW."finishedAt" >= s."stagedAt"
      AND NEW."finishedAt" >= r."publishedAt"
      AND NEW."result" = jsonb_build_object('action', 'SNAPSHOT_PUBLISH', 'buildInputId', s."buildInputId",
        'deliveryRunId', r."id", 'publishSequence', s."publishSequence", 'manifestSha256', s."manifestSha256"))
    INTO valid_result;
  PERFORM set_config('app.actor_id', 'operations-executor', true);
  IF NOT valid_result THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_RESULT_INVALID'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "OperationalActionRequest_snapshot_publish_success_guard" BEFORE UPDATE ON "OperationalActionRequest"
  FOR EACH ROW WHEN (NEW."status" = 'SUCCEEDED' AND NEW."action" = 'SNAPSHOT_PUBLISH')
  EXECUTE FUNCTION operational_snapshot_publish_success_guard();
