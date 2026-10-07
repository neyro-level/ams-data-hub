DO $catalog_reads$
DECLARE table_name TEXT; predicate TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['ProjectCatalogSubscription','ProjectCatalogSubscriptionCity','ProjectCatalogSubscriptionSelection','Developer','Development','Building'] LOOP
    IF table_name IN ('Developer','Development','Building') THEN predicate := 'snapshot_publication_reader()';
    ELSE predicate := 'snapshot_publication_scope("organizationId", "projectId")'; END IF;
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO PUBLIC USING (%s)', table_name || '_publication_read', table_name, predicate);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT TO PUBLIC USING (snapshot_publication_fact_write_allowed() OR (%s))',
      table_name || '_publication_read_scope', table_name, predicate);
  END LOOP;
END $catalog_reads$;
