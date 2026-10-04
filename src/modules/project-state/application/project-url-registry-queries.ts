import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { runInProjectPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { projectPublicContactQuerySchema, type ProjectRedirectDto, type ProjectUrlEntryDto } from "../contracts.ts";
import type { ProjectUrlRegistryRepository } from "./ports/project-url-registry-repository.ts";
import { requireProjectContactReader } from "./project-state-authorization.ts";

export interface ProjectUrlRegistryDto {
  entries: ProjectUrlEntryDto[];
  redirects: ProjectRedirectDto[];
}

export function createProjectUrlRegistryQueries(dependencies: {
  createRepository(transaction: DatabaseTransaction): ProjectUrlRegistryRepository;
}) {
  return {
    async getProjectUrlRegistry(
      principal: PrincipalContext,
      rawQuery: { organizationId: string; projectId: string },
    ): Promise<ProjectUrlRegistryDto> {
      const query = projectPublicContactQuerySchema.parse(rawQuery);
      requireProjectContactReader(principal, query.organizationId);
      return runInProjectPrincipalDatabaseTransaction(principal, query.projectId, async (transaction) => {
        const repository = dependencies.createRepository(transaction);
        const [entries, redirects] = await Promise.all([
          repository.listEntries(query.organizationId, query.projectId),
          repository.listRedirects(query.organizationId, query.projectId),
        ]);
        return { entries, redirects };
      });
    },
  };
}
