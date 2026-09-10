import { hasPermission, type PrincipalContext } from "../../../platform/authorization/principal.ts";
import type {
  ProjectActionRecord,
  ProjectReferenceRepository,
} from "./ports/project-reference-repository.ts";
import { ProjectError } from "../domain/project.ts";

export interface ProjectManagementScope {
  organizationId: string;
  actorId: string;
  correlationId: string;
}

export function requireProjectManagementScope(
  principal: PrincipalContext,
  organizationId: string,
): ProjectManagementScope {
  if (!hasPermission(principal, "project:manage:any")) {
    throw new ProjectError("PROJECT_ACCESS_DENIED");
  }
  if (principal.kind === "platform-admin") {
    return {
      organizationId,
      actorId: principal.userId,
      correlationId: principal.correlationId,
    };
  }
  if (principal.kind === "tenant-user" && principal.organizationId === organizationId) {
    return {
      organizationId,
      actorId: principal.userId,
      correlationId: principal.correlationId,
    };
  }
  throw new ProjectError("PROJECT_ACCESS_DENIED");
}

export async function requireProjectForAction(
  principal: PrincipalContext,
  organizationId: string,
  projectId: string,
  repository: ProjectReferenceRepository,
): Promise<{ scope: ProjectManagementScope; project: ProjectActionRecord }> {
  const scope = requireProjectManagementScope(principal, organizationId);
  const project = await repository.findForAction(projectId);
  if (!project) {
    throw new ProjectError("PROJECT_NOT_FOUND_OR_FORBIDDEN");
  }
  return { scope, project };
}
