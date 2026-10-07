-- Existing permissive policies remain valid for legitimate import/mirror/admin
-- workflows. The capture purpose cannot mutate the facts it reads or the
-- publication floor it uses. Receipt/parts/counter policies are unchanged.
CREATE FUNCTION snapshot_fact_write_allowed() RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT NOT (COALESCE(current_setting('app.principal_kind', true), '') IN ('job', 'project-job')
    AND COALESCE(current_setting('app.actor_id', true), '') = 'snapshot-input')
$$;
DO $policies$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Region','RegionAlias','City','CityAlias','District','DistrictAlias',
    'Developer','DeveloperAlias','Development','DevelopmentAlias','Building','BuildingAlias',
    'ProjectCatalogSubscription','ProjectCatalogSubscriptionCity','ProjectCatalogSubscriptionSelection',
    'ProjectPublicContact','EntityEditorial','EntityMediaOrderPolicy','ProjectUrlPolicy','ProjectUrlEntry',
    'ProjectRedirect','ProjectUrlTombstone','PublicUrlIdReservation','ListingDevelopmentLink','Agent',
    'MediaSource','MediaAsset','PriceObservation','SharedMediaAsset','InventoryIdentity','InventoryLifecycleEvent',
    'Source','SourceSafetyPolicy','SourceRevision','SourceRevisionRecord','Project','DataSafetyState',
    'ProjectCurrentSnapshotManifest','DeliveryRun','DevelopmentExternalIdentity'
  ] LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT TO PUBLIC WITH CHECK (snapshot_fact_write_allowed())',
      table_name || '_snapshot_fact_no_insert', table_name);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE TO PUBLIC USING (snapshot_fact_write_allowed()) WITH CHECK (snapshot_fact_write_allowed())',
      table_name || '_snapshot_fact_no_update', table_name);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE TO PUBLIC USING (snapshot_fact_write_allowed())',
      table_name || '_snapshot_fact_no_delete', table_name);
  END LOOP;
END $policies$;
