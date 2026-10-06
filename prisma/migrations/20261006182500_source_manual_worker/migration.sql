ALTER TYPE "JobRunStatus" ADD VALUE 'DEFERRED';
ALTER TABLE "OutboxEvent" ADD COLUMN "deferredAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_deferred_attempts_bound"
  CHECK ("deferredAttempts" >= 0 AND "deferredAttempts" <= "attempts");

CREATE POLICY "SourceManualRunRequest_project_worker_read" ON "SourceManualRunRequest" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'project-job'
  AND current_setting('app.actor_id', true) = 'source-import'
  AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
  AND "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))
);
CREATE POLICY "SourceManualRunRequest_project_worker_update" ON "SourceManualRunRequest" FOR UPDATE TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) = 'project-job'
    AND current_setting('app.actor_id', true) = 'source-import'
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))
  ) WITH CHECK (
    current_setting('app.principal_kind', true) = 'project-job'
    AND current_setting('app.actor_id', true) = 'source-import'
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))
  );
