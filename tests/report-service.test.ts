import { describe, expect, it } from "vitest";
import { ReportService } from "../src/modules/reporting/index.ts";
import type {
  ProjectAccessScope,
  ProjectRepository,
  StoredProjectRecord,
  StoredSiteRecord,
} from "../src/modules/project-registry/index.ts";
import type {
  ReportRepository,
  StoredReportSnapshotRecord,
} from "../src/modules/reporting/index.ts";
import {
  createDeniedJobPrincipal,
  createPlatformAnalystPrincipal,
  createTenantUserPrincipal,
} from "./helpers/principal.ts";
import { siteReportSnapshotSchema } from "../src/shared/schemas/report.ts";

const analystUser = createPlatformAnalystPrincipal("analyst-1");

const alphaViewer = createTenantUserPrincipal({
  userId: "viewer-1",
  membershipId: "membership-alpha",
  organizationId: "org-alpha",
});

const deniedReportPrincipal = createDeniedJobPrincipal("org-alpha");

const sampleSite: StoredSiteRecord = {
  siteId: "site-north",
  projectId: "project-alpha",
  organizationId: "org-alpha",
  projectSlug: "alpha",
  siteSlug: "north",
  name: "Север",
  url: "https://alpha.example.test",
  timezone: "+03:00",
  enabled: true,
  enabledSourceCount: 2,
};

const sampleProject: StoredProjectRecord = {
  projectId: "project-alpha",
  organizationId: "org-alpha",
  projectSlug: "alpha",
  name: "Альфа",
  status: "ACTIVE",
  sites: [sampleSite],
};

const sampleReport = siteReportSnapshotSchema.parse({
  schemaVersion: 1,
  clientSlug: "alpha",
  siteSlug: "north",
  siteUrl: "https://alpha.example.test",
  generatedAt: "2026-08-30T00:00:00+03:00",
  freshness: "fresh",
  periodKey: "month",
  sources: {
    webmaster: {
      status: "success",
      fetchedAt: "2026-08-30T00:00:00+03:00",
      periodStart: "2026-08-03",
      periodEnd: "2026-08-30",
      timezone: "+03:00",
      note: null,
      safeErrorCode: null,
    },
    metrica: {
      status: "success",
      fetchedAt: "2026-08-30T00:00:00+03:00",
      periodStart: "2026-08-03",
      periodEnd: "2026-08-30",
      timezone: "+03:00",
      note: null,
      safeErrorCode: null,
    },
  },
  webmaster: null,
  metrica: null,
  ranking: null,
  comparison: null,
  combined: {
    funnel: {
      shows: 0,
      clicks: 0,
      visits: 0,
      goalReaches: 0,
      caveats: ["demo"],
    },
    opportunities: [],
    alerts: [],
    methodology: ["demo"],
  },
});

class FakeProjectRepository implements ProjectRepository {
  async listProjects(scope: ProjectAccessScope): Promise<StoredProjectRecord[]> {
    if (scope.organizationIds !== null && !scope.organizationIds.includes(sampleProject.organizationId)) {
      return [];
    }
    return [sampleProject];
  }

  async findProjectBySlug(
    projectSlug: string,
    scope: ProjectAccessScope,
  ): Promise<StoredProjectRecord | null> {
    return projectSlug === sampleProject.projectSlug && (await this.listProjects(scope)).length > 0
      ? sampleProject
      : null;
  }

  async findSiteBySlugs(
    projectSlug: string,
    siteSlug: string,
    scope: ProjectAccessScope,
  ): Promise<StoredSiteRecord | null> {
    return projectSlug === sampleSite.projectSlug &&
      siteSlug === sampleSite.siteSlug &&
      (await this.listProjects(scope)).length > 0
      ? sampleSite
      : null;
  }
}

class FakeReportRepository implements ReportRepository {
  async findLatestReportSnapshot(siteId: string): Promise<StoredReportSnapshotRecord | null> {
    return siteId === sampleSite.siteId
      ? {
          siteId: sampleSite.siteId,
          periodKey: "month",
          generatedAt: sampleReport.generatedAt,
          freshness: "fresh",
          payload: sampleReport,
        }
      : null;
  }
}

describe("ReportService", () => {
  const reportService = new ReportService(
    new FakeProjectRepository(),
    new FakeReportRepository(),
  );

  it("returns report for analyst", async () => {
    const report = await reportService.getSiteReportForUser(
      analystUser,
      "alpha",
      "north",
      "month",
    );
    expect(report?.clientSlug).toBe("alpha");
  });

  it("returns report for allowed client viewer", async () => {
    const report = await reportService.getSiteReportForUser(
      alphaViewer,
      "alpha",
      "north",
      "month",
    );
    expect(report?.siteSlug).toBe("north");
  });

  it("denies report without report-read capability", async () => {
    const deniedReport = await reportService.getSiteReportForUser(
      deniedReportPrincipal,
      "alpha",
      "north",
      "month",
    );
    expect(deniedReport).toBeNull();
  });

  it("denies report outside allowed organization", async () => {
    const deniedReport = await reportService.getSiteReportForUser(
      alphaViewer,
      "beta",
      "west",
      "month",
    );
    expect(deniedReport).toBeNull();
  });
});
