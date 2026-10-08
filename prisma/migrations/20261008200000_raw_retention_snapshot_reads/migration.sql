BEGIN;
-- Exact purpose is defined by the preceding Source-owned retention migration.
DO $$
DECLARE owned_table TEXT;
BEGIN
  FOREACH owned_table IN ARRAY ARRAY['SnapshotBuildInput','SnapshotBuildInputPart',
    'SnapshotPublicationBinding','SnapshotArtifactStageReceipt','SnapshotRollbackReservation',
    'SnapshotRollbackBinding','ProjectCurrentSnapshotManifest','DeliveryRun','OperationalActionRequest']
  LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO PUBLIC USING (public.raw_artifact_retention_scope("organizationId","projectId"))',
      owned_table || '_raw_retention_read', owned_table);
    EXECUTE format('GRANT SELECT ON public.%I TO ams_data_hub_worker', owned_table);
  END LOOP;
END $$;
-- No INSERT/UPDATE/DELETE policies, web grants or cleanup activation.
COMMIT;
