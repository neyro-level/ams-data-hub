BEGIN;
CREATE OR REPLACE FUNCTION public.snapshot_consumer_scope(org TEXT, project TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT current_setting('app.principal_kind',true)='snapshot-consumer'
    AND current_setting('app.actor_id',true) IN ('snapshot-consumer-auth','snapshot-consumer-read','snapshot-consumer-ack')
    AND org ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' AND project ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    AND org=NULLIF(current_setting('app.organization_id',true),'')
    AND project=NULLIF(current_setting('app.project_ids',true),'')
$$;
CREATE FUNCTION public.snapshot_consumer_ack_scope(org TEXT, project TEXT, sequence INTEGER) RETURNS BOOLEAN
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.snapshot_consumer_scope(org,project) AND current_setting('app.actor_id',true)='snapshot-consumer-ack'
    AND sequence::text=NULLIF(current_setting('app.snapshot_consumer_ack_sequence',true),'')
$$;
CREATE POLICY "DeliveryRun_consumer_ack_read" ON public."DeliveryRun" FOR SELECT TO PUBLIC
  USING (public.snapshot_consumer_ack_scope("organizationId","projectId","publishSequence"));
CREATE POLICY "DeliveryRun_consumer_ack_update" ON public."DeliveryRun" FOR UPDATE TO PUBLIC
  USING (public.snapshot_consumer_ack_scope("organizationId","projectId","publishSequence"))
  WITH CHECK (public.snapshot_consumer_ack_scope("organizationId","projectId","publishSequence"));
CREATE FUNCTION public.protect_snapshot_consumer_ack() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF public.snapshot_consumer_ack_scope(OLD."organizationId",OLD."projectId",OLD."publishSequence") IS DISTINCT FROM TRUE
    OR to_jsonb(NEW)-ARRAY['status','downloadedAt','appliedAt','acknowledgedAt','ackIdempotencyKeyHash','updatedAt']
      IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','downloadedAt','appliedAt','acknowledgedAt','ackIdempotencyKeyHash','updatedAt']
  THEN RAISE EXCEPTION 'SNAPSHOT_CONSUMER_ACK_WRITE_DENIED'; END IF;
  IF OLD.status IN ('PENDING','NOTIFIED') AND NEW.status='DOWNLOADED'
    AND NEW."downloadedAt" IS NOT NULL AND OLD."downloadedAt" IS NULL
    AND (NEW."appliedAt",NEW."acknowledgedAt",NEW."ackIdempotencyKeyHash") IS NOT DISTINCT FROM (OLD."appliedAt",OLD."acknowledgedAt",OLD."ackIdempotencyKeyHash")
  THEN RETURN NEW; END IF;
  IF OLD.status='DOWNLOADED' AND NEW.status='APPLIED' AND NEW."appliedAt" IS NOT NULL
    AND NEW."appliedAt">=OLD."downloadedAt" AND OLD."appliedAt" IS NULL
    AND (NEW."downloadedAt",NEW."acknowledgedAt",NEW."ackIdempotencyKeyHash") IS NOT DISTINCT FROM (OLD."downloadedAt",OLD."acknowledgedAt",OLD."ackIdempotencyKeyHash")
  THEN RETURN NEW; END IF;
  IF OLD.status='APPLIED' AND NEW.status='ACKNOWLEDGED' AND NEW."acknowledgedAt" IS NOT NULL
    AND NEW."acknowledgedAt">=OLD."appliedAt" AND OLD."acknowledgedAt" IS NULL
    AND OLD."ackIdempotencyKeyHash" IS NULL AND NEW."ackIdempotencyKeyHash" ~ '^[a-f0-9]{64}$'
    AND (NEW."downloadedAt",NEW."appliedAt") IS NOT DISTINCT FROM (OLD."downloadedAt",OLD."appliedAt")
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'SNAPSHOT_CONSUMER_ACK_TRANSITION_DENIED';
END $$;
CREATE TRIGGER "DeliveryRun_consumer_ack_guard" BEFORE UPDATE ON public."DeliveryRun"
  FOR EACH ROW WHEN (current_setting('app.principal_kind',true)='snapshot-consumer')
  EXECUTE FUNCTION public.protect_snapshot_consumer_ack();
COMMIT;
