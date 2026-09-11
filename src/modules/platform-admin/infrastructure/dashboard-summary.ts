import { getPrismaClient } from "../../../platform/database/prisma/client.ts";
import type { PlatformAdminDashboardSummary } from "../contracts.ts";

export async function getPlatformAdminDashboardSummary(): Promise<PlatformAdminDashboardSummary> {
  const prisma = getPrismaClient();
  const [organizations, projects, users, pendingJobs] =
    await prisma.$transaction([
      prisma.organization.count(),
      prisma.project.count(),
      prisma.user.count({ where: { disabledAt: null } }),
      prisma.outboxEvent.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    ]);

  return {
    organizations,
    projects,
    users,
    pendingJobs,
  };
}
