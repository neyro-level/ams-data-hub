export interface StoredSiteRecord {
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

export interface StoredProjectRecord {
  projectId: string;
  organizationId: string;
  projectSlug: string;
  name: string;
  status: "ACTIVE" | "PLANNED" | "DISABLED";
  sites: StoredSiteRecord[];
}

export interface ProjectAccessScope {
  organizationIds: string[] | null;
}

export interface ProjectRepository {
  listProjects(scope: ProjectAccessScope): Promise<StoredProjectRecord[]>;
  findProjectBySlug(
    projectSlug: string,
    scope: ProjectAccessScope,
  ): Promise<StoredProjectRecord | null>;
  findSiteBySlugs(
    projectSlug: string,
    siteSlug: string,
    scope: ProjectAccessScope,
  ): Promise<StoredSiteRecord | null>;
}
