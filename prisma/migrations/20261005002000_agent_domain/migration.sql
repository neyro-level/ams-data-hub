CREATE TYPE "AgentRole" AS ENUM ('AGENT', 'LAWYER', 'MORTGAGE_BROKER', 'MANAGER', 'OTHER');
CREATE TYPE "AgentOrigin" AS ENUM ('FEED', 'MANUAL');
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'HIDDEN', 'DEPARTED');
CREATE TYPE "AgentListingPresenceStatus" AS ENUM ('HAS_ACTIVE_LISTINGS', 'NO_ACTIVE_LISTINGS', 'UNKNOWN');
CREATE TYPE "AgentMatchReviewStatus" AS ENUM ('PENDING', 'RESOLVED', 'REJECTED');
CREATE TYPE "AgentMergeEventType" AS ENUM ('MERGE', 'RELINK', 'SPLIT');

CREATE TABLE "Agent" (
  "id" TEXT NOT NULL,
  "uid" VARCHAR(26) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "slug" VARCHAR(200) NOT NULL,
  "role" "AgentRole" NOT NULL DEFAULT 'AGENT',
  "origin" "AgentOrigin" NOT NULL DEFAULT 'MANUAL',
  "fullName" VARCHAR(240) NOT NULL,
  "position" VARCHAR(240),
  "bio" VARCHAR(4000),
  "specializations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "photoMediaId" TEXT,
  "feedPhotoMediaId" TEXT,
  "workPhone" VARCHAR(40),
  "workEmail" VARCHAR(320),
  "messengers" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "showOnSite" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
  "listingPresenceStatus" "AgentListingPresenceStatus" NOT NULL DEFAULT 'UNKNOWN',
  "consentConfirmedBy" TEXT,
  "consentConfirmedAt" TIMESTAMPTZ(3),
  "consentBasis" VARCHAR(1000),
  "consentBatchId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Agent_uid_key" ON "Agent"("uid");
CREATE UNIQUE INDEX "Agent_organizationId_projectId_uid_key" ON "Agent"("organizationId", "projectId", "uid");
CREATE UNIQUE INDEX "Agent_projectId_slug_key" ON "Agent"("projectId", "slug");
CREATE INDEX "Agent_projectId_status_sortOrder_idx" ON "Agent"("projectId", "status", "sortOrder");
CREATE INDEX "Agent_projectId_listingPresenceStatus_idx" ON "Agent"("projectId", "listingPresenceStatus");

CREATE TABLE "AgentExternalIdentity" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "agentUid" VARCHAR(26) NOT NULL,
  "sourceId" VARCHAR(128) NOT NULL,
  "externalId" VARCHAR(255),
  "phoneNorm" VARCHAR(40),
  "emailNorm" VARCHAR(320),
  "sharedOfficePhone" BOOLEAN NOT NULL DEFAULT false,
  "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "AgentExternalIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentExternalIdentity_projectId_sourceId_externalId_key" ON "AgentExternalIdentity"("projectId", "sourceId", "externalId");
CREATE INDEX "AgentExternalIdentity_projectId_phoneNorm_idx" ON "AgentExternalIdentity"("projectId", "phoneNorm");
CREATE INDEX "AgentExternalIdentity_projectId_emailNorm_idx" ON "AgentExternalIdentity"("projectId", "emailNorm");
CREATE INDEX "AgentExternalIdentity_agentUid_idx" ON "AgentExternalIdentity"("agentUid");

CREATE TABLE "AgentMatchReview" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceId" VARCHAR(128) NOT NULL,
  "candidateAgentUid" VARCHAR(26),
  "proposedAgentUid" VARCHAR(26),
  "normalizedFullName" VARCHAR(240) NOT NULL,
  "phoneNorm" VARCHAR(40),
  "emailNorm" VARCHAR(320),
  "reason" VARCHAR(500) NOT NULL,
  "status" "AgentMatchReviewStatus" NOT NULL DEFAULT 'PENDING',
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AgentMatchReview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentMatchReview_projectId_status_createdAt_idx" ON "AgentMatchReview"("projectId", "status", "createdAt");
CREATE INDEX "AgentMatchReview_candidateAgentUid_idx" ON "AgentMatchReview"("candidateAgentUid");

CREATE TABLE "AgentMergeEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "type" "AgentMergeEventType" NOT NULL,
  "sourceAgentUid" VARCHAR(26) NOT NULL,
  "targetAgentUid" VARCHAR(26) NOT NULL,
  "externalIdentityId" TEXT,
  "actorId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "detail" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentMergeEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentMergeEvent_projectId_createdAt_idx" ON "AgentMergeEvent"("projectId", "createdAt");
CREATE INDEX "AgentMergeEvent_sourceAgentUid_idx" ON "AgentMergeEvent"("sourceAgentUid");
CREATE INDEX "AgentMergeEvent_targetAgentUid_idx" ON "AgentMergeEvent"("targetAgentUid");

ALTER TABLE "Agent" ADD CONSTRAINT "Agent_project_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentExternalIdentity" ADD CONSTRAINT "AgentExternalIdentity_agent_fkey" FOREIGN KEY ("organizationId", "projectId", "agentUid") REFERENCES "Agent"("organizationId", "projectId", "uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentExternalIdentity" ADD CONSTRAINT "AgentExternalIdentity_project_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentMatchReview" ADD CONSTRAINT "AgentMatchReview_project_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentMergeEvent" ADD CONSTRAINT "AgentMergeEvent_project_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Agent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Agent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AgentExternalIdentity" ENABLE ROW LEVEL SECURITY; ALTER TABLE "AgentExternalIdentity" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AgentMatchReview" ENABLE ROW LEVEL SECURITY; ALTER TABLE "AgentMatchReview" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AgentMergeEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "AgentMergeEvent" FORCE ROW LEVEL SECURITY;

CREATE POLICY "Agent_rls" ON "Agent" FOR SELECT TO PUBLIC USING (current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff') OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job') AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))));
CREATE POLICY "Agent_admin_write" ON "Agent" FOR ALL TO PUBLIC USING (current_setting('app.principal_kind', true) = 'platform-admin') WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');
CREATE POLICY "Agent_job_write" ON "Agent" FOR ALL TO PUBLIC USING (current_setting('app.principal_kind', true) = 'job' AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))) WITH CHECK (current_setting('app.principal_kind', true) = 'job' AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))));
CREATE POLICY "AgentExternalIdentity_rls" ON "AgentExternalIdentity" FOR SELECT TO PUBLIC USING (current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff') OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job') AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))));
CREATE POLICY "AgentExternalIdentity_write" ON "AgentExternalIdentity" FOR ALL TO PUBLIC USING (current_setting('app.principal_kind', true) IN ('platform-admin', 'job') AND (current_setting('app.principal_kind', true) = 'platform-admin' OR ("organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))))) WITH CHECK (current_setting('app.principal_kind', true) IN ('platform-admin', 'job') AND (current_setting('app.principal_kind', true) = 'platform-admin' OR ("organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))))));
CREATE POLICY "AgentMatchReview_rls" ON "AgentMatchReview" FOR SELECT TO PUBLIC USING (current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff') OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job') AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))));
CREATE POLICY "AgentMatchReview_write" ON "AgentMatchReview" FOR ALL TO PUBLIC USING (current_setting('app.principal_kind', true) IN ('platform-admin', 'job') AND (current_setting('app.principal_kind', true) = 'platform-admin' OR ("organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))))) WITH CHECK (current_setting('app.principal_kind', true) IN ('platform-admin', 'job') AND (current_setting('app.principal_kind', true) = 'platform-admin' OR ("organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ','))))));
CREATE POLICY "AgentMergeEvent_rls" ON "AgentMergeEvent" FOR SELECT TO PUBLIC USING (current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff') OR (current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job') AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '') AND (NULLIF(current_setting('app.project_ids', true), '') = '*' OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))));
CREATE POLICY "AgentMergeEvent_admin_insert" ON "AgentMergeEvent" FOR INSERT TO PUBLIC WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

