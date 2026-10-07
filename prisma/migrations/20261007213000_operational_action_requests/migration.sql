CREATE TYPE "OperationalActionType" AS ENUM (
  'SNAPSHOT_BUILD', 'SNAPSHOT_PUBLISH', 'SNAPSHOT_ROLLBACK',
  'ACK_ROTATE', 'SUSPICIOUS_APPROVE', 'SUSPICIOUS_REJECT'
);
CREATE TYPE "OperationalActionStatus" AS ENUM ('REQUESTED', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TABLE "OperationalActionRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "action" "OperationalActionType" NOT NULL,
  "status" "OperationalActionStatus" NOT NULL DEFAULT 'REQUESTED',
  "sourceId" TEXT,
  "sourceRevisionId" TEXT,
  "sourcePublishSequence" INTEGER,
  "reason" VARCHAR(500),
  "requestHash" CHAR(64) NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "outboxEventId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "OperationalActionRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperationalActionRequest_hash_check" CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "OperationalActionRequest_subject_check" CHECK (
    ("action" IN ('SUSPICIOUS_APPROVE', 'SUSPICIOUS_REJECT') AND "sourceId" IS NOT NULL
      AND "sourceRevisionId" IS NOT NULL AND "reason" IS NOT NULL AND length(btrim("reason")) > 0)
    OR ("action" NOT IN ('SUSPICIOUS_APPROVE', 'SUSPICIOUS_REJECT')
      AND "sourceId" IS NULL AND "sourceRevisionId" IS NULL AND "reason" IS NULL)
  ),
  CONSTRAINT "OperationalActionRequest_sequence_check" CHECK (
    ("action" = 'SNAPSHOT_ROLLBACK' AND "sourcePublishSequence" IS NOT NULL AND "sourcePublishSequence" > 0)
    OR ("action" <> 'SNAPSHOT_ROLLBACK' AND "sourcePublishSequence" IS NULL)
  ),
  CONSTRAINT "OperationalActionRequest_project_fkey" FOREIGN KEY ("organizationId", "projectId")
    REFERENCES "Project" ("organizationId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "OperationalActionRequest_source_fkey" FOREIGN KEY ("organizationId", "projectId", "sourceId")
    REFERENCES "Source" ("organizationId", "projectId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "OperationalActionRequest_revision_fkey" FOREIGN KEY ("organizationId", "projectId", "sourceId", "sourceRevisionId")
    REFERENCES "SourceRevision" ("organizationId", "projectId", "sourceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "OperationalActionRequest_outbox_fkey" FOREIGN KEY ("outboxEventId")
    REFERENCES "OutboxEvent" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "OperationalActionRequest_scope_id_key"
  ON "OperationalActionRequest" ("organizationId", "projectId", "id");
CREATE UNIQUE INDEX "OperationalActionRequest_outboxEventId_key" ON "OperationalActionRequest" ("outboxEventId");
CREATE INDEX "OperationalActionRequest_project_status_created_idx"
  ON "OperationalActionRequest" ("projectId", "status", "createdAt");

-- Retention may remove a settled intent after its existing 14/30-day window.
-- The durable request and stable idempotency response survive; INSERT still
-- requires the exact intent below. RI SET NULL needs no new runtime write grant.
-- Request creation is admin-only. Until the fenced dispatcher exists the new
-- model has no runtime UPDATE/DELETE grant and no executor is registered.
ALTER TABLE "OperationalActionRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperationalActionRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY "OperationalActionRequest_rls" ON "OperationalActionRequest" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin'
  OR (current_setting('app.principal_kind', true) = 'project-job'
    AND current_setting('app.actor_id', true) = 'operations-executor'
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "projectId" = NULLIF(current_setting('app.project_ids', true), ''))
);
CREATE POLICY "OperationalActionRequest_admin_insert" ON "OperationalActionRequest" FOR INSERT TO PUBLIC
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');
GRANT SELECT, INSERT ON "OperationalActionRequest" TO ams_data_hub_web;
GRANT SELECT ON "OperationalActionRequest" TO ams_data_hub_worker;
GRANT SELECT ON "OperationalActionRequest" TO ams_data_hub_backup;

CREATE FUNCTION operational_action_request_intent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_topic TEXT;
BEGIN
  expected_topic := CASE NEW."action"
    WHEN 'SNAPSHOT_BUILD' THEN 'operations-control.snapshot.build.request'
    WHEN 'SNAPSHOT_PUBLISH' THEN 'operations-control.snapshot.publish.request'
    WHEN 'SNAPSHOT_ROLLBACK' THEN 'operations-control.snapshot.rollback.request'
    WHEN 'ACK_ROTATE' THEN 'operations-control.ack.rotate.request'
    WHEN 'SUSPICIOUS_APPROVE' THEN 'operations-control.suspicious.approve.request'
    WHEN 'SUSPICIOUS_REJECT' THEN 'operations-control.suspicious.reject.request'
  END;
  IF NEW."status" <> 'REQUESTED' OR NOT EXISTS (
    SELECT 1 FROM "OutboxEvent" e WHERE e."id" = NEW."outboxEventId"
      AND e."organizationId" = NEW."organizationId" AND e."topic" = expected_topic
      AND e."schemaVersion" = 1 AND e."status" = 'PENDING' AND e."attempts" = 0
      AND e."payload" = jsonb_build_object('schemaVersion', 1,
        'organizationId', NEW."organizationId", 'projectId', NEW."projectId",
        'requestId', NEW."id", 'action', NEW."action"::text)
  ) OR NOT EXISTS (
    SELECT 1 FROM "AuditEvent" a WHERE a."id" = NEW."id"
      AND a."organizationId" = NEW."organizationId" AND a."action" = expected_topic
      AND a."actorId" = NEW."requestedBy"
  ) THEN
    RAISE EXCEPTION 'OPERATIONS_CONTROL_INTENT_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "OperationalActionRequest_intent_guard" BEFORE INSERT ON "OperationalActionRequest"
  FOR EACH ROW EXECUTE FUNCTION operational_action_request_intent_guard();
