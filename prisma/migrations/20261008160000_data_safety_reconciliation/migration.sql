BEGIN;
-- Counts-only recovery capability. Reuse the existing NOBYPASS runtime definer;
-- web receives neither SELECT on private receipts nor captured payloads.
CREATE FUNCTION public.data_safety_reconciliation_scope() RETURNS BOOLEAN
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT current_setting('app.principal_kind',true)='platform-admin'
    AND NULLIF(current_setting('app.actor_id',true),'') IS NOT NULL
    AND COALESCE(current_setting('app.organization_id',true),'')=''
    AND current_setting('app.project_ids',true)='*'
$$;

CREATE FUNCTION public.data_safety_consistency_report()
RETURNS TABLE ("uidConflicts" INTEGER,"publicUrlIdConflicts" INTEGER,"publishSequenceConflicts" INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET row_security=on AS $$
BEGIN
  IF public.data_safety_reconciliation_scope() IS DISTINCT FROM TRUE
    OR current_user<>'ams_data_hub_worker'
  THEN RAISE EXCEPTION 'DATA_SAFETY_RECONCILIATION_SCOPE_DENIED'; END IF;
  RETURN QUERY
      WITH identities AS (
        SELECT 'inventory' AS kind, uid FROM public."InventoryIdentity"
        UNION ALL SELECT 'agent', uid FROM public."Agent"
        UNION ALL SELECT 'region', uid FROM public."Region"
        UNION ALL SELECT 'city', uid FROM public."City"
        UNION ALL SELECT 'district', uid FROM public."District"
        UNION ALL SELECT 'developer', uid FROM public."Developer"
        UNION ALL SELECT 'development', uid FROM public."Development"
        UNION ALL SELECT 'building', uid FROM public."Building"
      ), reservations AS (
        SELECT "organizationId", "projectId", "publishSequence" FROM public."SnapshotBuildInput"
        UNION ALL SELECT "organizationId", "projectId", "publishSequence" FROM public."SnapshotRollbackReservation"
      ), sequences AS (
        SELECT * FROM reservations
        UNION ALL SELECT "organizationId", "projectId", "publishSequence" FROM public."SnapshotPublicationBinding"
        UNION ALL SELECT "organizationId", "projectId", "publishSequence" FROM public."SnapshotRollbackBinding"
        UNION ALL SELECT "organizationId", "projectId", "publishSequence" FROM public."DeliveryRun"
        UNION ALL SELECT "organizationId", "projectId", "publishSequence" FROM public."ProjectCurrentSnapshotManifest"
      )
      SELECT (
        (SELECT count(*) FROM identities WHERE uid !~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$') +
        (SELECT count(*) FROM (SELECT kind, uid FROM identities GROUP BY kind, uid HAVING count(*) > 1) duplicates) +
        (SELECT count(*) FROM public."InventoryIdentity" i LEFT JOIN public."Source" s ON s.id=i."sourceId"
          WHERE s.id IS NULL OR s."organizationId"<>i."organizationId" OR s."projectId"<>i."projectId")
      )::int AS "uidConflicts", (
        (SELECT count(*) FROM public."PublicUrlIdReservation" WHERE "publicUrlId" !~ '^[0-9a-hjkmnp-tv-z]{16}$'
          OR "subjectUid" !~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$') +
        (SELECT count(*) FROM (SELECT "projectId", "publicUrlId" FROM public."PublicUrlIdReservation"
          GROUP BY "projectId", "publicUrlId" HAVING count(*)>1) duplicates) +
        (SELECT count(*) FROM public."ProjectUrlEntry" e LEFT JOIN public."PublicUrlIdReservation" r ON r.id=e."reservationId"
          WHERE r.id IS NULL OR e."organizationId"<>r."organizationId" OR e."projectId"<>r."projectId") +
        (SELECT count(*) FROM public."ProjectUrlTombstone" t LEFT JOIN public."PublicUrlIdReservation" r ON r.id=t."reservationId"
          WHERE r.id IS NULL OR t."organizationId"<>r."organizationId" OR t."projectId"<>r."projectId")
      )::int AS "publicUrlIdConflicts", (
        (SELECT count(*) FROM (SELECT "organizationId", "projectId", "publishSequence" FROM reservations
          GROUP BY "organizationId", "projectId", "publishSequence" HAVING count(*)>1) duplicates) +
        (SELECT count(*) FROM sequences s LEFT JOIN public."ProjectSnapshotSequence" c
          ON c."organizationId"=s."organizationId" AND c."projectId"=s."projectId"
          WHERE s."publishSequence"<1 OR c."projectId" IS NULL OR c."lastReservedSequence"<s."publishSequence") +
        (SELECT count(*) FROM public."ProjectSnapshotSequence" WHERE "lastReservedSequence"<0) +
        (SELECT count(*) FROM public."SnapshotPublicationBinding" b LEFT JOIN public."SnapshotBuildInput" i ON i.id=b."buildInputId"
          WHERE i.id IS NULL OR b."organizationId"<>i."organizationId" OR b."projectId"<>i."projectId"
            OR b."publishSequence"<>i."publishSequence" OR b."inputHash"<>i."inputHash") +
        (SELECT count(*) FROM public."SnapshotRollbackBinding" b LEFT JOIN public."SnapshotRollbackReservation" r ON r."requestId"=b."requestId"
          WHERE r."requestId" IS NULL OR b."organizationId"<>r."organizationId" OR b."projectId"<>r."projectId"
            OR b."publishSequence"<>r."publishSequence") +
        (SELECT count(*) FROM public."SnapshotArtifactStageReceipt" s LEFT JOIN public."SnapshotPublicationBinding" b
          ON b."organizationId"=s."organizationId" AND b."projectId"=s."projectId" AND b."buildInputId"=s."buildInputId"
          WHERE b."buildInputId" IS NULL OR s."publishSequence"<>b."publishSequence"
            OR s."inputHash"<>b."inputHash" OR s."manifestSha256"<>b."manifestSha256") +
        (SELECT count(*) FROM public."ProjectCurrentSnapshotManifest" c LEFT JOIN public."DeliveryRun" d
          ON d."organizationId"=c."organizationId" AND d."projectId"=c."projectId" AND d."publishSequence"=c."publishSequence"
          WHERE d.id IS NULL OR c."manifestSha256"<>d."manifestSha256" OR c."manifestKey"<>d."manifestKey" OR c."publishedAt"<>d."publishedAt")
      +
        (SELECT count(*) FROM public."DeliveryRun" d JOIN public."SnapshotPublicationBinding" b
          ON (d."organizationId",d."projectId",d."publishSequence")=(b."organizationId",b."projectId",b."publishSequence")
          JOIN public."SnapshotBuildInput" i ON (i."organizationId",i."projectId",i.id)=(b."organizationId",b."projectId",b."buildInputId")
          WHERE d."manifestSha256"<>b."manifestSha256"
            OR d."manifestKey"<>'snapshots/' || d."projectId" || '/' || b."manifestSha256"
            OR d."publishedAt"<>i."capturedAt") +
        (SELECT count(*) FROM public."DeliveryRun" d JOIN public."SnapshotRollbackBinding" b
          ON (d."organizationId",d."projectId",d."publishSequence")=(b."organizationId",b."projectId",b."publishSequence")
          JOIN public."SnapshotRollbackReservation" r ON (r."organizationId",r."projectId",r."requestId")=(b."organizationId",b."projectId",b."requestId")
          WHERE d."manifestSha256"<>b."manifestSha256"
            OR d."manifestKey"<>'snapshots/' || d."projectId" || '/' || b."manifestSha256"
            OR d."publishedAt"<>r."createdAt" OR b."stagedAt" IS NULL)
      )::int AS "publishSequenceConflicts";
END $$;
DO $$ DECLARE had_create BOOLEAN; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ams_data_hub_worker' AND NOT rolsuper AND NOT rolbypassrls)
  THEN RAISE EXCEPTION 'DATA_SAFETY_DEFINER_ROLE_INVALID'; END IF;
  had_create := has_schema_privilege('ams_data_hub_worker','public','CREATE');
  IF NOT had_create THEN GRANT CREATE ON SCHEMA public TO ams_data_hub_worker; END IF;
  ALTER FUNCTION public.data_safety_consistency_report() OWNER TO ams_data_hub_worker;
  IF NOT had_create THEN REVOKE CREATE ON SCHEMA public FROM ams_data_hub_worker; END IF;
END $$;
REVOKE ALL ON FUNCTION public.data_safety_consistency_report() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.data_safety_consistency_report() TO ams_data_hub_web,ams_data_hub_worker;

-- FORCE RLS remains enabled. Private reads exist only for the trusted definer
-- role in the same validated admin context; no parts policy or web grant.
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ProjectSnapshotSequence','SnapshotBuildInput','SnapshotPublicationBinding',
    'SnapshotArtifactStageReceipt','SnapshotRollbackReservation','SnapshotRollbackBinding'
  ] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO ams_data_hub_worker USING (public.data_safety_reconciliation_scope())',
      table_name || '_reconciliation_read',table_name);
  END LOOP;
END $$;
COMMIT;
