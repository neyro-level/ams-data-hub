import type {
  FleetAuditEventRecord,
  FleetDataSafetyRecord,
  FleetFailedJobRecord,
  FleetProjectRecord,
} from "../../contracts.ts";

export interface FleetRepository {
  getPlatformCounts(): Promise<{ organizations: number; failedJobs: number }>;
  listProjects(): Promise<FleetProjectRecord[]>;
  listRecentFailedJobs(limit: number): Promise<FleetFailedJobRecord[]>;
  listRecentAuditEvents(limit: number): Promise<FleetAuditEventRecord[]>;
  getDataSafetyState(): Promise<FleetDataSafetyRecord>;
}
