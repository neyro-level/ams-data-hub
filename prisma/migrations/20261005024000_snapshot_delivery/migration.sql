CREATE TYPE "DeliveryRunStatus" AS ENUM (
  'PENDING', 'NOTIFIED', 'DOWNLOADED', 'APPLIED', 'ACKNOWLEDGED', 'FAILED', 'STALE'
);

CREATE TABLE "ProjectCurrentSnapshotManifest" (
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "publishSequence" INTEGER NOT NULL,
  "manifestKey" VARCHAR(512) NOT NULL,
  "manifestSha256" VARCHAR(64) NOT NULL,
  "publishedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCurrentSnapshotManifest_pkey" PRIMARY KEY ("organizationId", "projectId"),
  CONSTRAINT "ProjectCurrentSnapshotManifest_sequence_check" CHECK ("publishSequence" > 0),
  CONSTRAINT "ProjectCurrentSnapshotManifest_sha256_check" CHECK ("manifestSha256" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "DeliveryRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "publishSequence" INTEGER NOT NULL,
  "manifestKey" VARCHAR(512) NOT NULL,
  "manifestSha256" VARCHAR(64) NOT NULL,
  "status" "DeliveryRunStatus" NOT NULL DEFAULT 'PENDING',
  "publishedAt" TIMESTAMPTZ(3) NOT NULL,
  "notifiedAt" TIMESTAMPTZ(3),
  "downloadedAt" TIMESTAMPTZ(3),
  "appliedAt" TIMESTAMPTZ(3),
  "acknowledgedAt" TIMESTAMPTZ(3),
  "failedAt" TIMESTAMPTZ(3),
  "staleAt" TIMESTAMPTZ(3),
  "safeErrorCode" VARCHAR(120),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryRun_sequence_check" CHECK ("publishSequence" > 0),
  CONSTRAINT "DeliveryRun_sha256_check" CHECK ("manifestSha256" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "ProjectCurrentSnapshotManifest_projectId_publishSequence_idx"
  ON "ProjectCurrentSnapshotManifest"("projectId", "publishSequence");
CREATE UNIQUE INDEX "DeliveryRun_project_sequence_key"
  ON "DeliveryRun"("organizationId", "projectId", "publishSequence");
CREATE INDEX "DeliveryRun_status_createdAt_idx" ON "DeliveryRun"("status", "createdAt");
CREATE INDEX "DeliveryRun_projectId_publishSequence_idx" ON "DeliveryRun"("projectId", "publishSequence");

ALTER TABLE "ProjectCurrentSnapshotManifest" ADD CONSTRAINT "ProjectCurrentSnapshotManifest_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryRun" ADD CONSTRAINT "DeliveryRun_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "guard_current_snapshot_sequence"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."publishSequence" <= OLD."publishSequence" THEN
    RAISE EXCEPTION 'Current snapshot sequence must increase' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProjectCurrentSnapshotManifest_sequence_guard"
BEFORE UPDATE ON "ProjectCurrentSnapshotManifest"
FOR EACH ROW EXECUTE FUNCTION "guard_current_snapshot_sequence"();

CREATE OR REPLACE FUNCTION "guard_delivery_run_transition"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = OLD."status" THEN RETURN NEW; END IF;
  IF NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('NOTIFIED', 'DOWNLOADED', 'FAILED', 'STALE')) OR
    (OLD."status" = 'NOTIFIED' AND NEW."status" IN ('DOWNLOADED', 'FAILED', 'STALE')) OR
    (OLD."status" = 'DOWNLOADED' AND NEW."status" IN ('APPLIED', 'FAILED', 'STALE')) OR
    (OLD."status" = 'APPLIED' AND NEW."status" IN ('ACKNOWLEDGED', 'FAILED', 'STALE'))
  ) THEN
    RAISE EXCEPTION 'Invalid delivery run transition: % -> %', OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "DeliveryRun_transition_guard"
BEFORE UPDATE OF "status" ON "DeliveryRun"
FOR EACH ROW EXECUTE FUNCTION "guard_delivery_run_transition"();

ALTER TABLE "ProjectCurrentSnapshotManifest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectCurrentSnapshotManifest" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryRun" FORCE ROW LEVEL SECURITY;

CREATE POLICY "ProjectCurrentSnapshotManifest_rls" ON "ProjectCurrentSnapshotManifest" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin' OR (
    current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
CREATE POLICY "ProjectCurrentSnapshotManifest_write" ON "ProjectCurrentSnapshotManifest" FOR ALL TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'system-job') OR (
      current_setting('app.principal_kind', true) IN ('job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
    )
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'system-job') OR (
      current_setting('app.principal_kind', true) IN ('job', 'project-job')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
    )
  );

CREATE POLICY "DeliveryRun_rls" ON "DeliveryRun" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin' OR (
    current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
CREATE POLICY "DeliveryRun_write" ON "DeliveryRun" FOR ALL TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'system-job') OR (
      current_setting('app.principal_kind', true) IN ('job', 'project-job', 'api-client')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
    )
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) IN ('platform-admin', 'system-job') OR (
      current_setting('app.principal_kind', true) IN ('job', 'project-job', 'api-client')
      AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
      AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
        OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
    )
  );

GRANT SELECT, INSERT, UPDATE ON TABLE "ProjectCurrentSnapshotManifest", "DeliveryRun" TO ams_data_hub_web;
GRANT SELECT, INSERT, UPDATE ON TABLE "ProjectCurrentSnapshotManifest", "DeliveryRun" TO ams_data_hub_worker;
GRANT SELECT ON TABLE "ProjectCurrentSnapshotManifest", "DeliveryRun" TO ams_data_hub_backup;
