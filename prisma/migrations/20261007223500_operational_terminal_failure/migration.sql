ALTER TABLE "OperationalActionRequest" ADD COLUMN "safeErrorCode" VARCHAR(64);
ALTER TABLE "OperationalActionRequest" ADD CONSTRAINT "OperationalActionRequest_safe_failure_check"
  CHECK (("status" = 'FAILED' AND "safeErrorCode" IS NOT DISTINCT FROM 'OPERATIONS_CONTROL_EXECUTION_FAILED')
    OR ("status" <> 'FAILED' AND "safeErrorCode" IS NULL));
GRANT UPDATE ("safeErrorCode") ON "OperationalActionRequest" TO ams_data_hub_worker;

-- Preserve the existing active-lease/domain completion guard; terminal failure
-- is a separate path backed by a durable DEAD_LETTER, never a handler catch.
DROP TRIGGER "OperationalActionRequest_lifecycle_guard" ON "OperationalActionRequest";
CREATE TRIGGER "OperationalActionRequest_lifecycle_insert_guard" BEFORE INSERT ON "OperationalActionRequest"
  FOR EACH ROW EXECUTE FUNCTION operational_action_lifecycle_guard();
CREATE TRIGGER "OperationalActionRequest_lifecycle_update_guard" BEFORE UPDATE ON "OperationalActionRequest"
  FOR EACH ROW WHEN (NEW."status" <> 'FAILED') EXECUTE FUNCTION operational_action_lifecycle_guard();

CREATE FUNCTION operational_action_terminal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_id TEXT; job_id TEXT;
BEGIN
  IF pg_trigger_depth() > 1 AND OLD."outboxEventId" IS NOT NULL AND NEW."outboxEventId" IS NULL
    AND to_jsonb(NEW) - 'outboxEventId' = to_jsonb(OLD) - 'outboxEventId' THEN RETURN NEW; END IF;
  IF NOT operational_executor_scope(NEW."organizationId", NEW."projectId")
    OR OLD."status" IN ('SUCCEEDED', 'FAILED')
    OR to_jsonb(NEW) - ARRAY['status','leaseJobRunId','leaseAttempt','leaseWorkerId','leaseAcquiredAt','startedAt','finishedAt','result','safeErrorCode','updatedAt']
       <> to_jsonb(OLD) - ARRAY['status','leaseJobRunId','leaseAttempt','leaseWorkerId','leaseAcquiredAt','startedAt','finishedAt','result','safeErrorCode','updatedAt']
    OR NEW."safeErrorCode" IS DISTINCT FROM 'OPERATIONS_CONTROL_EXECUTION_FAILED'
    OR NEW."result" IS NOT NULL OR NEW."startedAt" IS NULL OR NEW."finishedAt" IS NULL
    OR NEW."finishedAt" < NEW."startedAt" OR NEW."leaseAttempt" IS NULL OR NEW."leaseAttempt" < 1
    OR NEW."leaseJobRunId" IS NULL OR NEW."leaseWorkerId" IS NULL OR NEW."leaseAcquiredAt" IS NULL
    OR (OLD."startedAt" IS NOT NULL AND NEW."startedAt" <> OLD."startedAt")
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_TRANSITION_INVALID'; END IF;
  SELECT e."id" INTO event_id FROM "OutboxEvent" e WHERE e."id" = NEW."outboxEventId"
    AND e."organizationId" = NEW."organizationId" AND e."status" = 'DEAD_LETTER' AND e."schemaVersion" = 1
    AND e."attempts" = NEW."leaseAttempt" AND e."lockedBy" IS NULL AND e."lockedAt" IS NULL
    AND e."payload" = jsonb_build_object('schemaVersion', 1, 'organizationId', NEW."organizationId",
      'projectId', NEW."projectId", 'requestId', NEW."id", 'action', NEW."action"::text)
    AND e."topic" = CASE NEW."action"
      WHEN 'SNAPSHOT_BUILD' THEN 'operations-control.snapshot.build.request'
      WHEN 'SNAPSHOT_PUBLISH' THEN 'operations-control.snapshot.publish.request'
      WHEN 'SNAPSHOT_ROLLBACK' THEN 'operations-control.snapshot.rollback.request'
      WHEN 'ACK_ROTATE' THEN 'operations-control.ack.rotate.request'
      WHEN 'SUSPICIOUS_APPROVE' THEN 'operations-control.suspicious.approve.request'
      WHEN 'SUSPICIOUS_REJECT' THEN 'operations-control.suspicious.reject.request' END FOR UPDATE;
  SELECT j."id" INTO job_id FROM "JobRun" j JOIN "OutboxEvent" e ON e."id" = j."outboxEventId"
    WHERE j."id" = NEW."leaseJobRunId" AND j."outboxEventId" = event_id
      AND j."organizationId" = NEW."organizationId" AND j."attempt" = NEW."leaseAttempt"
      AND j."workerId" = NEW."leaseWorkerId" AND j."startedAt" = NEW."leaseAcquiredAt"
      AND j."status" = 'FAILED' AND j."finishedAt" IS NOT NULL AND NEW."finishedAt" >= j."finishedAt"
      AND j."jobType" = e."topic" AND j."correlationId" = e."correlationId" FOR UPDATE OF j;
  IF event_id IS NULL OR job_id IS NULL THEN RAISE EXCEPTION 'OUTBOX_OPERATION_TERMINAL_INVALID'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "OperationalActionRequest_terminal_guard" BEFORE UPDATE ON "OperationalActionRequest"
  FOR EACH ROW WHEN (NEW."status" = 'FAILED') EXECUTE FUNCTION operational_action_terminal_guard();

