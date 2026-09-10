import type {
  ProjectRepository,
  StoredProjectRecord,
  StoredSiteRecord,
} from "./ports/project-repository.ts";
import {
  hasPermission,
  type PrincipalContext,
} from "../../../platform/authorization/principal.ts";

export interface ProjectSiteSummary {
  siteId: string;
  projectId: string;
  organizationId: string;
  projectSlug: string;
  siteSlug: string;
  name: string;
  url: string;
  timezone: string;
  enabled: boolean;
  enabledSourceCount: number;
}

export interface ProjectTree {
  projectId: string;
  organizationId: string;
  projectSlug: string;
  name: string;
  status: "ACTIVE" | "PLANNED" | "DISABLED";
  sites: ProjectSiteSummary[];
}

export interface ProjectSummary {
  projectId: string;
  organizationId: string;
  projectSlug: string;
  name: string;
  status: "ACTIVE" | "PLANNED" | "DISABLED";
  totalSites: number;
  connectedSites: number;
  readySites: number;
  enabledSources: number;
}

function toProjectTree(project: StoredProjectRecord): ProjectTree {
  return {
    projectId: project.projectId,
    organizationId: project.organizationId,
    projectSlug: project.projectSlug,
    name: project.name,
    status: project.status,
    sites: project.sites.map((site) => ({
      siteId: site.siteId,
      projectId: site.projectId,
      organizationId: site.organizationId,
      projectSlug: site.projectSlug,
      siteSlug: site.siteSlug,
      name: site.name,
      url: site.url,
      timezone: site.timezone,
      enabled: site.enabled,
      enabledSourceCount: site.enabledSourceCount,
    })),
  };
}

function toProjectSummary(project: ProjectTree): ProjectSummary {
  return {
    projectId: project.projectId,
    organizationId: project.organizationId,
    projectSlug: project.projectSlug,
    name: project.name,
    status: project.status,
    totalSites: project.sites.length,
    connectedSites: project.sites.filter((site) => site.enabled).length,
    readySites: project.sites.filter((site) => site.enabled && site.enabledSourceCount >= 2).length,
    enabledSources: project.sites.reduce((count, site) => count + site.enabledSourceCount, 0),
  };
}

export class ProjectService {
  constructor(private readonly projectRepository: ProjectRepository) {}

  private getAccessScope(principal: PrincipalContext) {
    if (hasPermission(principal, "project:read:any")) {
      return { organizationIds: null };
    }
    if (
      principal.kind === "tenant-user" &&
      hasPermission(principal, "project:read:organization")
    ) {
      return { organizationIds: [principal.organizationId] };
    }

    return { organizationIds: [] };
  }

  async listProjectTreesForUser(user: PrincipalContext): Promise<ProjectTree[]> {
    const scope = this.getAccessScope(user);
    const projects = await this.projectRepository.listProjects(scope);
    return projects.map(toProjectTree);
  }

  async listProjectsForUser(user: PrincipalContext): Promise<ProjectSummary[]> {
    const projects = await this.listProjectTreesForUser(user);
    return projects.map(toProjectSummary);
  }

  async getProjectTreeForUser(
    user: PrincipalContext,
    projectSlug: string,
  ): Promise<ProjectTree | null> {
    const project = await this.getProjectAccessForUser(user, projectSlug);
    return project ? toProjectTree(project) : null;
  }

  async getProjectAccessForUser(
    user: PrincipalContext,
    projectSlug: string,
  ): Promise<StoredProjectRecord | null> {
    const scope = this.getAccessScope(user);
    return this.projectRepository.findProjectBySlug(projectSlug, scope);
  }

  async getSiteAccessForUser(
    user: PrincipalContext,
    projectSlug: string,
    siteSlug: string,
  ): Promise<StoredSiteRecord | null> {
    const scope = this.getAccessScope(user);
    return this.projectRepository.findSiteBySlugs(projectSlug, siteSlug, scope);
  }

  async getSiteBySlugs(projectSlug: string, siteSlug: string): Promise<StoredSiteRecord | null> {
    return this.projectRepository.findSiteBySlugs(projectSlug, siteSlug, {
      organizationIds: null,
    });
  }
}
