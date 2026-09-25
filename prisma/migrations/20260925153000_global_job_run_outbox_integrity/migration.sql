-- MATCH FULL rejects a valid global job run because outboxEventId is non-null
-- while organizationId is null. The simple outboxEventId FK still provides
-- existence and cascade; these deferred triggers preserve tenant equality and
-- also allow the global-to-global case.
ALTER TABLE "JobRun"
  DROP CONSTRAINT "JobRun_outbox_organization_fkey";

CREATE OR REPLACE FUNCTION "assert_job_run_outbox_organization"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "OutboxEvent"
    WHERE "id" = NEW."outboxEventId"
      AND "organizationId" IS NOT DISTINCT FROM NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'JobRun organization must match its OutboxEvent organization'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "JobRun_outbox_organization_check"
AFTER INSERT OR UPDATE OF "organizationId", "outboxEventId" ON "JobRun"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION "assert_job_run_outbox_organization"();

CREATE OR REPLACE FUNCTION "assert_outbox_job_run_organization"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "JobRun"
    WHERE "outboxEventId" = NEW."id"
      AND "organizationId" IS DISTINCT FROM NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'OutboxEvent organization must match its JobRun organization'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "OutboxEvent_job_run_organization_check"
AFTER UPDATE OF "organizationId" ON "OutboxEvent"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION "assert_outbox_job_run_organization"();
