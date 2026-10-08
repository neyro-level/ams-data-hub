ALTER TABLE "OperationalActionRequest"
  ADD COLUMN "leaseJobRunId" TEXT,
  ADD COLUMN "leaseAttempt" INTEGER,
  ADD COLUMN "leaseWorkerId" TEXT,
  ADD COLUMN "leaseAcquiredAt" TIMESTAMPTZ(3),
  ADD COLUMN "startedAt" TIMESTAMPTZ(3),
  ADD COLUMN "finishedAt" TIMESTAMPTZ(3),
  ADD COLUMN "result" JSONB;

CREATE FUNCTION operational_executor_scope(organization_id TEXT, project_id TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
  SELECT current_setting('app.principal_kind', true) = 'project-job'
    AND current_setting('app.actor_id', true) = 'operations-executor'
    AND organization_id = NULLIF(current_setting('app.organization_id', true), '')
    AND project_id = NULLIF(current_setting('app.project_ids', true), '')
$$;
CREATE POLICY "OperationalActionRequest_executor_update" ON "OperationalActionRequest" FOR UPDATE TO PUBLIC
  USING (operational_executor_scope("organizationId", "projectId"))
  WITH CHECK (operational_executor_scope("organizationId", "projectId"));
GRANT UPDATE ("status", "leaseJobRunId", "leaseAttempt", "leaseWorkerId", "leaseAcquiredAt",
  "startedAt", "finishedAt", "result", "updatedAt") ON "OperationalActionRequest" TO ams_data_hub_worker;

-- Direct executor SQL must obtain global before PostgreSQL takes request or
-- revision row locks. Existing system retention's internal FK detach must NOT
-- acquire global while holding a deleted outbox row (reverse lock order).
CREATE FUNCTION lock_operational_executor_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.principal_kind', true) = 'project-job'
    AND current_setting('app.actor_id', true) = 'operations-executor' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "OperationalActionRequest_executor_writer_lock" BEFORE UPDATE ON "OperationalActionRequest"
  FOR EACH STATEMENT EXECUTE FUNCTION lock_operational_executor_writer();
CREATE TRIGGER "SourceRevision_executor_writer_lock" BEFORE INSERT OR UPDATE ON "SourceRevision"
  FOR EACH STATEMENT EXECUTE FUNCTION lock_operational_executor_writer();

CREATE FUNCTION operational_action_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_id TEXT; job_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."leaseJobRunId" IS NOT NULL OR NEW."leaseAttempt" IS NOT NULL OR NEW."leaseWorkerId" IS NOT NULL
      OR NEW."leaseAcquiredAt" IS NOT NULL OR NEW."startedAt" IS NOT NULL OR NEW."finishedAt" IS NOT NULL
      OR NEW."result" IS NOT NULL THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_TRANSITION_INVALID'; END IF;
    RETURN NEW;
  END IF;
  -- The existing FK's internal retention detach is not an executor transition.
  IF pg_trigger_depth() > 1 AND OLD."outboxEventId" IS NOT NULL AND NEW."outboxEventId" IS NULL
    AND to_jsonb(NEW) - 'outboxEventId' = to_jsonb(OLD) - 'outboxEventId' THEN RETURN NEW; END IF;
  IF NOT operational_executor_scope(NEW."organizationId", NEW."projectId")
    OR OLD."status" IN ('SUCCEEDED', 'FAILED')
    OR to_jsonb(NEW) - ARRAY['status','leaseJobRunId','leaseAttempt','leaseWorkerId','leaseAcquiredAt','startedAt','finishedAt','result','updatedAt']
       <> to_jsonb(OLD) - ARRAY['status','leaseJobRunId','leaseAttempt','leaseWorkerId','leaseAcquiredAt','startedAt','finishedAt','result','updatedAt']
    OR NEW."status" NOT IN ('RUNNING', 'SUCCEEDED') OR NEW."startedAt" IS NULL
    OR NEW."leaseAttempt" IS NULL OR NEW."leaseAttempt" < 1
    OR NEW."leaseAcquiredAt" IS NULL OR NEW."leaseWorkerId" IS NULL OR NEW."leaseJobRunId" IS NULL
    OR (OLD."startedAt" IS NOT NULL AND NEW."startedAt" <> OLD."startedAt")
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_TRANSITION_INVALID'; END IF;
  SELECT e."id" INTO event_id FROM "OutboxEvent" e WHERE e."id" = NEW."outboxEventId"
    AND e."organizationId" = NEW."organizationId" AND e."status" = 'PROCESSING' AND e."schemaVersion" = 1
    AND e."attempts" = NEW."leaseAttempt" AND e."lockedBy" = NEW."leaseWorkerId" AND e."lockedAt" = NEW."leaseAcquiredAt"
    AND e."payload" = jsonb_build_object('schemaVersion', 1, 'organizationId', NEW."organizationId",
      'projectId', NEW."projectId", 'requestId', NEW."id", 'action', NEW."action"::text)
    AND e."topic" = CASE NEW."action"
      WHEN 'SNAPSHOT_BUILD' THEN 'operations-control.snapshot.build.request'
      WHEN 'SNAPSHOT_PUBLISH' THEN 'operations-control.snapshot.publish.request'
      WHEN 'SNAPSHOT_ROLLBACK' THEN 'operations-control.snapshot.rollback.request'
      WHEN 'ACK_ROTATE' THEN 'operations-control.ack.rotate.request'
      WHEN 'SUSPICIOUS_APPROVE' THEN 'operations-control.suspicious.approve.request'
      WHEN 'SUSPICIOUS_REJECT' THEN 'operations-control.suspicious.reject.request' END
    FOR UPDATE;
  SELECT j."id" INTO job_id FROM "JobRun" j JOIN "OutboxEvent" e ON e."id" = j."outboxEventId"
    WHERE j."id" = NEW."leaseJobRunId" AND j."outboxEventId" = event_id
      AND j."organizationId" = NEW."organizationId" AND j."attempt" = NEW."leaseAttempt"
      AND j."workerId" = NEW."leaseWorkerId" AND j."startedAt" = NEW."leaseAcquiredAt" AND j."status" = 'RUNNING'
      AND j."jobType" = e."topic" AND j."correlationId" = e."correlationId" FOR UPDATE OF j;
  IF event_id IS NULL OR job_id IS NULL THEN RAISE EXCEPTION 'OUTBOX_OPERATION_LEASE_LOST'; END IF;
  IF NEW."status" = 'RUNNING' THEN
    IF NEW."result" IS NOT NULL OR NEW."finishedAt" IS NOT NULL THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_TRANSITION_INVALID'; END IF;
  ELSE
    -- Enable completion only alongside a real domain adapter. The other five
    -- actions deliberately cannot be manufactured as successful placeholders.
    IF OLD."status" <> 'RUNNING' OR NEW."leaseJobRunId" IS DISTINCT FROM OLD."leaseJobRunId"
      OR NEW."leaseAttempt" IS DISTINCT FROM OLD."leaseAttempt" OR NEW."leaseWorkerId" IS DISTINCT FROM OLD."leaseWorkerId"
      OR NEW."leaseAcquiredAt" IS DISTINCT FROM OLD."leaseAcquiredAt" OR NEW."finishedAt" IS NULL
      OR NEW."finishedAt" < NEW."startedAt" OR NEW."action" <> 'SUSPICIOUS_REJECT'
      OR NEW."result" IS DISTINCT FROM jsonb_build_object('action', 'SUSPICIOUS_REJECT', 'sourceRevisionId', NEW."sourceRevisionId")
      OR NOT EXISTS (SELECT 1 FROM "SourceRevision" r WHERE r."id" = NEW."sourceRevisionId"
        AND r."organizationId" = NEW."organizationId" AND r."projectId" = NEW."projectId" AND r."sourceId" = NEW."sourceId"
        AND r."status" = 'REJECTED' AND r."safetyAnalysis"->>'disposition' = 'REJECTED'
        AND r."safetyAnalysis"->'review'->>'reviewedBy' = NEW."requestedBy"
        AND r."safetyAnalysis"->'review'->>'reason' = NEW."reason")
    THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_RESULT_INVALID'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "OperationalActionRequest_lifecycle_guard" BEFORE INSERT OR UPDATE ON "OperationalActionRequest"
  FOR EACH ROW EXECUTE FUNCTION operational_action_lifecycle_guard();

CREATE POLICY "SourceRevision_operations_read" ON "SourceRevision" FOR SELECT TO PUBLIC
  USING (operational_executor_scope("organizationId", "projectId"));
CREATE POLICY "SourceRevision_operations_review" ON "SourceRevision" FOR UPDATE TO PUBLIC
  USING (operational_executor_scope("organizationId", "projectId"))
  WITH CHECK (operational_executor_scope("organizationId", "projectId"));
CREATE POLICY "DataSafetyState_operations_read" ON "DataSafetyState" FOR SELECT TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'project-job'
    AND current_setting('app.actor_id', true) = 'operations-executor'
    AND NULLIF(current_setting('app.organization_id', true), '') IS NOT NULL
    AND NULLIF(current_setting('app.project_ids', true), '') IS NOT NULL
    AND current_setting('app.project_ids', true) NOT LIKE '%,%' AND current_setting('app.project_ids', true) <> '*');

