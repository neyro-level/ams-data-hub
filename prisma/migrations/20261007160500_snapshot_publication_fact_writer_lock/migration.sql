-- Serialize only facts used by final snapshot admission. Statement triggers
-- acquire global before PostgreSQL locks target rows, including zero-row CAS.
-- Existing row-level guards, RLS predicates and grants remain unchanged.
CREATE FUNCTION lock_snapshot_publication_fact_writer() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0));
  RETURN NULL;
END $$;

DO $writer_locks$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Project','DataSafetyState','Source','SourceSafetyPolicy','InventoryIdentity',
    'ProjectCatalogSubscription','ProjectCatalogSubscriptionCity','ProjectCatalogSubscriptionSelection',
    'ProjectPublicContact','Agent','ListingAgentBinding','MediaSource','MediaAsset','SharedMediaAsset',
    'Developer','Development','Building'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION lock_snapshot_publication_fact_writer()',
      table_name || '_snapshot_publication_writer_lock', table_name);
  END LOOP;
END $writer_locks$;
