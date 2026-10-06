-- Concrete source-import must read its Project status/service state under the
-- actual non-bypass worker role. Existing project-scoped RLS remains unchanged;
-- no Project mutation grant or global tenant-read policy is added.
GRANT SELECT ON TABLE "Project" TO ams_data_hub_worker;