CREATE FUNCTION protect_operational_source_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_id TEXT;
BEGIN
  IF current_setting('app.actor_id', true) <> 'operations-executor' THEN RETURN NEW; END IF;
  IF TG_OP <> 'UPDATE' OR NOT operational_executor_scope(NEW."organizationId", NEW."projectId")
    OR OLD."status" <> 'SUSPICIOUS' OR NEW."status" <> 'REJECTED' OR NEW."completedAt" IS NULL
    OR to_jsonb(NEW) - ARRAY['status','safetyAnalysis','completedAt'] <> to_jsonb(OLD) - ARRAY['status','safetyAnalysis','completedAt']
    OR NEW."safetyAnalysis"->>'disposition' IS DISTINCT FROM 'REJECTED'
    OR NEW."safetyAnalysis" - ARRAY['disposition','review'] IS DISTINCT FROM OLD."safetyAnalysis" - ARRAY['disposition','review']
    OR NEW."safetyAnalysis"->'review'->>'reviewedAt' IS DISTINCT FROM to_char(NEW."completedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  THEN RAISE EXCEPTION 'SOURCE_OPERATION_REVIEW_INVALID'; END IF;
  SELECT q."id" INTO request_id FROM "OperationalActionRequest" q JOIN "OutboxEvent" e ON e."id" = q."outboxEventId"
    WHERE q."organizationId" = NEW."organizationId" AND q."projectId" = NEW."projectId"
      AND q."sourceId" = NEW."sourceId" AND q."sourceRevisionId" = NEW."id" AND q."action" = 'SUSPICIOUS_REJECT'
      AND q."status" = 'RUNNING' AND q."requestedBy" = NEW."safetyAnalysis"->'review'->>'reviewedBy'
      AND q."reason" = NEW."safetyAnalysis"->'review'->>'reason'
      AND NEW."safetyAnalysis"->'review' = jsonb_build_object('reviewedBy', q."requestedBy", 'reason', q."reason",
        'reviewedAt', to_char(NEW."completedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      AND e."status" = 'PROCESSING' AND e."attempts" = q."leaseAttempt"
      AND e."lockedBy" = q."leaseWorkerId" AND e."lockedAt" = q."leaseAcquiredAt"
      AND e."schemaVersion" = 1 AND e."topic" = 'operations-control.suspicious.reject.request'
      AND e."payload" = jsonb_build_object('schemaVersion', 1, 'organizationId', q."organizationId",
        'projectId', q."projectId", 'requestId', q."id", 'action', 'SUSPICIOUS_REJECT')
    FOR UPDATE OF e;
  IF request_id IS NULL THEN RAISE EXCEPTION 'SOURCE_OPERATION_REVIEW_INVALID'; END IF;
  PERFORM j."id" FROM "JobRun" j JOIN "OperationalActionRequest" q ON q."leaseJobRunId" = j."id"
    JOIN "OutboxEvent" e ON e."id" = q."outboxEventId"
    WHERE q."id" = request_id AND j."outboxEventId" = e."id" AND j."organizationId" = q."organizationId"
      AND j."status" = 'RUNNING' AND j."attempt" = q."leaseAttempt" AND j."workerId" = q."leaseWorkerId"
      AND j."startedAt" = q."leaseAcquiredAt" AND j."jobType" = e."topic" AND j."correlationId" = e."correlationId"
    FOR UPDATE OF j;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_OPERATION_REVIEW_INVALID'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SourceRevision_operational_review_guard" BEFORE INSERT OR UPDATE ON "SourceRevision"
  FOR EACH ROW EXECUTE FUNCTION protect_operational_source_review();
