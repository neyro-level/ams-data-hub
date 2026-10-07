DO $media_reads$
DECLARE table_name TEXT; predicate TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['MediaSource','MediaAsset','SharedMediaAsset'] LOOP
    predicate := 'snapshot_publication_scope("organizationId", "projectId")';
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO PUBLIC USING (%s)', table_name || '_publication_read', table_name, predicate);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT TO PUBLIC USING (snapshot_publication_fact_write_allowed() OR (%s))',
      table_name || '_publication_read_scope', table_name, predicate);
  END LOOP;
END $media_reads$;
