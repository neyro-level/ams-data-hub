-- Project-state-owned, value-free confirmed assignment to an immutable GOOD fact.
CREATE TABLE "ListingAgentBinding" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL, "sourceRevisionId" TEXT NOT NULL,
  "inventoryUid" VARCHAR(26) NOT NULL, "recordHash" CHAR(64) NOT NULL CHECK ("recordHash" ~ '^[a-f0-9]{64}$'),
  "agentUid" VARCHAR(26) NOT NULL, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  UNIQUE ("organizationId", "projectId", "sourceRevisionId", "inventoryUid"),
  FOREIGN KEY ("organizationId", "projectId", "sourceId", "sourceRevisionId") REFERENCES "SourceRevision"("organizationId", "projectId", "sourceId", "id"),
  FOREIGN KEY ("organizationId", "projectId", "inventoryUid") REFERENCES "InventoryIdentity"("organizationId", "projectId", "uid"),
  FOREIGN KEY ("organizationId", "projectId", "agentUid") REFERENCES "Agent"("organizationId", "projectId", "uid")
);
CREATE INDEX "ListingAgentBinding_organizationId_projectId_id_idx" ON "ListingAgentBinding"("organizationId", "projectId", "id");
ALTER TABLE "ListingAgentBinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ListingAgentBinding" FORCE ROW LEVEL SECURITY;
CREATE FUNCTION agent_matching_scope(org TEXT, project TEXT) RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT current_setting('app.principal_kind', true) = 'project-job'
    AND current_setting('app.actor_id', true) = 'agent-matching'
    AND org = NULLIF(current_setting('app.organization_id', true), '')
    AND project = NULLIF(current_setting('app.project_ids', true), '')
    AND project <> '*' AND position(',' in project) = 0
$$;
CREATE POLICY "ListingAgentBinding_read" ON "ListingAgentBinding" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin'
  OR agent_matching_scope("organizationId", "projectId") OR snapshot_input_scope("organizationId", "projectId"));
CREATE POLICY "ListingAgentBinding_write" ON "ListingAgentBinding" FOR ALL TO PUBLIC USING (
  agent_matching_scope("organizationId", "projectId")) WITH CHECK (agent_matching_scope("organizationId", "projectId"));
CREATE POLICY "ListingAgentBinding_no_capture_insert" ON "ListingAgentBinding" AS RESTRICTIVE FOR INSERT TO PUBLIC WITH CHECK (snapshot_fact_write_allowed());
CREATE POLICY "ListingAgentBinding_no_capture_update" ON "ListingAgentBinding" AS RESTRICTIVE FOR UPDATE TO PUBLIC USING (snapshot_fact_write_allowed()) WITH CHECK (snapshot_fact_write_allowed());
CREATE POLICY "ListingAgentBinding_no_capture_delete" ON "ListingAgentBinding" AS RESTRICTIVE FOR DELETE TO PUBLIC USING (snapshot_fact_write_allowed());
-- SELECT-only extension; no new Source/GOOD mutation purpose.
CREATE POLICY "Source_agent_matching_read" ON "Source" FOR SELECT TO PUBLIC USING (agent_matching_scope("organizationId", "projectId"));
CREATE POLICY "InventoryIdentity_agent_matching_read" ON "InventoryIdentity" FOR SELECT TO PUBLIC USING (agent_matching_scope("organizationId", "projectId"));
CREATE POLICY "DataSafetyState_agent_matching_read" ON "DataSafetyState" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'project-job' AND current_setting('app.actor_id', true) = 'agent-matching');
CREATE POLICY "SourceRevision_agent_matching_read" ON "SourceRevision" FOR SELECT TO PUBLIC USING (
  agent_matching_scope("organizationId", "projectId") AND "status" = 'GOOD');
CREATE POLICY "SourceRevisionRecord_agent_matching_read" ON "SourceRevisionRecord" FOR SELECT TO PUBLIC USING (
  agent_matching_scope("organizationId", "projectId") AND EXISTS (SELECT 1 FROM "SourceRevision" r
    WHERE r."id" = "revisionId" AND r."status" = 'GOOD'));
CREATE FUNCTION enforce_listing_agent_fact() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "SourceRevisionRecord" r JOIN "SourceRevision" v ON v."id" = r."revisionId"
    JOIN "InventoryIdentity" i ON i."uid" = r."inventoryUid" AND i."sourceId" = r."sourceId"
    WHERE r."organizationId" = NEW."organizationId" AND r."projectId" = NEW."projectId"
      AND r."sourceId" = NEW."sourceId" AND r."revisionId" = NEW."sourceRevisionId"
      AND r."inventoryUid" = NEW."inventoryUid" AND r."recordHash" = NEW."recordHash" AND v."status" = 'GOOD'
      AND i."organizationId" = NEW."organizationId" AND i."projectId" = NEW."projectId") THEN
    RAISE EXCEPTION 'LISTING_AGENT_FACT_INVALID';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ListingAgentBinding_fact" BEFORE INSERT OR UPDATE ON "ListingAgentBinding"
  FOR EACH ROW EXECUTE FUNCTION enforce_listing_agent_fact();
GRANT SELECT, INSERT, UPDATE, DELETE ON "ListingAgentBinding" TO ams_data_hub_worker;
GRANT SELECT ON "ListingAgentBinding" TO ams_data_hub_web, ams_data_hub_backup;
