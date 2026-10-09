BEGIN;
CREATE FUNCTION raw_artifact_retention_scope(org TEXT, project TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT current_setting('app.principal_kind',true)='project-job'
    AND current_setting('app.actor_id',true)='raw-artifact-retention'
    AND org=NULLIF(current_setting('app.organization_id',true),'')
    AND project=NULLIF(current_setting('app.project_ids',true),'')
    AND org ~ '^[A-Za-z0-9_-]{1,128}$' AND project ~ '^[A-Za-z0-9_-]{1,128}$'
$$;
CREATE POLICY "Project_raw_retention_read" ON "Project" FOR SELECT TO PUBLIC
  USING (public.raw_artifact_retention_scope("organizationId",id));
CREATE POLICY "Source_raw_retention_read" ON "Source" FOR SELECT TO PUBLIC
  USING (public.raw_artifact_retention_scope("organizationId","projectId"));
CREATE POLICY "SourceRevision_raw_retention_read" ON "SourceRevision" FOR SELECT TO PUBLIC
  USING (public.raw_artifact_retention_scope("organizationId","projectId"));
CREATE POLICY "SourceRevisionRecord_raw_retention_read" ON "SourceRevisionRecord" FOR SELECT TO PUBLIC
  USING (public.raw_artifact_retention_scope("organizationId","projectId"));
CREATE POLICY "InventoryIdentity_raw_retention_read" ON "InventoryIdentity" FOR SELECT TO PUBLIC
  USING (public.raw_artifact_retention_scope("organizationId","projectId"));
CREATE POLICY "DataSafetyState_raw_retention_read" ON "DataSafetyState" FOR SELECT TO PUBLIC USING (
  public.raw_artifact_retention_scope(NULLIF(current_setting('app.organization_id',true),''),
    NULLIF(current_setting('app.project_ids',true),''))
);
GRANT SELECT ON "Project","Source","SourceRevision","SourceRevisionRecord","InventoryIdentity","DataSafetyState"
  TO ams_data_hub_worker;
-- SELECT-only purpose. No Source mutations, web journal grants, private
-- snapshot permissions or storage deletion are activated by this migration.
COMMIT;
