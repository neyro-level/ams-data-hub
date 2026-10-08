BEGIN;
-- Legitimate web mutations of legacy SourceRevision rows must not require
-- web SELECT on private operation journals. Only this non-returning trigger
-- checks them through the existing worker's exact-context FORCE RLS policies.
ALTER FUNCTION public.check_raw_artifact_put_receipt() SECURITY DEFINER;
ALTER FUNCTION public.check_raw_artifact_put_receipt() SET row_security = on;
ALTER FUNCTION public.check_raw_artifact_put_receipt() SET search_path = pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.check_raw_artifact_put_receipt() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_raw_artifact_put_receipt() TO ams_data_hub_worker;
DO $$ DECLARE had_create BOOLEAN; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ams_data_hub_worker' AND NOT rolsuper AND NOT rolbypassrls)
  THEN RAISE EXCEPTION 'RAW_RECEIPT_DEFINER_ROLE_INVALID'; END IF;
  had_create := has_schema_privilege('ams_data_hub_worker','public','CREATE');
  IF NOT had_create THEN GRANT CREATE ON SCHEMA public TO ams_data_hub_worker; END IF;
  ALTER FUNCTION public.check_raw_artifact_put_receipt() OWNER TO ams_data_hub_worker;
  IF NOT had_create THEN REVOKE CREATE ON SCHEMA public FROM ams_data_hub_worker; END IF;
END $$;
-- No web journal grant, RLS bypass, data rewrite or invented legacy PUT.
COMMIT;
