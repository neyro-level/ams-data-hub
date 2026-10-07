-- Forward-only durable identity. No object IO or current-pointer change here.
-- Canonical policy-name correction; identical existing read predicate/grants.
DROP POLICY "ListingAgentBinding_read" ON "ListingAgentBinding";
CREATE POLICY "ListingAgentBinding_rls" ON "ListingAgentBinding" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin'
  OR agent_matching_scope("organizationId", "projectId") OR snapshot_input_scope("organizationId", "projectId"));
CREATE TABLE "SnapshotPublicationBinding" (
  "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "buildInputId" TEXT NOT NULL,
  "inputHash" CHAR(64) NOT NULL CHECK ("inputHash" ~ '^[a-f0-9]{64}$'),
  "publishSequence" INTEGER NOT NULL CHECK ("publishSequence" > 0),
  "keyId" VARCHAR(240) NOT NULL CHECK (length("keyId") > 0),
  "manifestSha256" CHAR(64) NOT NULL CHECK ("manifestSha256" ~ '^[a-f0-9]{64}$'),
  "manifestCanonical" TEXT NOT NULL CHECK (octet_length("manifestCanonical") BETWEEN 1 AND 2097152),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("organizationId", "projectId", "buildInputId"),
  UNIQUE ("organizationId", "projectId", "publishSequence"),
  FOREIGN KEY ("organizationId", "projectId", "buildInputId")
    REFERENCES "SnapshotBuildInput"("organizationId", "projectId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CHECK (encode(sha256(convert_to("manifestCanonical", 'UTF8')), 'hex') = "manifestSha256")
);
CREATE FUNCTION snapshot_publication_scope(organization_id TEXT, project_id TEXT) RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT current_setting('app.principal_kind', true) = 'project-job'
    AND current_setting('app.actor_id', true) = 'snapshot-publication'
    AND organization_id = NULLIF(current_setting('app.organization_id', true), '')
    AND project_id = NULLIF(current_setting('app.project_ids', true), '')
$$;
ALTER TABLE "SnapshotPublicationBinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SnapshotPublicationBinding" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SnapshotPublicationBinding_rls" ON "SnapshotPublicationBinding" FOR SELECT TO PUBLIC
  USING (snapshot_publication_scope("organizationId", "projectId"));
CREATE POLICY "SnapshotPublicationBinding_insert" ON "SnapshotPublicationBinding" FOR INSERT TO PUBLIC
  WITH CHECK (snapshot_publication_scope("organizationId", "projectId"));
GRANT SELECT, INSERT ON "SnapshotPublicationBinding" TO ams_data_hub_worker;
GRANT SELECT ON "SnapshotPublicationBinding" TO ams_data_hub_backup;
CREATE POLICY "SnapshotBuildInput_publication_read" ON "SnapshotBuildInput" FOR SELECT TO PUBLIC
  USING (snapshot_publication_scope("organizationId", "projectId"));
CREATE POLICY "SnapshotBuildInputPart_publication_read" ON "SnapshotBuildInputPart" FOR SELECT TO PUBLIC
  USING (snapshot_publication_scope("organizationId", "projectId"));

CREATE FUNCTION protect_snapshot_publication_binding() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE receipt "SnapshotBuildInput"%ROWTYPE; manifest JSONB;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'SNAPSHOT_PUBLICATION_BINDING_IMMUTABLE'; END IF;
  SELECT * INTO receipt FROM "SnapshotBuildInput" WHERE "organizationId" = NEW."organizationId"
    AND "projectId" = NEW."projectId" AND "id" = NEW."buildInputId";
  IF NOT FOUND OR receipt."inputHash" IS DISTINCT FROM NEW."inputHash"
    OR receipt."publishSequence" IS DISTINCT FROM NEW."publishSequence"
    THEN RAISE EXCEPTION 'SNAPSHOT_PUBLICATION_RECEIPT_INVALID'; END IF;
  IF octet_length(NEW."manifestCanonical") > 2097152 THEN RAISE EXCEPTION 'SNAPSHOT_PUBLICATION_MANIFEST_LIMIT'; END IF;
  manifest := NEW."manifestCanonical"::jsonb;
  IF jsonb_typeof(manifest) IS DISTINCT FROM 'object'
    OR manifest->>'projectId' IS DISTINCT FROM NEW."projectId"
    OR manifest->>'keyId' IS DISTINCT FROM NEW."keyId"
    OR manifest->>'schemaMajor' IS DISTINCT FROM '1'
    OR manifest->>'schemaMinor' IS DISTINCT FROM receipt."schemaMinor"::text
    OR manifest->>'publishSequence' IS DISTINCT FROM receipt."publishSequence"::text
    OR manifest->>'catalogRevision' IS DISTINCT FROM receipt."catalogRevision"::text
    OR (manifest->>'generatedAt')::timestamptz IS DISTINCT FROM receipt."capturedAt"
    OR (manifest->>'publishedAt')::timestamptz IS DISTINCT FROM receipt."capturedAt"
    OR jsonb_typeof(manifest->'files') IS DISTINCT FROM 'array'
    OR jsonb_array_length(manifest->'files') IS DISTINCT FROM 13
    OR jsonb_typeof(manifest->'sourceRevisions') IS DISTINCT FROM 'array'
    OR jsonb_array_length(manifest->'sourceRevisions') > 10000
    OR jsonb_typeof(manifest->'signature') IS DISTINCT FROM 'string'
    OR length(manifest->>'signature') NOT BETWEEN 1 AND 4096
    THEN RAISE EXCEPTION 'SNAPSHOT_PUBLICATION_MANIFEST_INVALID'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SnapshotPublicationBinding_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "SnapshotPublicationBinding"
  FOR EACH ROW EXECUTE FUNCTION protect_snapshot_publication_binding();

-- Legacy broad job grants must not make this new read/bind purpose a fact writer.
CREATE FUNCTION snapshot_publication_fact_write_allowed() RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT NOT (COALESCE(current_setting('app.principal_kind', true), '') IN ('job', 'project-job')
    AND COALESCE(current_setting('app.actor_id', true), '') = 'snapshot-publication')
$$;
DO $policies$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Region','RegionAlias','City','CityAlias','District','DistrictAlias',
    'Developer','DeveloperAlias','Development','DevelopmentAlias','Building','BuildingAlias',
    'ProjectCatalogSubscription','ProjectCatalogSubscriptionCity','ProjectCatalogSubscriptionSelection',
    'ProjectPublicContact','EntityEditorial','EntityMediaOrderPolicy','ProjectUrlPolicy','ProjectUrlEntry',
    'ProjectRedirect','ProjectUrlTombstone','PublicUrlIdReservation','ListingDevelopmentLink','ListingAgentBinding','Agent',
    'MediaSource','MediaAsset','PriceObservation','SharedMediaAsset','InventoryIdentity','InventoryLifecycleEvent',
    'Source','SourceSafetyPolicy','SourceRevision','SourceRevisionRecord','Project','DataSafetyState',
    'DevelopmentExternalIdentity','ProjectSnapshotSequence','SnapshotBuildInput','SnapshotBuildInputPart'
  ] LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT TO PUBLIC WITH CHECK (snapshot_publication_fact_write_allowed())',
      table_name || '_publication_fact_no_insert', table_name);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE TO PUBLIC USING (snapshot_publication_fact_write_allowed()) WITH CHECK (snapshot_publication_fact_write_allowed())',
      table_name || '_publication_fact_no_update', table_name);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE TO PUBLIC USING (snapshot_publication_fact_write_allowed())',
      table_name || '_publication_fact_no_delete', table_name);
  END LOOP;
END $policies$;
