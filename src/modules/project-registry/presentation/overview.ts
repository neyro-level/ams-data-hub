import "server-only";

import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import type { AnalystOverview } from "../application/analyst-service.ts";
import type { ClientOverview } from "../application/site-service.ts";
import { getAnalystService, getSiteService } from "../../../infrastructure/service-container.ts";

export async function buildAnalystOverview(
  user: PrincipalContext,
): Promise<AnalystOverview> {
  return getAnalystService().getDashboardForUser(user);
}

export async function buildClientOverview(
  user: PrincipalContext,
  clientSlug: string,
): Promise<ClientOverview | null> {
  return getSiteService().getProjectOverviewForUser(user, clientSlug);
}
