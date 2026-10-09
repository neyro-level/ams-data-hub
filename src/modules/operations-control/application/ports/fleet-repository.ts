import type {
  FleetAlertRecord,
  FleetAuditEventRecord,
  FleetDataSafetyRecord,
  FleetFailedJobRecord,
  FleetProjectRecord,
} from "../../contracts.ts";

export interface FleetRepository {
  getPlatformCounts(): Promise<{ organizations: number; failedJobs: number }>;
  listProjects(): Promise<FleetProjectRecord[]>;
  listRecentFailedJobs(limit: number): Promise<FleetFailedJobRecord[]>;
  listRecentAlerts(limit: number): Promise<FleetAlertRecord[]>;
  listRecentAuditEvents(limit: number): Promise<FleetAuditEventRecord[]>;
  getDataSafetyState(): Promise<FleetDataSafetyRecord>;
}
