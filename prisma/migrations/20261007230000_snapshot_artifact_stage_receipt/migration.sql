-- Binding predates object IO; this separate immutable receipt is recorded by
-- the server only after settled PUTs and fresh four-owner admission. No current.
CREATE TABLE "SnapshotArtifactStageReceipt" (
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "buildInputId" TEXT NOT NULL,
  "inputHash" CHAR(64) NOT NULL CHECK ("inputHash" ~ '^[a-f0-9]{64}$'),
  "idempotencyKeyHash" CHAR(64) NOT NULL CHECK ("idempotencyKeyHash" ~ '^[a-f0-9]{64}$'),
  "publishSequence" INTEGER NOT NULL CHECK ("publishSequence" > 0),
  "manifestSha256" CHAR(64) NOT NULL CHECK ("manifestSha256" ~ '^[a-f0-9]{64}$'),
  "stagedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("organizationId", "projectId", "buildInputId"),
  UNIQUE ("organizationId", "projectId", "idempotencyKeyHash"),
  FOREIGN KEY ("organizationId", "projectId", "buildInputId")
    REFERENCES "SnapshotPublicationBinding"("organizationId", "projectId", "buildInputId")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);
ALTER TABLE "SnapshotArtifactStageReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SnapshotArtifactStageReceipt" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SnapshotArtifactStageReceipt_rls" ON "SnapshotArtifactStageReceipt" FOR SELECT TO PUBLIC
  USING (snapshot_input_scope("organizationId", "projectId")
    OR snapshot_publication_scope("organizationId", "projectId")
    OR operational_executor_scope("organizationId", "projectId"));
CREATE POLICY "SnapshotArtifactStageReceipt_insert" ON "SnapshotArtifactStageReceipt" FOR INSERT TO PUBLIC
  WITH CHECK (snapshot_publication_scope("organizationId", "projectId"));
GRANT SELECT, INSERT ON "SnapshotArtifactStageReceipt" TO ams_data_hub_worker;
GRANT SELECT ON "SnapshotArtifactStageReceipt" TO ams_data_hub_backup;

CREATE FUNCTION protect_snapshot_artifact_stage_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'SNAPSHOT_STAGE_RECEIPT_IMMUTABLE'; END IF;
  IF NOT snapshot_publication_scope(NEW."organizationId", NEW."projectId")
    THEN RAISE EXCEPTION 'SNAPSHOT_STAGE_SCOPE_DENIED'; END IF;
  IF NEW."stagedAt" IS DISTINCT FROM transaction_timestamp()::timestamptz(3)
    THEN RAISE EXCEPTION 'SNAPSHOT_STAGE_TIME_INVALID'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "SnapshotPublicationBinding" b JOIN "SnapshotBuildInput" i
      ON i."id" = b."buildInputId" AND i."organizationId" = b."organizationId" AND i."projectId" = b."projectId"
      WHERE b."organizationId" = NEW."organizationId" AND b."projectId" = NEW."projectId"
        AND b."buildInputId" = NEW."buildInputId" AND b."inputHash" = NEW."inputHash"
        AND i."inputHash" = NEW."inputHash" AND i."idempotencyKeyHash" = NEW."idempotencyKeyHash"
        AND b."publishSequence" = NEW."publishSequence" AND i."publishSequence" = NEW."publishSequence"
        AND b."manifestSha256" = NEW."manifestSha256")
  THEN RAISE EXCEPTION 'SNAPSHOT_STAGE_RECEIPT_INVALID'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SnapshotArtifactStageReceipt_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "SnapshotArtifactStageReceipt"
  FOR EACH ROW EXECUTE FUNCTION protect_snapshot_artifact_stage_receipt();
