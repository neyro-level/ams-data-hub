import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import type { FleetDashboard } from "../contracts.ts";
import { OperationsControlError } from "../contracts.ts";
import { buildFleetDashboard } from "../domain/fleet-health.ts";
import type { FleetRepository } from "./ports/fleet-repository.ts";

export async function getFleetDashboardWithRepository(input: {
  principal: PrincipalContext;
  repository: FleetRepository;
  now?: Date;
}): Promise<FleetDashboard> {
  if (input.principal.kind !== "platform-admin") {
    throw new OperationsControlError("OPERATIONS_CONTROL_ADMIN_ACCESS_DENIED");
  }
  const [counts, projects, failedJobs, auditEvents, dataSafety] = await Promise.all([
    input.repository.getPlatformCounts(),
    input.repository.listProjects(),
    input.repository.listRecentFailedJobs(25),
    input.repository.listRecentAuditEvents(50),
    input.repository.getDataSafetyState(),
  ]);
  return buildFleetDashboard({
    projects,
    failedJobs,
    auditEvents,
    dataSafety,
    organizationCount: counts.organizations,
    failedJobCount: counts.failedJobs,
    now: input.now ?? new Date(),
  });
}
