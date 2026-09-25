-- A MATCH FULL composite foreign key cannot represent a global outbox event:
-- it rejects (organizationId = NULL, outboxEventId != NULL). Keep the same
-- organization invariant with a deferred constraint trigger and permit global
-- rows only when both sides are global.
ALTER TABLE "IdempotencyKey"
  DROP CONSTRAINT "IdempotencyKey_outbox_organization_fkey";

CREATE OR REPLACE FUNCTION "assert_idempotency_outbox_organization"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."outboxEventId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "OutboxEvent"
    WHERE "id" = NEW."outboxEventId"
      AND "organizationId" IS NOT DISTINCT FROM NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'IdempotencyKey organization must match its OutboxEvent organization'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "IdempotencyKey_outbox_organization_check"
AFTER INSERT OR UPDATE OF "organizationId", "outboxEventId" ON "IdempotencyKey"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION "assert_idempotency_outbox_organization"();

CREATE OR REPLACE FUNCTION "assert_outbox_idempotency_organization"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "IdempotencyKey"
    WHERE "outboxEventId" = NEW."id"
      AND "organizationId" IS DISTINCT FROM NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'OutboxEvent organization must match its IdempotencyKey organization'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "OutboxEvent_idempotency_organization_check"
AFTER UPDATE OF "organizationId" ON "OutboxEvent"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION "assert_outbox_idempotency_organization"();
