-- Forward-only rollback identity; no pointer/run/result or historical rewrites.
CREATE TABLE "SnapshotRollbackReservation" (
  "requestId" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "sourceDeliveryRunId" TEXT NOT NULL, "sourcePublishSequence" INTEGER NOT NULL CHECK ("sourcePublishSequence" > 0),
  "rootBuildInputId" TEXT NOT NULL, "inputHash" CHAR(64) NOT NULL CHECK ("inputHash" ~ '^[a-f0-9]{64}$'),
  "publishSequence" INTEGER NOT NULL CHECK ("publishSequence" > "sourcePublishSequence"),
  "initialLeaseJobRunId" TEXT NOT NULL, "initialLeaseAttempt" INTEGER NOT NULL CHECK ("initialLeaseAttempt" > 0),
  "initialLeaseWorkerId" TEXT NOT NULL, "initialLeaseAcquiredAt" TIMESTAMPTZ(3) NOT NULL,
  "reservationTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("organizationId", "projectId", "requestId"), UNIQUE ("organizationId", "projectId", "publishSequence"),
  FOREIGN KEY ("organizationId", "projectId", "requestId") REFERENCES "OperationalActionRequest"("organizationId", "projectId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("organizationId", "projectId", "sourcePublishSequence") REFERENCES "DeliveryRun"("organizationId", "projectId", "publishSequence") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("organizationId", "projectId", "rootBuildInputId") REFERENCES "SnapshotBuildInput"("organizationId", "projectId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE TABLE "SnapshotRollbackBinding" (
  "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "publishSequence" INTEGER NOT NULL CHECK ("publishSequence" > 0), "keyId" VARCHAR(240) NOT NULL CHECK (length("keyId") > 0),
  "manifestSha256" CHAR(64) NOT NULL CHECK ("manifestSha256" ~ '^[a-f0-9]{64}$'),
  "manifestCanonical" TEXT NOT NULL CHECK (octet_length("manifestCanonical") BETWEEN 1 AND 2097152),
  "leaseJobRunId" TEXT NOT NULL, "leaseAttempt" INTEGER NOT NULL CHECK ("leaseAttempt" > 0),
  "leaseWorkerId" TEXT NOT NULL, "leaseAcquiredAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "stagedAt" TIMESTAMPTZ(3),
  "stageLeaseJobRunId" TEXT, "stageLeaseAttempt" INTEGER, "stageLeaseWorkerId" TEXT, "stageLeaseAcquiredAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("organizationId", "projectId", "requestId"), UNIQUE ("organizationId", "projectId", "publishSequence"),
  FOREIGN KEY ("organizationId", "projectId", "requestId") REFERENCES "SnapshotRollbackReservation"("organizationId", "projectId", "requestId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CHECK (encode(sha256(convert_to("manifestCanonical", 'UTF8')), 'hex') = "manifestSha256")
);
ALTER TABLE "SnapshotRollbackReservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SnapshotRollbackReservation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SnapshotRollbackBinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SnapshotRollbackBinding" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SnapshotRollbackReservation_rls" ON "SnapshotRollbackReservation" FOR SELECT TO PUBLIC USING (snapshot_publication_scope("organizationId", "projectId"));
CREATE POLICY "SnapshotRollbackReservation_insert" ON "SnapshotRollbackReservation" FOR INSERT TO PUBLIC WITH CHECK (snapshot_publication_scope("organizationId", "projectId"));
CREATE POLICY "SnapshotRollbackBinding_rls" ON "SnapshotRollbackBinding" FOR SELECT TO PUBLIC USING (snapshot_publication_scope("organizationId", "projectId"));
CREATE POLICY "SnapshotRollbackBinding_insert" ON "SnapshotRollbackBinding" FOR INSERT TO PUBLIC WITH CHECK (snapshot_publication_scope("organizationId", "projectId"));
CREATE POLICY "SnapshotRollbackBinding_stage" ON "SnapshotRollbackBinding" FOR UPDATE TO PUBLIC USING (snapshot_publication_scope("organizationId", "projectId")) WITH CHECK (snapshot_publication_scope("organizationId", "projectId"));
GRANT SELECT, INSERT ON "SnapshotRollbackReservation", "SnapshotRollbackBinding" TO ams_data_hub_worker;
GRANT UPDATE ("stagedAt", "stageLeaseJobRunId", "stageLeaseAttempt", "stageLeaseWorkerId", "stageLeaseAcquiredAt") ON "SnapshotRollbackBinding" TO ams_data_hub_worker;
GRANT SELECT ON "SnapshotRollbackReservation", "SnapshotRollbackBinding" TO ams_data_hub_backup;

-- Direct DML takes global before target rows; fixed scoped locks are then safe.
CREATE FUNCTION lock_snapshot_rollback_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0)); RETURN NULL;
END $$;
CREATE TRIGGER "SnapshotRollbackReservation_writer_lock" BEFORE INSERT OR UPDATE OR DELETE ON "SnapshotRollbackReservation" FOR EACH STATEMENT EXECUTE FUNCTION lock_snapshot_rollback_writer();
CREATE TRIGGER "SnapshotRollbackBinding_writer_lock" BEFORE INSERT OR UPDATE OR DELETE ON "SnapshotRollbackBinding" FOR EACH STATEMENT EXECUTE FUNCTION lock_snapshot_rollback_writer();

-- Counter allocation is shared with normal captures. Deny the inverse forged
-- collision too, without rewriting the existing immutable capture guard.
CREATE FUNCTION reject_snapshot_input_rollback_sequence_collision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE occupied BOOLEAN;
BEGIN
  IF snapshot_input_scope(NEW."organizationId",NEW."projectId") THEN
    PERFORM set_config('app.actor_id','snapshot-publication',true);
    SELECT EXISTS (SELECT 1 FROM "SnapshotRollbackReservation" WHERE "organizationId"=NEW."organizationId"
      AND "projectId"=NEW."projectId" AND "publishSequence"=NEW."publishSequence") INTO occupied;
    PERFORM set_config('app.actor_id','snapshot-input',true);
    IF occupied THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_SEQUENCE_COLLISION'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SnapshotBuildInput_rollback_sequence_collision" BEFORE INSERT ON "SnapshotBuildInput" FOR EACH ROW EXECUTE FUNCTION reject_snapshot_input_rollback_sequence_collision();

-- Invoker-only exact purpose. Approval means completed binding/stage AND an
-- exact committed run, not current pointer or consumer ACK status. One root.
CREATE FUNCTION snapshot_rollback_approved_source(org TEXT, project TEXT, sequence INTEGER)
RETURNS TABLE ("sourceDeliveryRunId" TEXT, "rootBuildInputId" TEXT, "inputHash" TEXT,
  "manifestCanonical" TEXT, "manifestSha256" TEXT, "keyId" TEXT, "publishedAt" TIMESTAMPTZ)
LANGUAGE SQL STABLE AS $$
  SELECT r.id, i.id, i."inputHash"::text, b."manifestCanonical", b."manifestSha256"::text, b."keyId"::text, r."publishedAt"
  FROM "DeliveryRun" r JOIN "SnapshotPublicationBinding" b ON b."organizationId"=r."organizationId" AND b."projectId"=r."projectId" AND b."publishSequence"=r."publishSequence"
  JOIN "SnapshotArtifactStageReceipt" s ON (s."organizationId",s."projectId",s."buildInputId")=(b."organizationId",b."projectId",b."buildInputId")
  JOIN "SnapshotBuildInput" i ON (i."organizationId",i."projectId",i.id)=(b."organizationId",b."projectId",b."buildInputId")
  WHERE snapshot_publication_scope(org, project) AND r."organizationId"=org AND r."projectId"=project AND r."publishSequence"=sequence
    AND r."manifestSha256"=b."manifestSha256" AND r."manifestKey"='snapshots/' || project || '/' || b."manifestSha256"
    AND r."publishedAt"=i."capturedAt" AND i."publishSequence"=sequence AND s."publishSequence"=sequence
    AND s."manifestSha256"=b."manifestSha256" AND s."inputHash"=i."inputHash" AND b."inputHash"=i."inputHash"
    AND s."idempotencyKeyHash"=i."idempotencyKeyHash" AND (s."requestHash" IS NULL OR s."requestHash"=i."requestHash")
  UNION ALL
  SELECT r.id, v."rootBuildInputId", v."inputHash"::text, b."manifestCanonical", b."manifestSha256"::text, b."keyId"::text, r."publishedAt"
  FROM "DeliveryRun" r JOIN "SnapshotRollbackBinding" b ON b."organizationId"=r."organizationId" AND b."projectId"=r."projectId" AND b."publishSequence"=r."publishSequence"
  JOIN "SnapshotRollbackReservation" v ON (v."organizationId",v."projectId",v."requestId")=(b."organizationId",b."projectId",b."requestId")
  JOIN "SnapshotBuildInput" i ON (i."organizationId",i."projectId",i.id)=(v."organizationId",v."projectId",v."rootBuildInputId")
  WHERE snapshot_publication_scope(org, project) AND r."organizationId"=org AND r."projectId"=project AND r."publishSequence"=sequence
    AND b."stagedAt" IS NOT NULL AND v."publishSequence"=sequence AND v."inputHash"=i."inputHash"
    AND r."manifestSha256"=b."manifestSha256" AND r."manifestKey"='snapshots/' || project || '/' || b."manifestSha256"
    AND r."publishedAt"=v."createdAt"
$$;

-- Fixed same-scope actor-only bridge, no role/kind/org/projects changes. Caller
-- must already hold global -> publication -> input locks before request rows.
CREATE FUNCTION snapshot_rollback_live_lease(org TEXT, project TEXT, request TEXT, sequence INTEGER,
  job TEXT, lease_attempt INTEGER, worker TEXT, acquired TIMESTAMPTZ) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE q "OperationalActionRequest"%ROWTYPE; event_id TEXT; job_id TEXT;
BEGIN
  IF snapshot_publication_scope(org, project) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_ACCESS_DENIED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0));
  PERFORM pg_advisory_xact_lock(hashtextextended('["snapshot-publication",' || to_json(org)::text || ',' || to_json(project)::text || ']',0));
  PERFORM pg_advisory_xact_lock(hashtextextended('["snapshot-input",' || to_json(org)::text || ',' || to_json(project)::text || ']',0));
  PERFORM set_config('app.actor_id', 'operations-executor', true);
  SELECT * INTO q FROM "OperationalActionRequest" WHERE "organizationId"=org AND "projectId"=project AND id=request FOR UPDATE;
  IF NOT FOUND OR q.action<>'SNAPSHOT_ROLLBACK' OR q.status<>'RUNNING' OR q."sourcePublishSequence" IS DISTINCT FROM sequence
    OR (q."leaseJobRunId",q."leaseAttempt",q."leaseWorkerId",q."leaseAcquiredAt") IS DISTINCT FROM (job,lease_attempt,worker,acquired)
  THEN RAISE EXCEPTION 'OUTBOX_OPERATION_LEASE_LOST'; END IF;
  SELECT e.id INTO event_id FROM "OutboxEvent" e WHERE e.id=q."outboxEventId" AND e."organizationId"=org
    AND e.status='PROCESSING' AND e."schemaVersion"=1 AND e.attempts=lease_attempt AND e."lockedBy"=worker AND e."lockedAt"=acquired
    AND e.topic='operations-control.snapshot.rollback.request'
    AND e.payload=jsonb_build_object('schemaVersion',1,'organizationId',org,'projectId',project,'requestId',request,'action','SNAPSHOT_ROLLBACK') FOR UPDATE;
  SELECT j.id INTO job_id FROM "JobRun" j JOIN "OutboxEvent" e ON e.id=j."outboxEventId"
    WHERE j.id=job AND j."outboxEventId"=event_id AND j."organizationId"=org AND j.attempt=lease_attempt AND j."workerId"=worker
      AND j."startedAt"=acquired AND j.status='RUNNING' AND j."jobType"=e.topic AND j."correlationId"=e."correlationId" FOR UPDATE OF j;
  IF event_id IS NULL OR job_id IS NULL THEN RAISE EXCEPTION 'OUTBOX_OPERATION_LEASE_LOST'; END IF;
  PERFORM set_config('app.actor_id', 'snapshot-publication', true);
