import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { ProjectService, type ProjectSummary } from "./project-service.ts";

export interface AnalystOverview {
  totalProjects: number;
  totalSites: number;
  connectedSites: number;
  plannedSites: number;
  enabledSources: number;
  projectCards: ProjectSummary[];
}

export class AnalystService {
  constructor(private readonly projectService: ProjectService) {}

  async getDashboardForUser(user: PrincipalContext): Promise<AnalystOverview> {
    const projectCards = await this.projectService.listProjectsForUser(user);
    const totalSites = projectCards.reduce((count, project) => count + project.totalSites, 0);
    const connectedSites = projectCards.reduce(
      (count, project) => count + project.connectedSites,
      0,
    );
    const plannedSites = totalSites - connectedSites;
    const enabledSources = projectCards.reduce(
      (count, project) => count + project.enabledSources,
      0,
    );

    return {
      totalProjects: projectCards.length,
      totalSites,
      connectedSites,
      plannedSites,
      enabledSources,
      projectCards,
    };
  }
}
