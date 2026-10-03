-- DH-01.4: project-scoped RLS. Runtime context is transaction-local and never
-- inherits a previous request's organization or project scope.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ProjectMember" TO ams_data_hub_web;
GRANT SELECT ON TABLE "ProjectMember" TO ams_data_hub_backup;

ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationRead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectMember" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Member" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Project" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
ALTER TABLE "NotificationRead" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyKey" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "JobRun" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProjectMember" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organization_rls" ON "Organization";
DROP POLICY IF EXISTS "Member_rls" ON "Member";
DROP POLICY IF EXISTS "Project_rls" ON "Project";
DROP POLICY IF EXISTS "Notification_rls" ON "Notification";
DROP POLICY IF EXISTS "NotificationRead_rls" ON "NotificationRead";
DROP POLICY IF EXISTS "AuditEvent_rls" ON "AuditEvent";
DROP POLICY IF EXISTS "IdempotencyKey_rls" ON "IdempotencyKey";
DROP POLICY IF EXISTS "OutboxEvent_rls" ON "OutboxEvent";
DROP POLICY IF EXISTS "JobRun_rls" ON "JobRun";
DROP POLICY IF EXISTS "ProjectMember_rls" ON "ProjectMember";

CREATE POLICY "Organization_rls" ON "Organization" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin'
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "id" = NULLIF(current_setting('app.organization_id', true), '')))
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin'
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "id" = NULLIF(current_setting('app.organization_id', true), '')));

CREATE POLICY "Member_rls" ON "Member" FOR ALL TO PUBLIC
  USING ((current_setting('app.principal_kind', true) = 'identity'
      AND "userId" = NULLIF(current_setting('app.actor_id', true), ''))
    OR current_setting('app.principal_kind', true) = 'platform-admin'
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')))
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin'
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')));

CREATE POLICY "Project_rls" ON "Project" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin'
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "id" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))))
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin'
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "id" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))));

CREATE POLICY "ProjectMember_rls" ON "ProjectMember" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin'
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))))
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin'
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))));

CREATE POLICY "Notification_rls" ON "Notification" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin'
    OR (current_setting('app.principal_kind', true) = 'system-job'
      AND "organizationId" IS NULL AND "visibility" = 'PLATFORM_ADMIN_ONLY')
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND ("projectId" IS NULL OR NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))))
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin'
    OR (current_setting('app.principal_kind', true) = 'system-job'
      AND "organizationId" IS NULL AND "visibility" = 'PLATFORM_ADMIN_ONLY')
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND ("projectId" IS NULL OR NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))));

CREATE POLICY "NotificationRead_rls" ON "NotificationRead" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin'
    AND "userId" = NULLIF(current_setting('app.actor_id', true), '')
    AND EXISTS (SELECT 1 FROM "Notification" WHERE "Notification"."id" = "NotificationRead"."notificationId"))
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin'
    AND "userId" = NULLIF(current_setting('app.actor_id', true), '')
    AND EXISTS (SELECT 1 FROM "Notification" WHERE "Notification"."id" = "NotificationRead"."notificationId"));

CREATE POLICY "AuditEvent_rls" ON "AuditEvent" FOR ALL TO PUBLIC
  USING ((current_setting('app.principal_kind', true) = 'identity'
      AND "organizationId" IS NULL
      AND "actorId" = NULLIF(current_setting('app.actor_id', true), ''))
    OR current_setting('app.principal_kind', true) = 'platform-admin'
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')))
  WITH CHECK ((current_setting('app.principal_kind', true) = 'identity'
      AND "organizationId" IS NULL
      AND "actorId" = NULLIF(current_setting('app.actor_id', true), ''))
    OR current_setting('app.principal_kind', true) = 'platform-admin'
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')));

CREATE POLICY "IdempotencyKey_rls" ON "IdempotencyKey" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin'
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')))
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin'
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')));

CREATE POLICY "OutboxEvent_rls" ON "OutboxEvent" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) IN ('platform-admin', 'system-job')
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')))
  WITH CHECK (current_setting('app.principal_kind', true) IN ('platform-admin', 'system-job')
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')));

CREATE POLICY "JobRun_rls" ON "JobRun" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) IN ('platform-admin', 'system-job')
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')))
  WITH CHECK (current_setting('app.principal_kind', true) IN ('platform-admin', 'system-job')
    OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')));
