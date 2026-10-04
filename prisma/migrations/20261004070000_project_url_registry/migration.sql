CREATE TYPE "FactualLifecycleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED', 'DEPARTED');
CREATE TYPE "PresentationLifecycleStatus" AS ENUM ('VISIBLE', 'ARCHIVED_VISIBLE', 'REDIRECTED', 'GONE');
CREATE TYPE "ProjectRedirectReason" AS ENUM ('SLUG_CHANGE', 'RELINK', 'RETIRE', 'LIFECYCLE', 'MANUAL');

CREATE TABLE "ProjectUrlPolicy" (
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "policyKey" VARCHAR(128) NOT NULL,
  "pathTemplates" JSONB NOT NULL,
  "reservedNamespaces" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProjectUrlPolicy_pkey" PRIMARY KEY ("organizationId", "projectId")
);

CREATE TABLE "ProjectUrlEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "entityType" "ProjectEditorialEntityType" NOT NULL,
  "entityUid" VARCHAR(26) NOT NULL,
  "reservationId" TEXT NOT NULL,
  "slug" VARCHAR(200) NOT NULL,
  "canonicalPath" VARCHAR(1024) NOT NULL,
  "factualLifecycle" "FactualLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "presentationLifecycle" "PresentationLifecycleStatus" NOT NULL DEFAULT 'VISIBLE',
  "redirectTargetPath" VARCHAR(1024),
  "version" INTEGER NOT NULL DEFAULT 1,
  "publishedAt" TIMESTAMPTZ(3),
  "retiredAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProjectUrlEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectUrlEntry_slug_check" CHECK (length("slug") > 0 AND "slug" !~ '[/?#\\]'),
  CONSTRAINT "ProjectUrlEntry_path_check" CHECK (
    left("canonicalPath", 1) = '/'
    AND "canonicalPath" !~ '[?#\\]'
    AND "canonicalPath" !~ '//'
  ),
  CONSTRAINT "ProjectUrlEntry_redirect_target_check" CHECK (
    "redirectTargetPath" IS NULL OR (
      left("redirectTargetPath", 1) = '/'
      AND "redirectTargetPath" !~ '[?#\\]'
      AND "redirectTargetPath" !~ '//'
    )
  ),
  CONSTRAINT "ProjectUrlEntry_presentation_check" CHECK (
    ("presentationLifecycle" = 'REDIRECTED' AND "redirectTargetPath" IS NOT NULL)
    OR ("presentationLifecycle" <> 'REDIRECTED' AND "redirectTargetPath" IS NULL)
  )
);

CREATE TABLE "ProjectRedirect" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "urlEntryId" TEXT NOT NULL,
  "fromPath" VARCHAR(1024) NOT NULL,
  "toPath" VARCHAR(1024) NOT NULL,
  "code" INTEGER NOT NULL DEFAULT 301,
  "reason" "ProjectRedirectReason" NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectRedirect_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectRedirect_code_check" CHECK ("code" = 301),
  CONSTRAINT "ProjectRedirect_paths_check" CHECK (
    "fromPath" <> "toPath"
    AND left("fromPath", 1) = '/'
    AND left("toPath", 1) = '/'
    AND "fromPath" !~ '[?#\\]'
    AND "toPath" !~ '[?#\\]'
    AND "fromPath" !~ '//'
    AND "toPath" !~ '//'
  )
);

CREATE TABLE "ProjectUrlTombstone" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "entityType" "ProjectEditorialEntityType" NOT NULL,
  "entityUid" VARCHAR(26) NOT NULL,
  "canonicalPath" VARCHAR(1024) NOT NULL,
  "reason" "ProjectRedirectReason" NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectUrlTombstone_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectUrlTombstone_path_check" CHECK (
    left("canonicalPath", 1) = '/'
    AND "canonicalPath" !~ '[?#\\]'
    AND "canonicalPath" !~ '//'
  )
);

CREATE INDEX "ProjectUrlPolicy_projectId_idx" ON "ProjectUrlPolicy"("projectId");
CREATE UNIQUE INDEX "ProjectUrlEntry_reservationId_key" ON "ProjectUrlEntry"("reservationId");
CREATE UNIQUE INDEX "ProjectUrlEntry_entity_key" ON "ProjectUrlEntry"("organizationId", "projectId", "entityType", "entityUid");
CREATE UNIQUE INDEX "ProjectUrlEntry_path_key" ON "ProjectUrlEntry"("projectId", "canonicalPath");
CREATE INDEX "ProjectUrlEntry_projectId_presentation_idx" ON "ProjectUrlEntry"("projectId", "presentationLifecycle");
CREATE UNIQUE INDEX "ProjectRedirect_fromPath_key" ON "ProjectRedirect"("organizationId", "projectId", "fromPath");
CREATE INDEX "ProjectRedirect_projectId_createdAt_idx" ON "ProjectRedirect"("projectId", "createdAt");
CREATE INDEX "ProjectRedirect_urlEntryId_createdAt_idx" ON "ProjectRedirect"("urlEntryId", "createdAt");
CREATE UNIQUE INDEX "ProjectUrlTombstone_path_key" ON "ProjectUrlTombstone"("organizationId", "projectId", "canonicalPath");
CREATE INDEX "ProjectUrlTombstone_reservationId_idx" ON "ProjectUrlTombstone"("reservationId");

