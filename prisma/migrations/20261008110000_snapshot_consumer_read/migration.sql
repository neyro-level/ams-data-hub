BEGIN;
-- A consumer is not a job/API principal: it inherits no catalog, source,
-- capture-parts or mutation policies. Only credential auth and a public cut.
CREATE FUNCTION public.snapshot_consumer_scope(org TEXT, project TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT current_setting('app.principal_kind',true)='snapshot-consumer'
    AND current_setting('app.actor_id',true) IN ('snapshot-consumer-auth','snapshot-consumer-read')
    AND org ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' AND project ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    AND org=NULLIF(current_setting('app.organization_id',true),'')
    AND project=NULLIF(current_setting('app.project_ids',true),'')
$$;
CREATE POLICY "ProjectAckCredential_consumer_read" ON public."ProjectAckCredential" FOR SELECT TO PUBLIC
  USING (public.snapshot_consumer_scope("organizationId","projectId"));

-- The existing NOBYPASS runtime owner exposes only immutable public metadata.
-- All relations are schema-qualified; no context switching or callback.
CREATE FUNCTION public.snapshot_consumer_manifest(org TEXT, project TEXT, sequence INTEGER)
RETURNS TABLE ("publishSequence" INTEGER,"manifestCanonical" TEXT,"manifestSha256" TEXT,"keyId" TEXT,"publishedAt" TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET row_security=on AS $$
DECLARE matches JSONB;
BEGIN
  IF public.snapshot_consumer_scope(org,project) IS DISTINCT FROM TRUE
    OR current_setting('app.actor_id',true) IS DISTINCT FROM 'snapshot-consumer-read'
    OR (sequence IS NOT NULL AND sequence <= 0)
  THEN RAISE EXCEPTION 'SNAPSHOT_CONSUMER_SCOPE_DENIED'; END IF;
  SELECT jsonb_agg(to_jsonb(candidate)) INTO matches FROM (
    SELECT r."publishSequence",b."manifestCanonical",b."manifestSha256"::text,b."keyId"::text,r."publishedAt"
    FROM public."DeliveryRun" r
    JOIN public."SnapshotPublicationBinding" b ON (b."organizationId",b."projectId",b."publishSequence")=(r."organizationId",r."projectId",r."publishSequence")
    LEFT JOIN public."SnapshotArtifactStageReceipt" s ON (s."organizationId",s."projectId",s."buildInputId")=(b."organizationId",b."projectId",b."buildInputId")
    JOIN public."SnapshotBuildInput" i ON (i."organizationId",i."projectId",i.id)=(b."organizationId",b."projectId",b."buildInputId")
    LEFT JOIN public."ProjectCurrentSnapshotManifest" c ON (c."organizationId",c."projectId")=(r."organizationId",r."projectId")
    WHERE r."organizationId"=org AND r."projectId"=project
      AND ((sequence IS NOT NULL AND r."publishSequence"=sequence) OR (sequence IS NULL AND
        (c."publishSequence",c."manifestSha256",c."manifestKey",c."publishedAt")=(r."publishSequence",r."manifestSha256",r."manifestKey",r."publishedAt")))
      AND r."manifestSha256"=b."manifestSha256" AND r."manifestKey"='snapshots/' || project || '/' || b."manifestSha256"
      AND r."publishedAt"=i."capturedAt" AND i."publishSequence"=r."publishSequence" AND b."inputHash"=i."inputHash"
      -- Automatic Source GOOD publication commits after settled PUT + fresh
      -- admission without a separate BUILD stage receipt. Its exact run is
      -- approval; binding/staging without a committed run is never admitted.
      AND (s."buildInputId" IS NULL OR (s."publishSequence"=r."publishSequence" AND s."manifestSha256"=b."manifestSha256"
        AND s."inputHash"=i."inputHash" AND s."idempotencyKeyHash"=i."idempotencyKeyHash"
        AND (s."requestHash" IS NULL OR s."requestHash"=i."requestHash")))
      AND octet_length(b."manifestCanonical") <= 2097152
    UNION ALL
    SELECT r."publishSequence",b."manifestCanonical",b."manifestSha256"::text,b."keyId"::text,r."publishedAt"
    FROM public."DeliveryRun" r
    JOIN public."SnapshotRollbackBinding" b ON (b."organizationId",b."projectId",b."publishSequence")=(r."organizationId",r."projectId",r."publishSequence")
    JOIN public."SnapshotRollbackReservation" v ON (v."organizationId",v."projectId",v."requestId")=(b."organizationId",b."projectId",b."requestId")
    JOIN public."SnapshotBuildInput" i ON (i."organizationId",i."projectId",i.id)=(v."organizationId",v."projectId",v."rootBuildInputId")
    LEFT JOIN public."ProjectCurrentSnapshotManifest" c ON (c."organizationId",c."projectId")=(r."organizationId",r."projectId")
    WHERE r."organizationId"=org AND r."projectId"=project
      AND ((sequence IS NOT NULL AND r."publishSequence"=sequence) OR (sequence IS NULL AND
        (c."publishSequence",c."manifestSha256",c."manifestKey",c."publishedAt")=(r."publishSequence",r."manifestSha256",r."manifestKey",r."publishedAt")))
      AND b."stagedAt" IS NOT NULL AND v."publishSequence"=r."publishSequence" AND v."inputHash"=i."inputHash"
      AND r."manifestSha256"=b."manifestSha256" AND r."manifestKey"='snapshots/' || project || '/' || b."manifestSha256"
      AND r."publishedAt"=v."createdAt" AND octet_length(b."manifestCanonical") <= 2097152
  ) candidate;
  IF matches IS NULL THEN RETURN; END IF;
  IF jsonb_array_length(matches) <> 1 THEN RAISE EXCEPTION 'SNAPSHOT_CONSUMER_IDENTITY_AMBIGUOUS'; END IF;
  RETURN QUERY SELECT x."publishSequence",x."manifestCanonical",x."manifestSha256",x."keyId",x."publishedAt"
    FROM jsonb_to_record(matches->0) AS x("publishSequence" INTEGER,"manifestCanonical" TEXT,"manifestSha256" TEXT,"keyId" TEXT,"publishedAt" TIMESTAMPTZ);
END $$;
DO $$ DECLARE had_create BOOLEAN; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ams_data_hub_worker' AND NOT rolsuper AND NOT rolbypassrls)
  THEN RAISE EXCEPTION 'SNAPSHOT_CONSUMER_DEFINER_ROLE_INVALID'; END IF;
  -- PostgreSQL requires CREATE for ownership transfer. Preserve pre-existing
  -- ACLs; this temporary grant is removed in the same atomic migration.
  had_create := has_schema_privilege('ams_data_hub_worker','public','CREATE');
  IF NOT had_create THEN GRANT CREATE ON SCHEMA public TO ams_data_hub_worker; END IF;
  ALTER FUNCTION public.snapshot_consumer_manifest(TEXT,TEXT,INTEGER) OWNER TO ams_data_hub_worker;
  IF NOT had_create THEN REVOKE CREATE ON SCHEMA public FROM ams_data_hub_worker; END IF;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_consumer_manifest(TEXT,TEXT,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.snapshot_consumer_manifest(TEXT,TEXT,INTEGER) TO ams_data_hub_web,ams_data_hub_worker;

CREATE FUNCTION public.snapshot_consumer_definer_scope(org TEXT, project TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.snapshot_consumer_scope(org,project)
    AND current_setting('app.actor_id',true)='snapshot-consumer-read'
    AND current_user=pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.snapshot_consumer_manifest(text,text,integer)'::regprocedure))
$$;
-- No web SELECT grant/policy on private headers/bindings, and no parts policy.
CREATE POLICY "SnapshotBuildInput_consumer_definer_read" ON public."SnapshotBuildInput" FOR SELECT TO PUBLIC USING (public.snapshot_consumer_definer_scope("organizationId","projectId"));
CREATE POLICY "SnapshotPublicationBinding_consumer_definer_read" ON public."SnapshotPublicationBinding" FOR SELECT TO PUBLIC USING (public.snapshot_consumer_definer_scope("organizationId","projectId"));
CREATE POLICY "SnapshotArtifactStageReceipt_consumer_definer_read" ON public."SnapshotArtifactStageReceipt" FOR SELECT TO PUBLIC USING (public.snapshot_consumer_definer_scope("organizationId","projectId"));
CREATE POLICY "SnapshotRollbackReservation_consumer_definer_read" ON public."SnapshotRollbackReservation" FOR SELECT TO PUBLIC USING (public.snapshot_consumer_definer_scope("organizationId","projectId"));
CREATE POLICY "SnapshotRollbackBinding_consumer_definer_read" ON public."SnapshotRollbackBinding" FOR SELECT TO PUBLIC USING (public.snapshot_consumer_definer_scope("organizationId","projectId"));
CREATE POLICY "ProjectCurrentSnapshotManifest_consumer_definer_read" ON public."ProjectCurrentSnapshotManifest" FOR SELECT TO PUBLIC USING (public.snapshot_consumer_definer_scope("organizationId","projectId"));
CREATE POLICY "DeliveryRun_consumer_definer_read" ON public."DeliveryRun" FOR SELECT TO PUBLIC USING (public.snapshot_consumer_definer_scope("organizationId","projectId"));
COMMIT;
