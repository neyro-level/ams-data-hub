-- Older non-operational stage receipts stay immutable and replayable; do not
-- backfill/rewrite them. New INSERTs must pin the exact complete capture request.
ALTER TABLE "SnapshotArtifactStageReceipt" ADD COLUMN "requestHash" CHAR(64)
  CHECK ("requestHash" IS NULL OR "requestHash" ~ '^[a-f0-9]{64}$');
CREATE OR REPLACE FUNCTION protect_snapshot_artifact_stage_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'SNAPSHOT_STAGE_RECEIPT_IMMUTABLE'; END IF;
  IF NOT snapshot_publication_scope(NEW."organizationId", NEW."projectId")
    THEN RAISE EXCEPTION 'SNAPSHOT_STAGE_SCOPE_DENIED'; END IF;
  IF NEW."stagedAt" IS DISTINCT FROM transaction_timestamp()::timestamptz(3)
    THEN RAISE EXCEPTION 'SNAPSHOT_STAGE_TIME_INVALID'; END IF;
  IF NEW."requestHash" IS NULL OR NOT EXISTS (SELECT 1 FROM "SnapshotPublicationBinding" b JOIN "SnapshotBuildInput" i
      ON i."id" = b."buildInputId" AND i."organizationId" = b."organizationId" AND i."projectId" = b."projectId"
      WHERE b."organizationId" = NEW."organizationId" AND b."projectId" = NEW."projectId"
        AND b."buildInputId" = NEW."buildInputId" AND b."inputHash" = NEW."inputHash"
        AND i."inputHash" = NEW."inputHash" AND i."idempotencyKeyHash" = NEW."idempotencyKeyHash"
        AND i."requestHash" = NEW."requestHash"
        AND b."publishSequence" = NEW."publishSequence" AND i."publishSequence" = NEW."publishSequence"
        AND b."manifestSha256" = NEW."manifestSha256")
  THEN RAISE EXCEPTION 'SNAPSHOT_STAGE_RECEIPT_INVALID'; END IF;
  RETURN NEW;
END $$;

-- Keep the existing RUNNING/rejection/terminal guards; only real staged BUILD
-- receives a separate success path. Identity and the entire latest lease remain pinned.
DROP TRIGGER "OperationalActionRequest_lifecycle_update_guard" ON "OperationalActionRequest";
CREATE TRIGGER "OperationalActionRequest_lifecycle_update_guard" BEFORE UPDATE ON "OperationalActionRequest"
  FOR EACH ROW WHEN (NEW."status" <> 'FAILED'
    AND NOT (NEW."status" = 'SUCCEEDED' AND NEW."action" = 'SNAPSHOT_BUILD'))
  EXECUTE FUNCTION operational_action_lifecycle_guard();

CREATE FUNCTION operational_snapshot_build_success_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_id TEXT; job_id TEXT; expected_key_hash TEXT; expected_request_hash TEXT;
BEGIN
  IF pg_trigger_depth() > 1 AND OLD."outboxEventId" IS NOT NULL AND NEW."outboxEventId" IS NULL
    AND to_jsonb(NEW) - 'outboxEventId' = to_jsonb(OLD) - 'outboxEventId' THEN RETURN NEW; END IF;
  IF NOT operational_executor_scope(NEW."organizationId", NEW."projectId") OR OLD."status" <> 'RUNNING'
    OR to_jsonb(NEW) - ARRAY['status','finishedAt','result','updatedAt']
       <> to_jsonb(OLD) - ARRAY['status','finishedAt','result','updatedAt']
    OR NEW."startedAt" IS NULL OR NEW."finishedAt" IS NULL OR NEW."finishedAt" < NEW."startedAt"
    OR NEW."leaseJobRunId" IS NULL OR NEW."leaseAttempt" IS NULL OR NEW."leaseAttempt" < 1
    OR NEW."leaseWorkerId" IS NULL OR NEW."leaseAcquiredAt" IS NULL OR NEW."safeErrorCode" IS NOT NULL
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_TRANSITION_INVALID'; END IF;
  SELECT e."id" INTO event_id FROM "OutboxEvent" e WHERE e."id" = NEW."outboxEventId"
    AND e."organizationId" = NEW."organizationId" AND e."status" = 'PROCESSING' AND e."schemaVersion" = 1
    AND e."attempts" = NEW."leaseAttempt" AND e."lockedBy" = NEW."leaseWorkerId" AND e."lockedAt" = NEW."leaseAcquiredAt"
    AND e."topic" = 'operations-control.snapshot.build.request'
    AND e."payload" = jsonb_build_object('schemaVersion', 1, 'organizationId', NEW."organizationId",
      'projectId', NEW."projectId", 'requestId', NEW."id", 'action', 'SNAPSHOT_BUILD') FOR UPDATE;
  SELECT j."id" INTO job_id FROM "JobRun" j JOIN "OutboxEvent" e ON e."id" = j."outboxEventId"
    WHERE j."id" = NEW."leaseJobRunId" AND j."outboxEventId" = event_id AND j."organizationId" = NEW."organizationId"
      AND j."attempt" = NEW."leaseAttempt" AND j."workerId" = NEW."leaseWorkerId" AND j."startedAt" = NEW."leaseAcquiredAt"
      AND j."status" = 'RUNNING' AND j."jobType" = e."topic" AND j."correlationId" = e."correlationId" FOR UPDATE OF j;
  IF event_id IS NULL OR job_id IS NULL THEN RAISE EXCEPTION 'OUTBOX_OPERATION_LEASE_LOST'; END IF;
  -- JS key = sha256(domain + requestId); capture hashes canonical JSON of this
  -- ASCII string. Never accept another request's stage in the same project.
  expected_key_hash := encode(sha256(convert_to(to_json(encode(sha256(
    convert_to('operational-snapshot-build-v1:' || NEW."id", 'UTF8')), 'hex'))::text, 'UTF8')), 'hex');
  expected_request_hash := encode(sha256(convert_to('{"inputSchemaVersion":1,"organizationId":'
    || to_json(NEW."organizationId")::text || ',"projectId":' || to_json(NEW."projectId")::text
    || ',"projectorVersion":"db-v1","schemaMinor":0}', 'UTF8')), 'hex');
  IF NOT EXISTS (SELECT 1 FROM "SnapshotArtifactStageReceipt" s WHERE s."organizationId" = NEW."organizationId"
    AND s."projectId" = NEW."projectId" AND s."idempotencyKeyHash" = expected_key_hash
    AND s."requestHash" = expected_request_hash
    AND NEW."finishedAt" >= s."stagedAt"
    AND NEW."result" = jsonb_build_object('action', 'SNAPSHOT_BUILD', 'buildInputId', s."buildInputId",
      'inputHash', s."inputHash", 'publishSequence', s."publishSequence", 'manifestSha256', s."manifestSha256"))
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_RESULT_INVALID'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "OperationalActionRequest_snapshot_build_success_guard" BEFORE UPDATE ON "OperationalActionRequest"
  FOR EACH ROW WHEN (NEW."status" = 'SUCCEEDED' AND NEW."action" = 'SNAPSHOT_BUILD')
  EXECUTE FUNCTION operational_snapshot_build_success_guard();
