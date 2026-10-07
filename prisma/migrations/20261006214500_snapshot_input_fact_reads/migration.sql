-- Narrow SELECT purpose only. No Source/catalog/agent mutation privileges.
CREATE FUNCTION snapshot_input_reader() RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT current_setting('app.principal_kind', true) = 'project-job'
    AND current_setting('app.actor_id', true) = 'snapshot-input'
    AND NULLIF(current_setting('app.organization_id', true), '') IS NOT NULL
    AND NULLIF(current_setting('app.project_ids', true), '') IS NOT NULL
    AND current_setting('app.project_ids', true) NOT IN ('*')
    AND position(',' in current_setting('app.project_ids', true)) = 0
$$;
DO $policies$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Region','RegionAlias','City','CityAlias','District','DistrictAlias',
    'Developer','DeveloperAlias','Development','DevelopmentAlias','Building','BuildingAlias'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO PUBLIC USING (snapshot_input_reader())',
      table_name || '_snapshot_input_read', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['ProjectCatalogSubscription','ProjectCatalogSubscriptionCity','ProjectCatalogSubscriptionSelection',
    'ProjectPublicContact','EntityEditorial','EntityMediaOrderPolicy','ProjectUrlPolicy','ProjectUrlEntry','ProjectRedirect','ProjectUrlTombstone',
    'PublicUrlIdReservation','ListingDevelopmentLink','Agent','MediaSource','MediaAsset','PriceObservation','SharedMediaAsset',
    'InventoryIdentity','InventoryLifecycleEvent','Source','SourceSafetyPolicy'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO PUBLIC USING (snapshot_input_scope("organizationId", "projectId"))',
      table_name || '_snapshot_input_read', table_name);
    EXECUTE format('GRANT SELECT ON %I TO ams_data_hub_worker', table_name);
  END LOOP;
END $policies$;
CREATE POLICY "SourceRevision_snapshot_input_read" ON "SourceRevision" FOR SELECT TO PUBLIC
  USING (snapshot_input_scope("organizationId", "projectId") AND "status" = 'GOOD');
CREATE POLICY "SourceRevisionRecord_snapshot_input_read" ON "SourceRevisionRecord" FOR SELECT TO PUBLIC
  USING (snapshot_input_scope("organizationId", "projectId") AND EXISTS (
    SELECT 1 FROM "SourceRevision" r WHERE r."id" = "SourceRevisionRecord"."revisionId"
      AND r."organizationId" = "SourceRevisionRecord"."organizationId" AND r."projectId" = "SourceRevisionRecord"."projectId"
      AND r."sourceId" = "SourceRevisionRecord"."sourceId" AND r."status" = 'GOOD'));
CREATE POLICY "DataSafetyState_snapshot_input_read" ON "DataSafetyState" FOR SELECT TO PUBLIC USING (snapshot_input_reader());