CREATE FUNCTION enforce_agent_field_ownership() RETURNS trigger AS $$
BEGIN
  IF NEW."uid" IS DISTINCT FROM OLD."uid" OR NEW."origin" IS DISTINCT FROM OLD."origin" THEN
    RAISE EXCEPTION 'agent identity is immutable';
  END IF;
  IF current_setting('app.principal_kind', true) = 'job' AND (
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

CREATE TRIGGER "Agent_field_ownership_guard"
BEFORE UPDATE ON "Agent"
FOR EACH ROW EXECUTE FUNCTION enforce_agent_field_ownership();

GRANT SELECT, INSERT, UPDATE ON TABLE "Agent", "AgentExternalIdentity", "AgentMatchReview" TO ams_data_hub_web;
GRANT SELECT, INSERT ON TABLE "AgentMergeEvent" TO ams_data_hub_web;
GRANT SELECT, INSERT, UPDATE ON TABLE "Agent" TO ams_data_hub_worker;
GRANT SELECT ON TABLE "AgentMergeEvent" TO ams_data_hub_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE "AgentExternalIdentity", "AgentMatchReview" TO ams_data_hub_worker;
GRANT SELECT ON TABLE "Agent", "AgentExternalIdentity", "AgentMatchReview", "AgentMergeEvent" TO ams_data_hub_backup;
