import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { ProjectService } from "./project-service.ts";

export interface ClientOverview {
  client: {
    clientSlug: string;
    name: string;
    enabled: boolean;
  };
  sites: Array<{
    siteSlug: string;
    name: string;
    siteUrl: string;
    enabled: boolean;
    enabledSourceCount: number;
  }>;
}

export class SiteService {
  constructor(private readonly projectService: ProjectService) {}

  async getProjectOverviewForUser(
    user: PrincipalContext,
    clientSlug: string,
  ): Promise<ClientOverview | null> {
    const project = await this.projectService.getProjectTreeForUser(user, clientSlug);
    if (!project) {
      return null;
    }

    return {
      client: {
        clientSlug: project.projectSlug,
        name: project.name,
        enabled: project.status !== "DISABLED",
      },
      sites: project.sites.map((site) => ({
        siteSlug: site.siteSlug,
        name: site.name,
        siteUrl: site.url,
        enabled: site.enabled,
        enabledSourceCount: site.enabledSourceCount,
      })),
    };
  }
}