END $$;

CREATE FUNCTION protect_snapshot_rollback_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source RECORD; counter INTEGER;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_RESERVATION_IMMUTABLE'; END IF;
  IF snapshot_publication_scope(NEW."organizationId",NEW."projectId") IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_ACCESS_DENIED'; END IF;
  PERFORM snapshot_rollback_live_lease(NEW."organizationId",NEW."projectId",NEW."requestId",NEW."sourcePublishSequence",
    NEW."initialLeaseJobRunId",NEW."initialLeaseAttempt",NEW."initialLeaseWorkerId",NEW."initialLeaseAcquiredAt");
  SELECT * INTO source FROM snapshot_rollback_approved_source(NEW."organizationId",NEW."projectId",NEW."sourcePublishSequence");
  IF NOT FOUND OR source."sourceDeliveryRunId" IS DISTINCT FROM NEW."sourceDeliveryRunId"
    OR source."rootBuildInputId" IS DISTINCT FROM NEW."rootBuildInputId" OR source."inputHash" IS DISTINCT FROM NEW."inputHash"
    OR NEW."reservationTransactionId"<>txid_current()
    OR EXISTS (SELECT 1 FROM "SnapshotBuildInput" i WHERE i."organizationId"=NEW."organizationId" AND i."projectId"=NEW."projectId" AND i."publishSequence">=NEW."publishSequence")
    OR EXISTS (SELECT 1 FROM "DeliveryRun" r WHERE r."organizationId"=NEW."organizationId" AND r."projectId"=NEW."projectId" AND r."publishSequence">=NEW."publishSequence")
    OR EXISTS (SELECT 1 FROM "ProjectCurrentSnapshotManifest" c WHERE c."organizationId"=NEW."organizationId" AND c."projectId"=NEW."projectId" AND c."publishSequence">=NEW."publishSequence")
  THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_RESERVATION_INVALID'; END IF;
  PERFORM set_config('app.actor_id','snapshot-input',true);
  SELECT "lastReservedSequence" INTO counter FROM "ProjectSnapshotSequence" WHERE "organizationId"=NEW."organizationId" AND "projectId"=NEW."projectId";
  PERFORM set_config('app.actor_id','snapshot-publication',true);
  IF counter IS DISTINCT FROM NEW."publishSequence" THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_SEQUENCE_INVALID'; END IF;
  NEW."createdAt" := clock_timestamp()::timestamptz(3);
  RETURN NEW;
