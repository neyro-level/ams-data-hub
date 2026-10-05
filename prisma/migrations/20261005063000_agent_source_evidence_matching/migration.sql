CREATE TABLE "AgentSourceEvidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "agentUid" VARCHAR(26),
  "evidenceKey" CHAR(64) NOT NULL,
  "fullNameRaw" VARCHAR(240),
  "normalizedFullName" VARCHAR(240),
  "phoneRaw" VARCHAR(80),
  "phoneNorm" VARCHAR(40),
  "photoSourceUrl" VARCHAR(2048),
  "categoryRaw" VARCHAR(120),
  "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "sourceRevisionId" VARCHAR(128) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AgentSourceEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentSourceEvidence_scope_key"
  ON "AgentSourceEvidence"("organizationId", "projectId", "sourceId", "evidenceKey");
CREATE INDEX "AgentSourceEvidence_projectId_phoneNorm_idx" ON "AgentSourceEvidence"("projectId", "phoneNorm");
CREATE INDEX "AgentSourceEvidence_agentUid_lastSeenAt_idx" ON "AgentSourceEvidence"("agentUid", "lastSeenAt");
CREATE INDEX "AgentSourceEvidence_sourceId_sourceRevisionId_idx" ON "AgentSourceEvidence"("sourceId", "sourceRevisionId");

ALTER TABLE "AgentSourceEvidence" ADD CONSTRAINT "AgentSourceEvidence_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentSourceEvidence" ADD CONSTRAINT "AgentSourceEvidence_source_fkey"
  FOREIGN KEY ("organizationId", "projectId", "sourceId") REFERENCES "Source"("organizationId", "projectId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentSourceEvidence" ADD CONSTRAINT "AgentSourceEvidence_agent_fkey"
  FOREIGN KEY ("organizationId", "projectId", "agentUid") REFERENCES "Agent"("organizationId", "projectId", "uid")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentSourceEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentSourceEvidence" FORCE ROW LEVEL SECURITY;

DROP POLICY "Agent_rls" ON "Agent";
CREATE POLICY "Agent_rls" ON "Agent" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff') OR (
    current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
DROP POLICY "Agent_job_write" ON "Agent";
CREATE POLICY "Agent_job_write" ON "Agent" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))))
  WITH CHECK (current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))));

DROP POLICY "AgentExternalIdentity_rls" ON "AgentExternalIdentity";
CREATE POLICY "AgentExternalIdentity_rls" ON "AgentExternalIdentity" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff') OR (
    current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
DROP POLICY "AgentExternalIdentity_write" ON "AgentExternalIdentity";
CREATE POLICY "AgentExternalIdentity_write" ON "AgentExternalIdentity" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin' OR (
    current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))))
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin' OR (
    current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))));

DROP POLICY "AgentMatchReview_rls" ON "AgentMatchReview";
CREATE POLICY "AgentMatchReview_rls" ON "AgentMatchReview" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff') OR (
    current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
DROP POLICY "AgentMatchReview_write" ON "AgentMatchReview";
CREATE POLICY "AgentMatchReview_write" ON "AgentMatchReview" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin' OR (
    current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))))
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin' OR (
    current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))));

CREATE POLICY "AgentSourceEvidence_rls" ON "AgentSourceEvidence" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin' OR (
    current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
CREATE POLICY "AgentSourceEvidence_job_write" ON "AgentSourceEvidence" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))))
  WITH CHECK (current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))));

CREATE OR REPLACE FUNCTION enforce_agent_field_ownership() RETURNS trigger AS $$
BEGIN
  IF NEW."uid" IS DISTINCT FROM OLD."uid" OR NEW."origin" IS DISTINCT FROM OLD."origin" THEN
    RAISE EXCEPTION 'agent identity is immutable';
  END IF;
  IF current_setting('app.principal_kind', true) IN ('job', 'project-job') AND (
    OLD."origin" = 'MANUAL'
    OR NEW."role" IS DISTINCT FROM OLD."role"
    OR NEW."position" IS DISTINCT FROM OLD."position"
    OR NEW."bio" IS DISTINCT FROM OLD."bio"
    OR NEW."specializations" IS DISTINCT FROM OLD."specializations"
    OR NEW."photoMediaId" IS DISTINCT FROM OLD."photoMediaId"
    OR NEW."showOnSite" IS DISTINCT FROM OLD."showOnSite"
    OR NEW."sortOrder" IS DISTINCT FROM OLD."sortOrder"
    OR NEW."slug" IS DISTINCT FROM OLD."slug"
    OR NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."consentConfirmedBy" IS DISTINCT FROM OLD."consentConfirmedBy"
    OR NEW."consentConfirmedAt" IS DISTINCT FROM OLD."consentConfirmedAt"
    OR NEW."consentBasis" IS DISTINCT FROM OLD."consentBasis"
    OR NEW."consentBatchId" IS DISTINCT FROM OLD."consentBatchId"
  ) THEN
    RAISE EXCEPTION 'feed cannot mutate manual-owned agent fields';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

GRANT SELECT ON TABLE "AgentSourceEvidence" TO ams_data_hub_web, ams_data_hub_backup;
GRANT SELECT, INSERT, UPDATE ON TABLE "AgentSourceEvidence" TO ams_data_hub_worker;
