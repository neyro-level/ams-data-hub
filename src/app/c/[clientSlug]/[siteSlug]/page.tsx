export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { ReportPeriodSelector } from "../../../../components/dashboard/ReportPeriodSelector.tsx";
import { SiteReportView } from "../../../../modules/reporting/presentation.ts";
import {
  getCurrentCabinetRedirect,
  getCurrentPrincipalState,
} from "../../../../modules/identity-access/server.ts";
import {
  getMonitoringService,
  getProjectService,
  getReportService,
} from "../../../../infrastructure/service-container.ts";
import { reportPeriodKeySchema, type ReportPeriodKey } from "../../../../shared/schemas/report.ts";

type SiteReportPageProps = {
  params: Promise<{
    clientSlug: string;
    siteSlug: string;
  }>;
  searchParams: Promise<{
    period?: string;
  }>;
};

function resolvePeriodKey(period: string | undefined): ReportPeriodKey {
  const parsedPeriod = reportPeriodKeySchema.safeParse(period);
  return parsedPeriod.success ? parsedPeriod.data : "month";
}

export default async function SiteReportPage({ params, searchParams }: SiteReportPageProps) {
  const cabinetRedirect = await getCurrentCabinetRedirect();
  if (cabinetRedirect) redirect(cabinetRedirect);
  const state = await getCurrentPrincipalState();
  if (!state) redirect("/?login=1");

  const { clientSlug, siteSlug } = await params;
  const { period } = await searchParams;
  const periodKey = resolvePeriodKey(period);
  const projectService = getProjectService();
  const reportService = getReportService();
  const monitoringService = getMonitoringService();

  const authorizedSite = await projectService.getSiteAccessForUser(state.principal, clientSlug, siteSlug);
  if (!authorizedSite) {
    notFound();
  }

  const [projectContext, snapshot, directorAnalytics] = await Promise.all([
    monitoringService.getProjectContext(clientSlug),
    reportService.getSiteReportForUser(state.principal, clientSlug, siteSlug, periodKey),
    reportService.getSiteDirectorAnalyticsForUser(state.principal, clientSlug, siteSlug, periodKey),
  ]);
  const site = projectContext?.client.sites.find((item) => item.siteSlug === siteSlug) ?? null;

  if (!projectContext || !site) {
    notFound();
  }

  return (
    <>
      <SiteReportView
        site={site}
        snapshot={snapshot}
        directorAnalytics={directorAnalytics}
        mode="live"
        backHref={`/c/${clientSlug}/`}
        periodControl={
          <ReportPeriodSelector
            active={periodKey}
          />
        }
      />
    </>
  );
}
