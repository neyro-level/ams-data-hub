-- Exact read-only publication purpose, including historical GOOD metadata.
DO $source_reads$
DECLARE table_name TEXT; predicate TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Source','InventoryIdentity','SourceRevision','SourceRevisionRecord'] LOOP
    predicate := 'snapshot_publication_scope("organizationId", "projectId")';
    IF table_name = 'SourceRevision' THEN
      predicate := predicate || ' AND "status" = ''GOOD''';
    ELSIF table_name = 'SourceRevisionRecord' THEN
      predicate := predicate || ' AND EXISTS (SELECT 1 FROM "SourceRevision" r WHERE r."id" = "SourceRevisionRecord"."revisionId" AND r."organizationId" = "SourceRevisionRecord"."organizationId" AND r."projectId" = "SourceRevisionRecord"."projectId" AND r."sourceId" = "SourceRevisionRecord"."sourceId" AND r."status" = ''GOOD'')';
    END IF;
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO PUBLIC USING (%s)',
      table_name || '_publication_read', table_name, predicate);
    -- Existing broad job policies must not permit wildcard/multi-project/legacy
    -- publication readers. Other established actors retain their predicates.
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT TO PUBLIC USING (snapshot_publication_fact_write_allowed() OR (%s))',
      table_name || '_publication_read_scope', table_name, predicate);
  END LOOP;
END $source_reads$;
