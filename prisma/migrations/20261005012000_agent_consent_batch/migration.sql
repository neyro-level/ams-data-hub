CREATE TABLE "AgentConsentBatch" (
  "id" VARCHAR(26) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "confirmedBy" VARCHAR(240) NOT NULL,
  "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
  "basis" VARCHAR(1000),
  "referenceUrl" VARCHAR(2048),
  "note" VARCHAR(2000),
  "actorId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "agentCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentConsentBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentConsentBatch_agentCount_check" CHECK ("agentCount" > 0)
);

CREATE UNIQUE INDEX "AgentConsentBatch_organizationId_projectId_id_key"
  ON "AgentConsentBatch"("organizationId", "projectId", "id");
CREATE INDEX "AgentConsentBatch_projectId_createdAt_idx"
  ON "AgentConsentBatch"("projectId", "createdAt");
CREATE INDEX "Agent_organizationId_projectId_consentBatchId_idx"
  ON "Agent"("organizationId", "projectId", "consentBatchId");

ALTER TABLE "AgentConsentBatch"
  ADD CONSTRAINT "AgentConsentBatch_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent"
  ADD CONSTRAINT "Agent_consentBatch_fkey"
  FOREIGN KEY ("organizationId", "projectId", "consentBatchId")
  REFERENCES "AgentConsentBatch"("organizationId", "projectId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentConsentBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentConsentBatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AgentConsentBatch_rls" ON "AgentConsentBatch"
  FOR SELECT TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (
        NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))
      )
    )
  );
CREATE POLICY "AgentConsentBatch_admin_insert" ON "AgentConsentBatch"
  FOR INSERT TO PUBLIC
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

GRANT SELECT, INSERT ON TABLE "AgentConsentBatch" TO ams_data_hub_web;
GRANT SELECT ON TABLE "AgentConsentBatch" TO ams_data_hub_worker;
GRANT SELECT ON TABLE "AgentConsentBatch" TO ams_data_hub_backup;
