import { describe, expect, it } from "vitest";
import { ProjectService } from "../src/modules/project-registry/index.ts";
import type {
  ProjectAccessScope,
  ProjectRepository,
  StoredProjectRecord,
  StoredSiteRecord,
} from "../src/modules/project-registry/index.ts";
import {
  createDeniedJobPrincipal,
  createPlatformAdminPrincipal,
  createPlatformAnalystPrincipal,
  createTenantUserPrincipal,
} from "./helpers/principal.ts";

const analystUser = createPlatformAnalystPrincipal("analyst-1");

const alphaViewer = createTenantUserPrincipal({
  userId: "viewer-1",
  membershipId: "membership-alpha",
  organizationId: "org-alpha",
});

const platformAdmin = createPlatformAdminPrincipal();

const deniedPrincipal = createDeniedJobPrincipal("org-alpha");

const projects: StoredProjectRecord[] = [
  {
    projectId: "project-alpha",
    organizationId: "org-alpha",
    projectSlug: "alpha",
    name: "Альфа",
    status: "ACTIVE",
    sites: [
      {
        siteId: "site-north",
        projectId: "project-alpha",
        organizationId: "org-alpha",
        projectSlug: "alpha",
        siteSlug: "north",
        name: "Север",
        url: "https://alpha.example.test",
        timezone: "+03:00",
        enabled: true,
        enabledSourceCount: 2,
      },
      {
        siteId: "site-east",
        projectId: "project-alpha",
        organizationId: "org-alpha",
        projectSlug: "alpha",
        siteSlug: "east",
        name: "Восток",
        url: "https://east.example.test",
        timezone: "+03:00",
        enabled: true,
        enabledSourceCount: 2,
      },
    ],
  },
  {
    projectId: "project-west",
    organizationId: "org-west",
    projectSlug: "beta",
    name: "Бета",
    status: "PLANNED",
    sites: [
      {
        siteId: "site-west",
        projectId: "project-west",
        organizationId: "org-west",
        projectSlug: "beta",
        siteSlug: "west",
        name: "Запад",
        url: "https://todo.invalid/west",
        timezone: "+03:00",
        enabled: false,
        enabledSourceCount: 0,
      },
    ],
  },
];

class FakeProjectRepository implements ProjectRepository {
  async listProjects(scope: ProjectAccessScope): Promise<StoredProjectRecord[]> {
    return scope.organizationIds === null
      ? projects
      : projects.filter((project) => scope.organizationIds!.includes(project.organizationId));
  }

  async findProjectBySlug(
    projectSlug: string,
    scope: ProjectAccessScope,
  ): Promise<StoredProjectRecord | null> {
    return (
      (await this.listProjects(scope)).find((project) => project.projectSlug === projectSlug) ?? null
    );
  }

  async findSiteBySlugs(
    projectSlug: string,
    siteSlug: string,
    scope: ProjectAccessScope,
  ): Promise<StoredSiteRecord | null> {
    const project = await this.findProjectBySlug(projectSlug, scope);
    return project?.sites.find((site) => site.siteSlug === siteSlug) ?? null;
  }
}

describe("ProjectService", () => {
  const projectService = new ProjectService(new FakeProjectRepository());

  it("shows every project to analyst", async () => {
    expect(await projectService.listProjectsForUser(analystUser)).toHaveLength(2);
  });

  it("allows platform admin through capabilities rather than analyst role equality", async () => {
    expect(await projectService.listProjectsForUser(platformAdmin)).toHaveLength(2);
  });

  it("limits client viewer to own organization", async () => {
    const visibleProjects = await projectService.listProjectsForUser(alphaViewer);
    expect(visibleProjects).toHaveLength(1);
    expect(visibleProjects[0]?.projectSlug).toBe("alpha");
  });

  it("denies a principal without project read capability", async () => {
    expect(await projectService.listProjectsForUser(deniedPrincipal)).toEqual([]);
  });

  it("returns site access only inside allowed organization", async () => {
    expect(
      await projectService.getSiteAccessForUser(alphaViewer, "alpha", "north"),
    ).not.toBeNull();
    expect(
      await projectService.getSiteAccessForUser(alphaViewer, "beta", "west"),
    ).toBeNull();
  });
});
