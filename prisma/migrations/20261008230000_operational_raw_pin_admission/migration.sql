BEGIN;
CREATE FUNCTION public.snapshot_operational_pin_scope(org TEXT,project TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT current_setting('app.principal_kind',true)='platform-admin'
    AND length(btrim(COALESCE(current_setting('app.actor_id',true),'')))>0
    AND org ~ '^[A-Za-z0-9_-]{1,128}$' AND project ~ '^[A-Za-z0-9_-]{1,128}$'
$$;
DO $$ DECLARE owned_table TEXT; BEGIN
  FOREACH owned_table IN ARRAY ARRAY['SnapshotBuildInput','SnapshotBuildInputPart','SnapshotArtifactStageReceipt',
    'SnapshotPublicationBinding','SnapshotRollbackBinding','SnapshotRollbackReservation','DeliveryRun'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO ams_data_hub_worker USING (public.snapshot_operational_pin_scope("organizationId","projectId"))',
      owned_table || '_operational_pin_read',owned_table);
  END LOOP;
END $$;

-- Boolean-only admission. No private values, context switches or web table grants.
CREATE FUNCTION public.snapshot_operational_raw_pin_admission(org TEXT,project TEXT,selected_input TEXT,source_sequence INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET row_security=on SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE roots TEXT[]; root TEXT; part RECORD; value JSONB;
  pin_ids TEXT[] := ARRAY[]::text[]; pin_sources TEXT[] := ARRAY[]::text[];
  hashes TEXT[] := ARRAY[]::text[]; pin_id TEXT; bytes BIGINT; records BIGINT; parts BIGINT; invalid BIGINT;
BEGIN
  IF public.snapshot_operational_pin_scope(org,project) IS DISTINCT FROM TRUE
    OR current_setting('transaction_isolation')<>'read committed'
  THEN RAISE EXCEPTION 'RAW_PIN_ADMISSION_ACCESS_DENIED'; END IF;
  -- Global-first, same connection: callers must take this before idempotency/outbox locks.
  PERFORM pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0));
  IF (selected_input IS NOT NULL)=(source_sequence IS NOT NULL)
    OR NOT EXISTS (SELECT 1 FROM public."Project" WHERE "organizationId"=org AND id=project)
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_REFERENCE_INVALID'; END IF;
  IF selected_input IS NOT NULL THEN
    SELECT array_agg(i.id) INTO roots FROM public."SnapshotBuildInput" i
      JOIN public."SnapshotArtifactStageReceipt" s ON (s."organizationId",s."projectId",s."buildInputId")=(i."organizationId",i."projectId",i.id)
      JOIN public."SnapshotPublicationBinding" b ON (b."organizationId",b."projectId",b."buildInputId")=(i."organizationId",i."projectId",i.id)
      WHERE i."organizationId"=org AND i."projectId"=project AND i.id=selected_input
        AND b."inputHash"=i."inputHash" AND s."inputHash"=i."inputHash"
        AND b."publishSequence"=i."publishSequence" AND s."publishSequence"=i."publishSequence"
        AND s."idempotencyKeyHash"=i."idempotencyKeyHash" AND (s."requestHash" IS NULL OR s."requestHash"=i."requestHash")
        AND s."manifestSha256"=b."manifestSha256";
  ELSE
    -- Same approved identities as automatic_publication_rollback_source:
    -- automatic normal roots need no separate stage; rollback roots do.
    SELECT array_agg(x.id) INTO roots FROM (
      SELECT i.id FROM public."DeliveryRun" r
      JOIN public."SnapshotPublicationBinding" b ON (b."organizationId",b."projectId",b."publishSequence")=(r."organizationId",r."projectId",r."publishSequence")
      LEFT JOIN public."SnapshotArtifactStageReceipt" s ON (s."organizationId",s."projectId",s."buildInputId")=(b."organizationId",b."projectId",b."buildInputId")
      JOIN public."SnapshotBuildInput" i ON (i."organizationId",i."projectId",i.id)=(b."organizationId",b."projectId",b."buildInputId")
      WHERE r."organizationId"=org AND r."projectId"=project AND r."publishSequence"=source_sequence
        AND r."manifestSha256"=b."manifestSha256" AND r."manifestKey"='snapshots/' || project || '/' || b."manifestSha256"
        AND r."publishedAt"=i."capturedAt" AND i."publishSequence"=source_sequence AND b."inputHash"=i."inputHash"
        AND (s."buildInputId" IS NULL OR (s."publishSequence"=source_sequence AND s."manifestSha256"=b."manifestSha256"
          AND s."inputHash"=i."inputHash" AND s."idempotencyKeyHash"=i."idempotencyKeyHash" AND (s."requestHash" IS NULL OR s."requestHash"=i."requestHash")))
      UNION ALL
      SELECT i.id FROM public."DeliveryRun" r
      JOIN public."SnapshotRollbackBinding" b ON (b."organizationId",b."projectId",b."publishSequence")=(r."organizationId",r."projectId",r."publishSequence")
      JOIN public."SnapshotRollbackReservation" v ON (v."organizationId",v."projectId",v."requestId")=(b."organizationId",b."projectId",b."requestId")
      JOIN public."SnapshotBuildInput" i ON (i."organizationId",i."projectId",i.id)=(v."organizationId",v."projectId",v."rootBuildInputId")
      WHERE r."organizationId"=org AND r."projectId"=project AND r."publishSequence"=source_sequence
        AND b."stagedAt" IS NOT NULL AND v."publishSequence"=source_sequence AND v."inputHash"=i."inputHash"
        AND r."manifestSha256"=b."manifestSha256" AND r."manifestKey"='snapshots/' || project || '/' || b."manifestSha256"
        AND r."publishedAt"=v."createdAt"
    ) x;
  END IF;
  IF COALESCE(array_length(roots,1),0)<>1 THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_REFERENCE_INVALID'; END IF;
  root:=roots[1];
  IF NOT EXISTS (SELECT 1 FROM public."SnapshotBuildInput" WHERE id=root AND "schemaMinor" IN (0,1))
  THEN RAISE EXCEPTION 'RAW_PIN_ADMISSION_PROVENANCE_INVALID'; END IF;
  SELECT COALESCE(sum("payloadByteCount"),0),COALESCE(sum("payloadRecordCount"),0),count(*) INTO bytes,records,parts
    FROM public."SnapshotBuildInputPart" WHERE "organizationId"=org AND "projectId"=project AND "buildInputId"=root;
  IF bytes>33554432 OR records>50000 OR parts>2048 OR parts=0 THEN RAISE EXCEPTION 'RAW_PIN_ADMISSION_LIMIT'; END IF;
  FOR part IN SELECT kind,payload FROM public."SnapshotBuildInputPart"
    WHERE "organizationId"=org AND "projectId"=project AND "buildInputId"=root AND kind IN ('sources','inventory') LOOP
    FOR value IN SELECT jsonb_array_elements(part.payload) LOOP
      IF part.kind='sources' THEN
        IF value->>'entityType'='profile' THEN CONTINUE; END IF;
        IF value->>'entityType' IS DISTINCT FROM 'source' OR COALESCE(value->>'sourceId','') !~ '^[A-Za-z0-9_-]{1,128}$'
        THEN RAISE EXCEPTION 'RAW_PIN_ADMISSION_PROVENANCE_INVALID'; END IF;
        IF value->'approvedHead'='null'::jsonb THEN CONTINUE; END IF;
        pin_id:=value->'approvedHead'->>'id';
        IF value->'approvedHead'->>'status' IS DISTINCT FROM 'GOOD' OR COALESCE(pin_id,'') !~ '^[A-Za-z0-9_-]{1,128}$'
        THEN RAISE EXCEPTION 'RAW_PIN_ADMISSION_PROVENANCE_INVALID'; END IF;
        pin_ids:=array_append(pin_ids,pin_id); pin_sources:=array_append(pin_sources,value->>'sourceId');
      ELSE
        IF value->>'status'='INACTIVE' THEN CONTINUE; END IF;
        IF value->>'status' IS DISTINCT FROM 'ACTIVE' OR COALESCE(value->>'sourceId','') !~ '^[A-Za-z0-9_-]{1,128}$'
          OR COALESCE(value->>'sourceHash','') !~ '^[a-f0-9]{64}$'
        THEN RAISE EXCEPTION 'RAW_PIN_ADMISSION_PROVENANCE_INVALID'; END IF;
        FOREACH pin_id IN ARRAY ARRAY[value->>'factRevisionId',value->>'approvedHeadId'] LOOP
          IF COALESCE(pin_id,'') !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE EXCEPTION 'RAW_PIN_ADMISSION_PROVENANCE_INVALID'; END IF;
          pin_ids:=array_append(pin_ids,pin_id); pin_sources:=array_append(pin_sources,value->>'sourceId');
        END LOOP;
        hashes:=array_append(hashes,value->>'sourceHash');
      END IF;
    END LOOP;
  END LOOP;
  -- Many inventory rows share one fact/head. Charge traversal once, then use
  -- unique metadata identities for GOOD and pending-journal joins.
  SELECT COALESCE(array_agg(p.id),ARRAY[]::text[]),COALESCE(array_agg(p."sourceId"),ARRAY[]::text[])
    INTO pin_ids,pin_sources FROM (SELECT DISTINCT * FROM unnest(pin_ids,pin_sources) AS pin(id,"sourceId")) p;
  SELECT COALESCE(array_agg(DISTINCT h),ARRAY[]::text[]) INTO hashes FROM unnest(hashes) AS h;
  SELECT count(*) INTO invalid FROM unnest(pin_ids,pin_sources) AS p(id,"sourceId")
    WHERE NOT EXISTS (SELECT 1 FROM public."SourceRevision" r WHERE r.id=p.id AND r."sourceId"=p."sourceId"
      AND r."organizationId"=org AND r."projectId"=project AND r.status='GOOD');
  IF invalid<>0 THEN RAISE EXCEPTION 'RAW_PIN_ADMISSION_PROVENANCE_INVALID'; END IF;
  RETURN NOT EXISTS (SELECT 1 FROM public."RawArtifactDeletion" d
    WHERE d."organizationId"=org AND d."projectId"=project AND d.status IN ('PENDING','ACKNOWLEDGED')
      AND (d."rawArtifactHash"=ANY(hashes) OR EXISTS (SELECT 1 FROM public."SourceRevision" r
        JOIN unnest(pin_ids,pin_sources) AS p(id,"sourceId") ON r.id=p.id AND r."sourceId"=p."sourceId"
        WHERE r."organizationId"=org AND r."projectId"=project AND r.status='GOOD' AND r."rawArtifactHash"=d."rawArtifactHash")));
END $$;
REVOKE ALL ON FUNCTION public.snapshot_operational_raw_pin_admission(TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.snapshot_operational_raw_pin_admission(TEXT,TEXT,TEXT,INTEGER) TO ams_data_hub_web,ams_data_hub_worker;
DO $$ DECLARE had_create BOOLEAN; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ams_data_hub_worker' AND NOT rolsuper AND NOT rolbypassrls)
  THEN RAISE EXCEPTION 'RAW_PIN_DEFINER_ROLE_INVALID'; END IF;
  had_create:=has_schema_privilege('ams_data_hub_worker','public','CREATE');
  IF NOT had_create THEN GRANT CREATE ON SCHEMA public TO ams_data_hub_worker; END IF;
  ALTER FUNCTION public.snapshot_operational_raw_pin_admission(TEXT,TEXT,TEXT,INTEGER) OWNER TO ams_data_hub_worker;
  IF NOT had_create THEN REVOKE CREATE ON SCHEMA public FROM ams_data_hub_worker; END IF;
END $$;
COMMIT;
