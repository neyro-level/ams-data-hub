-- Preserve immutable historical NULL-target requests. New PUBLISH intents must
-- explicitly select a completed stage; no latest fallback or private-read grant.
ALTER TABLE "OperationalActionRequest" ADD COLUMN "buildInputId" TEXT;
ALTER TABLE "OperationalActionRequest" ADD CONSTRAINT "OperationalActionRequest_stage_subject_check"
  CHECK ("buildInputId" IS NULL OR ("action" = 'SNAPSHOT_PUBLISH' AND "buildInputId" ~ '^[A-Za-z0-9_-]{1,128}$'));
ALTER TABLE "OperationalActionRequest" ADD CONSTRAINT "OperationalActionRequest_stage_fkey"
  FOREIGN KEY ("organizationId", "projectId", "buildInputId")
  REFERENCES "SnapshotArtifactStageReceipt" ("organizationId", "projectId", "buildInputId")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE FUNCTION operational_selected_publish_stage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."action" = 'SNAPSHOT_PUBLISH' AND (NEW."buildInputId" IS NULL OR NOT EXISTS (
    SELECT 1 FROM "AuditEvent" a WHERE a."id" = NEW."id"
      AND a."organizationId" = NEW."organizationId" AND a."actorId" = NEW."requestedBy"
      AND a."action" = 'operations-control.snapshot.publish.request'
      AND a."afterMarker"->>'buildInputId' = NEW."buildInputId"))
  THEN RAISE EXCEPTION 'OPERATIONS_CONTROL_REFERENCE_INVALID' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "OperationalActionRequest_selected_stage_guard" BEFORE INSERT ON "OperationalActionRequest"
  FOR EACH ROW EXECUTE FUNCTION operational_selected_publish_stage_guard();
