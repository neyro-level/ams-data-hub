import type { ProjectRepository } from "../../project-registry/index.ts";
import type { DirectorAnalytics, ReportRepository, StoredReportSnapshotRecord } from "./ports/report-repository.ts";
import type { ReportPeriodKey, SiteReportSnapshot } from "../../../shared/schemas/report.ts";
import { hasPermission, type PrincipalContext } from "../../../platform/authorization/principal.ts";
import { ProjectService } from "../../project-registry/index.ts";

export class ReportService {
  private readonly projectService: ProjectService;

  constructor(
    projectServiceOrRepository: ProjectService | ProjectRepository,
    private readonly reportRepository: ReportRepository,
  ) {
    this.projectService =
      projectServiceOrRepository instanceof ProjectService
        ? projectServiceOrRepository
        : new ProjectService(projectServiceOrRepository);
  }

  async getSiteReportForUser(
    user: PrincipalContext,
    projectSlug: string,
    siteSlug: string,
    periodKey: ReportPeriodKey,
  ): Promise<SiteReportSnapshot | null> {
    if (
      !hasPermission(user, "report:read:any") &&
      !hasPermission(user, "report:read:organization")
    ) {
      return null;
    }

    const site = await this.projectService.getSiteAccessForUser(user, projectSlug, siteSlug);
    if (!site) {
      return null;
    }

    const report = await this.reportRepository.findLatestReportSnapshot(site.siteId, periodKey);
    return report?.payload ?? null;
  }

  async getLatestReportSnapshotForSite(
    siteId: string,
    periodKey: ReportPeriodKey,
  ): Promise<StoredReportSnapshotRecord | null> {
    return this.reportRepository.findLatestReportSnapshot(siteId, periodKey);
  }

  async getSiteDirectorAnalyticsForUser(user: PrincipalContext, projectSlug: string, siteSlug: string, periodKey: ReportPeriodKey): Promise<DirectorAnalytics | null> {
    if (!hasPermission(user, "report:read:any") && !hasPermission(user, "report:read:organization")) return null;
    const site = await this.projectService.getSiteAccessForUser(user, projectSlug, siteSlug);
    return site && this.reportRepository.findDirectorAnalytics ? this.reportRepository.findDirectorAnalytics(site.siteId, periodKey) : null;
  }
}
