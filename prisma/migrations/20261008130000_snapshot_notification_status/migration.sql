BEGIN;
CREATE FUNCTION public.protect_snapshot_notification_write() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'SNAPSHOT_NOTIFICATION_WRITE_DENIED'; END IF;
  IF OLD."organizationId" IS DISTINCT FROM NULLIF(current_setting('app.organization_id',true),'')
    OR OLD."projectId" IS DISTINCT FROM NULLIF(current_setting('app.project_ids',true),'')
    OR OLD."publishSequence"::text IS DISTINCT FROM NULLIF(current_setting('app.snapshot_notification_sequence',true),'')
    OR to_jsonb(NEW)-ARRAY['status','notifiedAt','updatedAt'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','notifiedAt','updatedAt']
    OR OLD.status <> 'PENDING' OR NEW.status <> 'NOTIFIED'
    OR OLD."notifiedAt" IS NOT NULL OR NEW."notifiedAt" IS NULL
  THEN RAISE EXCEPTION 'SNAPSHOT_NOTIFICATION_WRITE_DENIED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "DeliveryRun_notification_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."DeliveryRun"
  FOR EACH ROW WHEN (current_setting('app.principal_kind',true)='project-job'
    AND current_setting('app.actor_id',true)='snapshot-notifier')
  EXECUTE FUNCTION public.protect_snapshot_notification_write();
COMMIT;
