import type { SiteSourceCollectors } from "./application/ports/provider-collectors.ts";
import type { CreateSyncRunInput } from "./application/ports/sync-repository.ts";
import { createLiveSiteCollectors } from "../../../collector/orchestration/live-collectors.ts";
import { getWorkerSyncService } from "../../infrastructure/worker-service-container.ts";
import type { ReportPeriodKey, SiteReportSnapshot } from "../../shared/schemas/report.ts";
export { setupSiteIntegrations, startScheduledTopvisorChecks, syncSiteCompetitors, syncAllConfiguredCompetitors } from "./infrastructure/site-integration-setup.ts";

export interface SyncProjectToDatabaseArgs {
  projectSlug: string;
  trigger?: CreateSyncRunInput["trigger"];
  env?: NodeJS.ProcessEnv;
  collectors?: SiteSourceCollectors;
  now?: () => string;
  correlationId?: string;
  expectedOrganizationId?: string | null;
}

export interface SyncProjectPeriodResult {
  periodKey: ReportPeriodKey;
  freshness: SiteReportSnapshot["freshness"];
}

export interface SyncProjectSiteResult {
  siteSlug: string;
  status: "success" | "partial" | "failed";
  freshness: SiteReportSnapshot["freshness"];
  periods: SyncProjectPeriodResult[];
  safeErrorCodes: string[];
}

export interface SyncProjectToDatabaseResult {
  syncRunId: string;
  projectSlug: string;
  status: "success" | "partial" | "failed";
  sites: SyncProjectSiteResult[];
}

export async function syncProjectToDatabase(
  args: SyncProjectToDatabaseArgs,
): Promise<SyncProjectToDatabaseResult> {
  return getWorkerSyncService().syncProjectToDatabase({
    projectSlug: args.projectSlug,
    trigger: args.trigger ?? "manual",
    collectors: args.collectors ?? createLiveSiteCollectors(args.env),
    now: args.now,
    correlationId: args.correlationId,
    expectedOrganizationId: args.expectedOrganizationId,
  });
}
