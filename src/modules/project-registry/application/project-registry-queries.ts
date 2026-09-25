import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import {
  runInPrincipalDatabaseTransaction,
  type DatabaseTransaction,
} from "../../../platform/database/transaction.ts";
import type { ProjectListQuery } from "../contracts.ts";
import type { ProjectRegistryRepository } from "./ports/project-registry-repository.ts";
import { requireProjectRegistryAdmin } from "./project-registry-authorization.ts";

export interface ProjectRegistryQueryDependencies {
  createRepository(transaction: DatabaseTransaction): ProjectRegistryRepository;
}

export function createProjectRegistryQueries(
  dependencies: ProjectRegistryQueryDependencies,
) {
  const withRepository = <TResult>(
    principal: PrincipalContext,
    execute: (repository: ProjectRegistryRepository) => Promise<TResult>,
  ) => runInPrincipalDatabaseTransaction(principal, (transaction) =>
    execute(dependencies.createRepository(transaction)));

  return {
    listProjects(principal: PrincipalContext, query: ProjectListQuery) {
      requireProjectRegistryAdmin(principal);
      return withRepository(principal, (repository) => repository.listProjects(query));
    },
    getProjectRegistryFormOptions(principal: PrincipalContext) {
      requireProjectRegistryAdmin(principal);
      return withRepository(principal, (repository) => repository.listFormOptions());
    },
    listProjectTreesForUser(principal: PrincipalContext) {
      if (
        principal.kind !== "platform-admin"
        && principal.kind !== "platform-staff"
        && principal.kind !== "tenant-user"
      ) {
        return Promise.resolve([]);
      }
      return withRepository(principal, (repository) => repository.listProjectTrees());
    },
  };
}
