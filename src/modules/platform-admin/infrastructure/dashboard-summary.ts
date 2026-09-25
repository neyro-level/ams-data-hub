import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { PlatformAdminDashboardSummary } from "../contracts.ts";

export async function getPlatformAdminDashboardSummary(
  principal: PrincipalContext,
): Promise<PlatformAdminDashboardSummary> {
  const [organizations, projects, users, pendingJobs] =
    await runInPrincipalDatabaseTransaction(principal, (transaction) =>
      Promise.all([
        transaction.organization.count(),
        transaction.project.count(),
        transaction.user.count({ where: { disabledAt: null } }),
        transaction.outboxEvent.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
      ]),
    );

  return {
    organizations,
    projects,
    users,
    pendingJobs,
  };
}