END $$;
CREATE TRIGGER "SnapshotRollbackReservation_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "SnapshotRollbackReservation" FOR EACH ROW EXECUTE FUNCTION protect_snapshot_rollback_reservation();

-- Private fixed-schema manifest canonicality. Manifest keys are ASCII and all
-- numerical fields are nonnegative integers; never canonicalize public data.
CREATE FUNCTION snapshot_rollback_canonical_manifest_json(value JSONB) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result TEXT;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN SELECT '{' || COALESCE(string_agg(to_json(key)::text || ':' || snapshot_rollback_canonical_manifest_json(item), ',' ORDER BY key COLLATE "C"),'') || '}'
      INTO result FROM jsonb_each(value) AS entries(key,item);
    WHEN 'array' THEN SELECT '[' || COALESCE(string_agg(snapshot_rollback_canonical_manifest_json(item), ',' ORDER BY position),'') || ']'
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS entries(item,position);
    WHEN 'number' THEN
      IF value::text !~ '^(0|[1-9][0-9]*)$' THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_BINDING_INVALID'; END IF;
      result := value::text;
    ELSE result := value::text;
  END CASE;
  RETURN result;
END $$;

CREATE FUNCTION protect_snapshot_rollback_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reservation "SnapshotRollbackReservation"%ROWTYPE; source RECORD; manifest JSONB;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_BINDING_IMMUTABLE'; END IF;
  IF snapshot_publication_scope(NEW."organizationId",NEW."projectId") IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_ACCESS_DENIED'; END IF;
  SELECT * INTO reservation FROM "SnapshotRollbackReservation" WHERE "organizationId"=NEW."organizationId" AND "projectId"=NEW."projectId" AND "requestId"=NEW."requestId";
  IF NOT FOUND THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_RESERVATION_INVALID'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD."stagedAt" IS NOT NULL OR NEW."stagedAt" IS NULL
      OR to_jsonb(NEW)-ARRAY['stagedAt','stageLeaseJobRunId','stageLeaseAttempt','stageLeaseWorkerId','stageLeaseAcquiredAt']
        <>to_jsonb(OLD)-ARRAY['stagedAt','stageLeaseJobRunId','stageLeaseAttempt','stageLeaseWorkerId','stageLeaseAcquiredAt']
    THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_BINDING_IMMUTABLE'; END IF;
    PERFORM snapshot_rollback_live_lease(NEW."organizationId",NEW."projectId",NEW."requestId",reservation."sourcePublishSequence",
      NEW."stageLeaseJobRunId",NEW."stageLeaseAttempt",NEW."stageLeaseWorkerId",NEW."stageLeaseAcquiredAt");
    NEW."stagedAt" := clock_timestamp()::timestamptz(3); RETURN NEW;
  ELSIF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_BINDING_IMMUTABLE'; END IF;
  PERFORM snapshot_rollback_live_lease(NEW."organizationId",NEW."projectId",NEW."requestId",reservation."sourcePublishSequence",
    NEW."leaseJobRunId",NEW."leaseAttempt",NEW."leaseWorkerId",NEW."leaseAcquiredAt");
  SELECT * INTO source FROM snapshot_rollback_approved_source(NEW."organizationId",NEW."projectId",reservation."sourcePublishSequence");
  IF NOT FOUND OR source."sourceDeliveryRunId"<>reservation."sourceDeliveryRunId" OR source."rootBuildInputId"<>reservation."rootBuildInputId"
    OR source."inputHash"<>reservation."inputHash" OR NEW."publishSequence"<>reservation."publishSequence"
    OR NEW."stagedAt" IS NOT NULL OR NEW."stageLeaseJobRunId" IS NOT NULL OR NEW."stageLeaseAttempt" IS NOT NULL
    OR NEW."stageLeaseWorkerId" IS NOT NULL OR NEW."stageLeaseAcquiredAt" IS NOT NULL
  THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_BINDING_INVALID'; END IF;
  IF octet_length(NEW."manifestCanonical") NOT BETWEEN 1 AND 2097152 THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_MANIFEST_LIMIT'; END IF;
  manifest := NEW."manifestCanonical"::jsonb;
  IF NEW."manifestCanonical" IS DISTINCT FROM snapshot_rollback_canonical_manifest_json(manifest)
    THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_BINDING_INVALID'; END IF;
  IF (manifest - ARRAY['publishSequence','generatedAt','publishedAt','keyId','signature'])
      IS DISTINCT FROM (source."manifestCanonical"::jsonb - ARRAY['publishSequence','generatedAt','publishedAt','keyId','signature'])
    OR manifest->>'projectId' IS DISTINCT FROM NEW."projectId" OR manifest->>'keyId' IS DISTINCT FROM NEW."keyId"
    OR manifest->>'publishSequence' IS DISTINCT FROM NEW."publishSequence"::text
    OR (manifest->>'generatedAt')::timestamptz IS DISTINCT FROM reservation."createdAt"
    OR (manifest->>'publishedAt')::timestamptz IS DISTINCT FROM reservation."createdAt"
    OR jsonb_typeof(manifest->'signature') IS DISTINCT FROM 'string' OR length(manifest->>'signature') NOT BETWEEN 1 AND 4096
  THEN RAISE EXCEPTION 'SNAPSHOT_ROLLBACK_BINDING_INVALID'; END IF;
  NEW."createdAt" := clock_timestamp()::timestamptz(3); RETURN NEW;
END $$;
CREATE TRIGGER "SnapshotRollbackBinding_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "SnapshotRollbackBinding" FOR EACH ROW EXECUTE FUNCTION protect_snapshot_rollback_binding();
