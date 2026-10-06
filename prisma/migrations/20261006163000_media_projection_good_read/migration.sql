-- Separate project-scoped read purpose. Existing import write policies and
-- FORCE RLS remain unchanged; no role or table grants are broadened.
CREATE POLICY "SourceRevision_media_projection_read" ON "SourceRevision"
  FOR SELECT TO PUBLIC USING (
    current_setting('app.principal_kind', true) = 'project-job'
    AND current_setting('app.actor_id', true) = 'media-projection'
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "projectId" = NULLIF(current_setting('app.project_ids', true), '')
    AND "status" = 'GOOD'
  );

CREATE POLICY "SourceRevisionRecord_media_projection_read" ON "SourceRevisionRecord"
  FOR SELECT TO PUBLIC USING (
    current_setting('app.principal_kind', true) = 'project-job'
    AND current_setting('app.actor_id', true) = 'media-projection'
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "projectId" = NULLIF(current_setting('app.project_ids', true), '')
    AND EXISTS (
      SELECT 1 FROM "SourceRevision" r
      WHERE r."id" = "SourceRevisionRecord"."revisionId"
        AND r."organizationId" = "SourceRevisionRecord"."organizationId"
        AND r."projectId" = "SourceRevisionRecord"."projectId"
        AND r."sourceId" = "SourceRevisionRecord"."sourceId"
        AND r."status" = 'GOOD'
    )
  );
