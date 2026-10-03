CREATE TABLE "PublicUrlIdReservation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "subjectType" VARCHAR(64) NOT NULL,
  "subjectUid" VARCHAR(26) NOT NULL,
  "publicUrlId" VARCHAR(16) NOT NULL,
  "reservedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicUrlIdReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicUrlIdReservation_subjectType_check"
    CHECK ("subjectType" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT "PublicUrlIdReservation_subjectUid_check"
    CHECK ("subjectUid" ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT "PublicUrlIdReservation_publicUrlId_check"
    CHECK ("publicUrlId" ~ '^[0-9a-hjkmnp-tv-z]{16}$')
);

CREATE UNIQUE INDEX "PublicUrlIdReservation_subject_key"
  ON "PublicUrlIdReservation"("organizationId", "projectId", "subjectType", "subjectUid");
CREATE UNIQUE INDEX "PublicUrlIdReservation_project_publicUrlId_key"
  ON "PublicUrlIdReservation"("projectId", "publicUrlId");
CREATE INDEX "PublicUrlIdReservation_organizationId_reservedAt_idx"
  ON "PublicUrlIdReservation"("organizationId", "reservedAt");
CREATE INDEX "PublicUrlIdReservation_subjectUid_idx"
  ON "PublicUrlIdReservation"("subjectUid");

ALTER TABLE "PublicUrlIdReservation"
  ADD CONSTRAINT "PublicUrlIdReservation_project_fkey"
  FOREIGN KEY ("organizationId", "projectId")
  REFERENCES "Project"("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "deny_public_url_id_reservation_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PublicUrlId reservations are immutable and cannot be reused'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "PublicUrlIdReservation_immutable"
BEFORE UPDATE OR DELETE ON "PublicUrlIdReservation"
FOR EACH ROW
EXECUTE FUNCTION "deny_public_url_id_reservation_mutation"();

ALTER TABLE "PublicUrlIdReservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PublicUrlIdReservation" FORCE ROW LEVEL SECURITY;

CREATE POLICY "PublicUrlIdReservation_rls" ON "PublicUrlIdReservation"
  FOR ALL TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff')
    OR (
      current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    )
  );

GRANT SELECT, INSERT ON TABLE "PublicUrlIdReservation" TO ams_data_hub_web;
GRANT SELECT, INSERT ON TABLE "PublicUrlIdReservation" TO ams_data_hub_worker;
GRANT SELECT ON TABLE "PublicUrlIdReservation" TO ams_data_hub_backup;
