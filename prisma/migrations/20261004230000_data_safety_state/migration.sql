CREATE TABLE "DataSafetyState" (
  "id" TEXT NOT NULL,
  "jobsFrozen" BOOLEAN NOT NULL DEFAULT true,
  "freezeReason" TEXT,
  "frozenAt" TIMESTAMPTZ(3),
  "reconciledAt" TIMESTAMPTZ(3),
  "unfrozenAt" TIMESTAMPTZ(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataSafetyState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataSafetyState_singleton_check" CHECK ("id" = 'global'),
  CONSTRAINT "DataSafetyState_unfreeze_check" CHECK ("jobsFrozen" OR "unfrozenAt" IS NOT NULL)
);

ALTER TABLE "DataSafetyState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataSafetyState" FORCE ROW LEVEL SECURITY;

CREATE POLICY "DataSafetyState_read" ON "DataSafetyState"
  FOR SELECT TO PUBLIC
  USING (current_setting('app.principal_kind', true) IN ('platform-admin', 'platform-staff', 'system-job', 'job'));

CREATE POLICY "DataSafetyState_admin_write" ON "DataSafetyState"
  FOR ALL TO PUBLIC
  USING (current_setting('app.principal_kind', true) IN ('platform-admin', 'system-job'))
  WITH CHECK (current_setting('app.principal_kind', true) IN ('platform-admin', 'system-job'));

GRANT SELECT, INSERT, UPDATE ON TABLE "DataSafetyState" TO ams_data_hub_web;
GRANT SELECT ON TABLE "DataSafetyState" TO ams_data_hub_worker;
GRANT SELECT ON TABLE "DataSafetyState" TO ams_data_hub_backup;
