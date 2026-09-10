import { z } from "zod";
import { hasPermission, type PrincipalContext } from "../../../platform/authorization/principal.ts";
import { projectStatusSchema, ProjectError } from "../domain/project.ts";
import type {
  ProjectListQuery,
  ProjectQueryRepository,
  ProjectReadScope,
} from "./ports/project-query-repository.ts";

export const projectListQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(""),
  status: projectStatusSchema.nullable().default(null),
  sort: z.enum(["name", "status", "updatedAt"]).default("updatedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

export interface ProjectQueryDependencies {
  createRepository(scope: ProjectReadScope): ProjectQueryRepository;
}

function getProjectReadScope(principal: PrincipalContext): ProjectReadScope {
  if (hasPermission(principal, "project:read:any")) return { kind: "platform" };
  if (
    principal.kind === "tenant-user" &&
    hasPermission(principal, "project:read:organization")
  ) {
    return { kind: "tenant", organizationId: principal.organizationId };
  }
  throw new ProjectError("PROJECT_ACCESS_DENIED");
}

function getProjectManagementReadScope(principal: PrincipalContext): ProjectReadScope {
  if (!hasPermission(principal, "project:manage:any")) {
    throw new ProjectError("PROJECT_ACCESS_DENIED");
  }
  if (principal.kind === "platform-admin") return { kind: "platform" };
  if (principal.kind === "tenant-user") {
    return { kind: "tenant", organizationId: principal.organizationId };
  }
  throw new ProjectError("PROJECT_ACCESS_DENIED");
}

export function createProjectQueries(dependencies: ProjectQueryDependencies) {
  async function listProjects(
    principal: PrincipalContext,
    rawQuery: Partial<ProjectListQuery>,
  ) {
    const query = projectListQuerySchema.parse(rawQuery);
    return dependencies.createRepository(getProjectReadScope(principal)).list(query);
  }

  async function getProject(principal: PrincipalContext, projectId: string) {
    return dependencies.createRepository(getProjectReadScope(principal)).findById(projectId);
  }

  async function getProjectSummary(principal: PrincipalContext, projectId: string) {
    const repository = dependencies.createRepository(getProjectReadScope(principal));
    const project = await repository.findById(projectId);
    if (!project) return null;
    const siteCount = await repository.countSites(projectId);
    return { ...project, siteCount };
  }

  async function getProjectFormOptions(principal: PrincipalContext) {
    return dependencies
      .createRepository(getProjectManagementReadScope(principal))
      .listFormOptions();
  }

  return { listProjects, getProject, getProjectSummary, getProjectFormOptions };
}

export type { ProjectListQuery } from "./ports/project-query-repository.ts";
export type {
  ProjectFormOptions,
  ProjectListItem,
  ProjectListResult,
} from "./ports/project-query-repository.ts";
