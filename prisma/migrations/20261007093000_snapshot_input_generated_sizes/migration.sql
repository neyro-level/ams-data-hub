-- Cache immutable payload sizes once per insertion, not once per deferred trigger.
-- Adding stored generated columns can rewrite the table: schedule its production lock.
ALTER TABLE "SnapshotBuildInputPart"
  ADD COLUMN "payloadByteCount" INTEGER GENERATED ALWAYS AS (octet_length("payload"::text)) STORED NOT NULL,
  ADD COLUMN "payloadRecordCount" INTEGER GENERATED ALWAYS AS (jsonb_array_length("payload")) STORED NOT NULL;

-- Keep BOTH deferred triggers, including checks after SET CONSTRAINTS on the header.
CREATE OR REPLACE FUNCTION check_snapshot_input_complete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE input_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'SnapshotBuildInput' THEN input_id := NEW."id"; ELSE input_id := NEW."buildInputId"; END IF;
  IF (SELECT count(DISTINCT "kind") FROM "SnapshotBuildInputPart" WHERE "buildInputId" = input_id) <> 18
    OR EXISTS (SELECT 1 FROM "SnapshotBuildInputPart" WHERE "buildInputId" = input_id
      GROUP BY "kind" HAVING min("partIndex") <> 0 OR max("partIndex") + 1 <> count(*))
  THEN RAISE EXCEPTION 'SNAPSHOT_INPUT_INCOMPLETE'; END IF;
  IF (SELECT count(*) > 2048 OR sum("payloadRecordCount") > 50000
      OR sum("payloadByteCount") > 67108864
      FROM "SnapshotBuildInputPart" WHERE "buildInputId" = input_id)
  THEN RAISE EXCEPTION 'SNAPSHOT_INPUT_LIMIT_EXCEEDED'; END IF;
  RETURN NULL;
END $$;