-- Only a boolean retention decision crosses the private request RLS boundary.
-- No request projection or mutation is exposed. An owner-only SELECT policy
-- supports the existing non-BYPASS migrator under FORCE RLS, not runtime roles.
CREATE FUNCTION operational_outbox_retention_allowed(event_id TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET row_security = on AS $$
DECLARE event_topic TEXT;
BEGIN
  IF current_setting('app.principal_kind', true) IS DISTINCT FROM 'system-job'
    OR current_setting('app.actor_id', true) IS DISTINCT FROM 'outbox-retention'
  THEN RAISE EXCEPTION 'OUTBOX_RETENTION_SCOPE_DENIED'; END IF;
  SELECT "topic" INTO event_topic FROM public."OutboxEvent" WHERE "id" = event_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF event_topic NOT LIKE 'operations-control.%' THEN RETURN TRUE; END IF;
  -- An orphan intent has no request to lose. Never retain it forever or infer
  -- a fabricated FAILED. Any actually bound unresolved request is protected,
  -- including corrupt/malformed payloads which cannot safely be reconciled.
  RETURN NOT EXISTS (SELECT 1 FROM public."OperationalActionRequest" q
    WHERE q."outboxEventId" = event_id AND q."status" NOT IN ('SUCCEEDED', 'FAILED'));
END $$;
CREATE POLICY "OperationalActionRequest_retention_definer_read" ON "OperationalActionRequest" FOR SELECT TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'system-job'
    AND current_setting('app.actor_id', true) = 'outbox-retention'
    AND current_user = pg_get_userbyid((SELECT proowner FROM pg_proc
      WHERE oid = 'public.operational_outbox_retention_allowed(text)'::regprocedure)));
REVOKE ALL ON FUNCTION operational_outbox_retention_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operational_outbox_retention_allowed(TEXT) TO ams_data_hub_worker;

CREATE FUNCTION protect_operational_outbox_retention() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."topic" LIKE 'operations-control.%' THEN
    IF NOT operational_outbox_retention_allowed(OLD."id") THEN RETURN NULL; END IF;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER "OutboxEvent_operational_retention_guard" BEFORE DELETE ON "OutboxEvent"
  FOR EACH ROW EXECUTE FUNCTION protect_operational_outbox_retention();
