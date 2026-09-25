import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { defineCommand } from "../../../platform/commands/define-command.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { createProjectInputSchema, updateProjectInputSchema } from "../contracts.ts";
import { ProjectRegistryError } from "../domain/project-registry-error.ts";
import type { ProjectRegistryRepository } from "./ports/project-registry-repository.ts";
import { requireProjectRegistryAdmin } from "./project-registry-authorization.ts";

export interface ProjectRegistryCommandDependencies {
  createRepository(transaction: DatabaseTransaction): ProjectRegistryRepository;
}

export function createProjectRegistryCommands(
  dependencies: ProjectRegistryCommandDependencies,
) {
  const createProject = defineCommand({
    name: "project-registry.project.create",
    input: createProjectInputSchema,
    authorize: (principal: PrincipalContext) => {
      requireProjectRegistryAdmin(principal);
    },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectRegistryAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const project = await repository.createProject(input);
      await repository.appendAudit({
        actorId: actor.userId,
        action: "project.create",
        entityId: project.id,
        organizationId: input.organizationId,
        beforeMarker: null,
        afterMarker: {
          name: input.name,
          slug: input.slug,
          status: input.status,
          version: project.version,
        },
        correlationId: actor.correlationId,
      });
      return { projectId: project.id, version: project.version };
    },
  });

  const updateProject = defineCommand({
    name: "project-registry.project.update",
    input: updateProjectInputSchema,
    authorize: (principal: PrincipalContext) => {
      requireProjectRegistryAdmin(principal);
    },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectRegistryAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const project = await repository.findProjectForAction(input.projectId);
      if (
        !project
        || project.version !== input.version
        || project.organizationId !== input.organizationId
      ) {
        throw new ProjectRegistryError("PROJECT_NOT_FOUND_OR_STALE");
      }
      if (!await repository.updateProject(input)) {
        throw new ProjectRegistryError("PROJECT_NOT_FOUND_OR_STALE");
      }
      const version = input.version + 1;
      await repository.appendAudit({
        actorId: actor.userId,
        action: "project.update",
        entityId: input.projectId,
        organizationId: input.organizationId,
        beforeMarker: {
          name: project.name,
          slug: project.slug,
          description: project.description,
          status: project.status,
          version: project.version,
        },
        afterMarker: {
          name: input.name,
          slug: input.slug,
          description: input.description || null,
          status: input.status,
          version,
        },
        correlationId: actor.correlationId,
      });
      return { projectId: input.projectId, version };
    },
  });

  return { createProject, updateProject };
}
