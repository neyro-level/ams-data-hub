BEGIN;
-- Fresh capture admission has scoped read-only access, never web access.
CREATE POLICY "RawArtifactDeletion_snapshot_input_read" ON public."RawArtifactDeletion"
  FOR SELECT TO ams_data_hub_worker USING (public.snapshot_input_scope("organizationId","projectId"));
CREATE FUNCTION public.lock_raw_deletion_writer() RETURNS TRIGGER LANGUAGE plpgsql
  SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0));
  RETURN NULL;
END $$;
CREATE TRIGGER "RawArtifactDeletion_writer_lock" BEFORE INSERT OR UPDATE OR DELETE
  ON public."RawArtifactDeletion" FOR EACH STATEMENT EXECUTE FUNCTION public.lock_raw_deletion_writer();
COMMIT;
