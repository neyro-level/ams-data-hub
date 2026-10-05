DROP POLICY "Source_rls" ON "Source";
CREATE POLICY "Source_rls" ON "Source" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) IN ('platform-admin', 'system-job')
  OR (
    current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);

DROP POLICY "SourceCredentialRef_rls" ON "SourceCredentialRef";
CREATE POLICY "SourceCredentialRef_rls" ON "SourceCredentialRef" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin'
  OR (
    current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);

DROP POLICY "SourceManualRunRequest_rls" ON "SourceManualRunRequest";
CREATE POLICY "SourceManualRunRequest_rls" ON "SourceManualRunRequest" FOR SELECT TO PUBLIC USING (
  current_setting('app.principal_kind', true) = 'platform-admin'
  OR (
    current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
);

DROP POLICY "SourceManualRunRequest_job_update" ON "SourceManualRunRequest";
CREATE POLICY "SourceManualRunRequest_job_update" ON "SourceManualRunRequest" FOR UPDATE TO PUBLIC
  USING (
    current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  )
  WITH CHECK (
    current_setting('app.principal_kind', true) IN ('job', 'project-job')
    AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND (NULLIF(current_setting('app.project_ids', true), '') = '*'
      OR "projectId" = ANY(string_to_array(NULLIF(current_setting('app.project_ids', true), ''), ',')))
  );
