import { getPrismaClient } from "../../../platform/database/prisma/client.ts";
import type { PlatformAdminDashboardSummary } from "../contracts.ts";

export async function getPlatformAdminDashboardSummary(): Promise<PlatformAdminDashboardSummary> {
  const prisma = getPrismaClient();
  const [organizations, projects, sites, enabledProviders, runningSyncs, pendingJobs] =
    await prisma.$transaction([
      prisma.organization.count(),
      prisma.project.count(),
      prisma.site.count(),
      prisma.providerConnection.count({ where: { enabled: true } }),
      prisma.syncRun.count({ where: { status: "RUNNING" } }),
      prisma.outboxEvent.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    ]);

  return {
    organizations,
    projects,
    sites,
    enabledProviders,
    runningSyncs,
    pendingJobs,
  };
}
