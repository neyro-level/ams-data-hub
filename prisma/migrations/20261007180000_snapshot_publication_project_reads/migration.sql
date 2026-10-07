CREATE FUNCTION snapshot_publication_reader() RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT current_setting('app.principal_kind', true) = 'project-job'
    AND current_setting('app.actor_id', true) = 'snapshot-publication'
    AND NULLIF(current_setting('app.organization_id', true), '') IS NOT NULL
    AND NULLIF(current_setting('app.project_ids', true), '') IS NOT NULL
    AND current_setting('app.project_ids', true) <> '*'
    AND position(',' in current_setting('app.project_ids', true)) = 0
$$;
DO $project_reads$
DECLARE table_name TEXT; predicate TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Project','ProjectPublicContact','Agent','ListingAgentBinding','DataSafetyState'] LOOP
    IF table_name = 'Project' THEN predicate := 'snapshot_publication_scope("organizationId", "id")';
    ELSIF table_name = 'DataSafetyState' THEN predicate := 'snapshot_publication_reader() AND "id" = ''global''';
    ELSE predicate := 'snapshot_publication_scope("organizationId", "projectId")'; END IF;
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO PUBLIC USING (%s)', table_name || '_publication_read', table_name, predicate);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT TO PUBLIC USING (snapshot_publication_fact_write_allowed() OR (%s))',
      table_name || '_publication_read_scope', table_name, predicate);
  END LOOP;
END $project_reads$;