ALTER TABLE "ProjectUrlPolicy" ADD CONSTRAINT "ProjectUrlPolicy_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectUrlEntry" ADD CONSTRAINT "ProjectUrlEntry_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectUrlEntry" ADD CONSTRAINT "ProjectUrlEntry_reservation_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "PublicUrlIdReservation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectRedirect" ADD CONSTRAINT "ProjectRedirect_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectRedirect" ADD CONSTRAINT "ProjectRedirect_urlEntry_fkey"
  FOREIGN KEY ("urlEntryId") REFERENCES "ProjectUrlEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectUrlTombstone" ADD CONSTRAINT "ProjectUrlTombstone_project_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectUrlTombstone" ADD CONSTRAINT "ProjectUrlTombstone_reservation_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "PublicUrlIdReservation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "guard_project_url_entry_path"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."projectId" || ':' || NEW."canonicalPath", 0));
  IF EXISTS (
    SELECT 1 FROM "ProjectRedirect"
    WHERE "projectId" = NEW."projectId" AND "fromPath" = NEW."canonicalPath"
  ) OR EXISTS (
    SELECT 1 FROM "ProjectUrlTombstone"
    WHERE "projectId" = NEW."projectId" AND "canonicalPath" = NEW."canonicalPath"
  ) THEN
    RAISE EXCEPTION 'URL path is reserved by immutable history' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_project_redirect_path"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."projectId" || ':' || NEW."fromPath", 0));
  IF EXISTS (
    SELECT 1 FROM "ProjectUrlTombstone" t
    JOIN "ProjectUrlEntry" e ON e."reservationId" = t."reservationId"
    WHERE t."projectId" = NEW."projectId"
      AND t."canonicalPath" = NEW."fromPath"
      AND e."id" <> NEW."urlEntryId"
  ) OR EXISTS (
    SELECT 1 FROM "ProjectUrlEntry"
    WHERE "projectId" = NEW."projectId"
      AND "canonicalPath" = NEW."fromPath"
      AND "id" <> NEW."urlEntryId"
  ) THEN
    RAISE EXCEPTION 'URL path belongs to another registry entry' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_project_url_tombstone_path"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."projectId" || ':' || NEW."canonicalPath", 0));
  IF EXISTS (
    SELECT 1 FROM "ProjectUrlEntry"
    WHERE "projectId" = NEW."projectId"
      AND "canonicalPath" = NEW."canonicalPath"
      AND "reservationId" <> NEW."reservationId"
  ) OR EXISTS (
    SELECT 1 FROM "ProjectRedirect" r
    JOIN "ProjectUrlEntry" e ON e."id" = r."urlEntryId"
    WHERE r."projectId" = NEW."projectId"
      AND r."fromPath" = NEW."canonicalPath"
      AND e."reservationId" <> NEW."reservationId"
  ) THEN
    RAISE EXCEPTION 'URL path belongs to another registry identity' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectUrlEntry_path_guard"
BEFORE INSERT OR UPDATE OF "canonicalPath" ON "ProjectUrlEntry"
FOR EACH ROW EXECUTE FUNCTION "guard_project_url_entry_path"();
CREATE TRIGGER "ProjectRedirect_path_guard"
BEFORE INSERT ON "ProjectRedirect"
FOR EACH ROW EXECUTE FUNCTION "guard_project_redirect_path"();
CREATE TRIGGER "ProjectUrlTombstone_path_guard"
BEFORE INSERT ON "ProjectUrlTombstone"
FOR EACH ROW EXECUTE FUNCTION "guard_project_url_tombstone_path"();

CREATE OR REPLACE FUNCTION "deny_project_url_history_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'URL redirects and tombstones are immutable history'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "ProjectRedirect_immutable"
BEFORE UPDATE OR DELETE ON "ProjectRedirect"
FOR EACH ROW EXECUTE FUNCTION "deny_project_url_history_mutation"();
CREATE TRIGGER "ProjectUrlTombstone_immutable"
BEFORE UPDATE OR DELETE ON "ProjectUrlTombstone"
FOR EACH ROW EXECUTE FUNCTION "deny_project_url_history_mutation"();

ALTER TABLE "ProjectUrlPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectUrlPolicy" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProjectUrlEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectUrlEntry" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProjectRedirect" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectRedirect" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProjectUrlTombstone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectUrlTombstone" FORCE ROW LEVEL SECURITY;

CREATE POLICY "ProjectUrlPolicy_rls" ON "ProjectUrlPolicy" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin'
  OR (
    current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
CREATE POLICY "ProjectUrlPolicy_admin_write" ON "ProjectUrlPolicy" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin')
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

CREATE POLICY "ProjectUrlEntry_rls" ON "ProjectUrlEntry" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin'
  OR (
    current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
CREATE POLICY "ProjectUrlEntry_admin_write" ON "ProjectUrlEntry" FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) = 'platform-admin')
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

CREATE POLICY "ProjectRedirect_rls" ON "ProjectRedirect" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin'
  OR (
    current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
CREATE POLICY "ProjectRedirect_admin_insert" ON "ProjectRedirect" FOR INSERT TO PUBLIC
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

CREATE POLICY "ProjectUrlTombstone_rls" ON "ProjectUrlTombstone" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin'
  OR (
    current_setting('app.principal_kind', true) IN ('tenant-user', 'api-client', 'job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);
CREATE POLICY "ProjectUrlTombstone_admin_insert" ON "ProjectUrlTombstone" FOR INSERT TO PUBLIC
  WITH CHECK (current_setting('app.principal_kind', true) = 'platform-admin');

GRANT SELECT, INSERT, UPDATE ON TABLE "ProjectUrlPolicy", "ProjectUrlEntry" TO ams_data_hub_web;
GRANT SELECT, INSERT ON TABLE "ProjectRedirect", "ProjectUrlTombstone" TO ams_data_hub_web;
GRANT SELECT ON TABLE "ProjectUrlPolicy", "ProjectUrlEntry", "ProjectRedirect", "ProjectUrlTombstone" TO ams_data_hub_worker, ams_data_hub_backup;
