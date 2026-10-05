ALTER TABLE "DeliveryRun" ADD COLUMN "ackIdempotencyKeyHash" VARCHAR(64);
ALTER TABLE "DeliveryRun" ADD CONSTRAINT "DeliveryRun_ack_idempotency_hash_check"
  CHECK ("ackIdempotencyKeyHash" IS NULL OR "ackIdempotencyKeyHash" ~ '^[a-f0-9]{64}$');

CREATE TABLE "ProjectAckCredential" (
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "currentTokenHash" VARCHAR(255) NOT NULL,
  "nextTokenHash" VARCHAR(255),
  "version" INTEGER NOT NULL DEFAULT 1,
  "rotatedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectAckCredential_pkey" PRIMARY KEY ("organizationId", "projectId"),
  CONSTRAINT "ProjectAckCredential_version_check" CHECK ("version" > 0),
  CONSTRAINT "ProjectAckCredential_current_hash_check" CHECK ("currentTokenHash" ~ '^scrypt[$]'),
  CONSTRAINT "ProjectAckCredential_next_hash_check" CHECK ("nextTokenHash" IS NULL OR "nextTokenHash" ~ '^scrypt[$]')
);
CREATE INDEX "ProjectAckCredential_projectId_idx" ON "ProjectAckCredential"("projectId");
ALTER TABLE "ProjectAckCredential" ADD CONSTRAINT "ProjectAckCredential_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectAckCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectAckCredential" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ProjectAckCredential_rls" ON "ProjectAckCredential" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin' OR (
    current_setting('app.principal_kind', true) IN ('api-client', 'job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
CREATE POLICY "ProjectAckCredential_write" ON "ProjectAckCredential" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) IN ('platform-admin', 'system-job') OR (
    current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  ))
  WITH CHECK (current_setting('app.principal_kind', true) IN ('platform-admin', 'system-job') OR (
    current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  ));
GRANT SELECT, INSERT, UPDATE ON TABLE "ProjectAckCredential" TO ams_data_hub_web, ams_data_hub_worker;
GRANT SELECT ON TABLE "ProjectAckCredential" TO ams_data_hub_backup;
