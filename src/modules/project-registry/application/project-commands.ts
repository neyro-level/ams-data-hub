import { defineCommand } from "../../../platform/commands/define-command.ts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createScopedDb, type ScopedDb } from "../../../platform/database/scoped-db.ts";
import {
  changeProjectStatusInputSchema,
  createProjectInputSchema,
  nextProjectVersion,
  ProjectError,
  updateProjectSettingsInputSchema,
} from "../domain/project.ts";
import {
  requireProjectForAction,
  requireProjectManagementScope,
} from "./project-authorization.ts";
import type { ProjectReferenceRepository } from "./ports/project-reference-repository.ts";

export interface ProjectCommandResult {
  projectId: string;
  version: number;
}

export interface ProjectCommandDependencies {
  createRepository(scopedDb: ScopedDb): ProjectReferenceRepository;
}

export function createProjectCommands(dependencies: ProjectCommandDependencies) {
  const createProject = defineCommand<
    PrincipalContext,
    typeof createProjectInputSchema,
    ProjectCommandResult
  >({
    name: "createProject",
    input: createProjectInputSchema,
    authorize: (principal, input) => {
      requireProjectManagementScope(principal, input.organizationId);
    },
    execute: async ({ principal, input, transaction }) => {
      const scope = requireProjectManagementScope(principal, input.organizationId);
      const repository = dependencies.createRepository(
        createScopedDb({ organizationId: scope.organizationId }, transaction),
      );
      const project = await repository.create(input);
      await repository.appendAudit({
        actorId: scope.actorId,
        action: "project.create",
        projectId: project.id,
        beforeMarker: null,
        afterMarker: {
          name: input.name,
          slug: input.slug,
          status: input.status,
          version: project.version,
        },
        correlationId: scope.correlationId,
      });
      return { projectId: project.id, version: project.version };
    },
  });

  const changeProjectStatus = defineCommand<
    PrincipalContext,
    typeof changeProjectStatusInputSchema,
    ProjectCommandResult
  >({
    name: "changeProjectStatus",
    input: changeProjectStatusInputSchema,
    authorize: (principal, input) => {
      requireProjectManagementScope(principal, input.organizationId);
    },
    execute: async ({ principal, input, transaction }) => {
      const repository = dependencies.createRepository(
        createScopedDb({ organizationId: input.organizationId }, transaction),
      );
      const { scope, project } = await requireProjectForAction(
        principal,
        input.organizationId,
        input.projectId,
        repository,
      );
      if (project.version !== input.version) throw new ProjectError("PROJECT_STALE");

      const updated = await repository.updateStatus({
        projectId: input.projectId,
        expectedVersion: input.version,
        status: input.status,
      });
      if (!updated) throw new ProjectError("PROJECT_STALE");

      const version = nextProjectVersion(input.version);
      await repository.appendAudit({
        actorId: scope.actorId,
        action: "project.change-status",
        projectId: input.projectId,
        beforeMarker: { status: project.status, version: input.version },
        afterMarker: { status: input.status, version },
        correlationId: scope.correlationId,
      });
      return { projectId: input.projectId, version };
    },
  });

  const updateProjectSettings = defineCommand<
    PrincipalContext,
    typeof updateProjectSettingsInputSchema,
    ProjectCommandResult
  >({
    name: "updateProjectSettings",
    input: updateProjectSettingsInputSchema,
    authorize: (principal, input) => {
      requireProjectManagementScope(principal, input.organizationId);
    },
    execute: async ({ principal, input, transaction }) => {
      const repository = dependencies.createRepository(
        createScopedDb({ organizationId: input.organizationId }, transaction),
      );
      const { scope, project } = await requireProjectForAction(
        principal,
        input.organizationId,
        input.projectId,
        repository,
      );
      if (project.version !== input.version) throw new ProjectError("PROJECT_STALE");

      const updated = await repository.updateSettings(input);
      if (!updated) throw new ProjectError("PROJECT_STALE");

      const version = nextProjectVersion(input.version);
      await repository.appendAudit({
        actorId: scope.actorId,
        action: "project.update-settings",
        projectId: input.projectId,
        beforeMarker: {
          name: project.name,
          thresholdProfileId: project.thresholdProfileId,
          clusterProfileId: project.clusterProfileId,
          version: input.version,
        },
        afterMarker: {
          name: input.name,
          thresholdProfileId: input.thresholdProfileId,
          clusterProfileId: input.clusterProfileId,
          version,
        },
        correlationId: scope.correlationId,
      });
      return { projectId: input.projectId, version };
    },
  });

  return { createProject, changeProjectStatus, updateProjectSettings };
}
