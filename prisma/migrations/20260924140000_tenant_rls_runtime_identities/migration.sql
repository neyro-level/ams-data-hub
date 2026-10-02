-- E03 requires these runtime identities to be provisioned before migrate deploy.
-- The starter never stores their passwords or production credentials.
GRANT USAGE ON SCHEMA public TO ams_data_hub_web, ams_data_hub_worker, ams_data_hub_backup;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "Organization", "Member", "Project", "Notification", "NotificationRead",
  "AuditEvent", "IdempotencyKey", "OutboxEvent", "JobRun"
TO ams_data_hub_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "User", "Session", "Account", "Verification", "TwoFactor", "RateLimit",
  "AccountSetupToken", "PlatformRecoveryToken"
TO ams_data_hub_web;
GRANT SELECT ON TABLE "RuntimeHeartbeat", "RetentionRun" TO ams_data_hub_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "AuditEvent", "IdempotencyKey", "OutboxEvent", "JobRun", "Notification"
TO ams_data_hub_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "RuntimeHeartbeat", "RetentionRun" TO ams_data_hub_worker;
GRANT SELECT ON TABLE
  "User", "Session", "Account", "Verification", "TwoFactor", "RateLimit",
  "AccountSetupToken", "PlatformRecoveryToken", "Organization", "Member", "Project",
  "Notification", "NotificationRead", "AuditEvent", "IdempotencyKey", "OutboxEvent",
  "JobRun", "RuntimeHeartbeat", "RetentionRun"
TO ams_data_hub_backup;

ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_organizationId_id_key" UNIQUE ("organizationId", "id");

ALTER TABLE "Notification" DROP CONSTRAINT "Notification_projectId_fkey";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_project_organization_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  MATCH FULL ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_project_requires_organization_check"
  CHECK ("projectId" IS NULL OR "organizationId" IS NOT NULL);

ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_outbox_organization_fkey"
  FOREIGN KEY ("organizationId", "outboxEventId") REFERENCES "OutboxEvent"("organizationId", "id")
  MATCH FULL ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_outbox_organization_fkey"
  FOREIGN KEY ("organizationId", "outboxEventId") REFERENCES "OutboxEvent"("organizationId", "id")
  MATCH FULL ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationRead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobRun" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Member" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Project" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
ALTER TABLE "NotificationRead" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyKey" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "JobRun" FORCE ROW LEVEL SECURITY;

CREATE POLICY "Organization_rls" ON "Organization"
  FOR ALL TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "id" = NULLIF(current_setting('app.organization_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "id" = NULLIF(current_setting('app.organization_id', true), '')
    )
  );

CREATE POLICY "Member_rls" ON "Member"
  FOR ALL TO PUBLIC
  USING (
    (current_setting('app.principal_kind', true) = 'identity'
      AND "userId" = NULLIF(current_setting('app.actor_id', true), ''))
    OR current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  );

CREATE POLICY "Project_rls" ON "Project"
  FOR ALL TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  );

CREATE POLICY "Notification_rls" ON "Notification"
  FOR ALL TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) = 'system-job'
      AND "organizationId" IS NULL
      AND "visibility" = 'PLATFORM_ADMIN_ONLY'
    )
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) = 'system-job'
      AND "organizationId" IS NULL
      AND "visibility" = 'PLATFORM_ADMIN_ONLY'
    )
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  );

CREATE POLICY "NotificationRead_rls" ON "NotificationRead"
  FOR ALL TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    AND "userId" = NULLIF(current_setting('app.actor_id', true), '')
    AND EXISTS (
        SELECT 1 FROM "Notification"
        WHERE "Notification"."id" = "NotificationRead"."notificationId"
      )
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    AND "userId" = NULLIF(current_setting('app.actor_id', true), '')
    AND EXISTS (
        SELECT 1 FROM "Notification"
        WHERE "Notification"."id" = "NotificationRead"."notificationId"
      )
  );

CREATE POLICY "AuditEvent_rls" ON "AuditEvent"
  FOR ALL TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  );

CREATE POLICY "IdempotencyKey_rls" ON "IdempotencyKey"
  FOR ALL TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  );

CREATE POLICY "OutboxEvent_rls" ON "OutboxEvent"
  FOR ALL TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR current_setting('app.principal_kind', true) = 'system-job'
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR current_setting('app.principal_kind', true) = 'system-job'
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  );

CREATE POLICY "JobRun_rls" ON "JobRun"
  FOR ALL TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR current_setting('app.principal_kind', true) = 'system-job'
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR current_setting('app.principal_kind', true) = 'system-job'
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  );
