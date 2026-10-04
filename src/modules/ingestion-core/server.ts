import "server-only";

import { createSourceRegistryCommands } from "./application/source-registry-commands.ts";
import { createSourceRegistryQueries } from "./application/source-registry-queries.ts";
import { PrismaSourceRegistryRepository } from "./infrastructure/prisma-source-registry-repository.ts";

export const sourceRegistryCommands = createSourceRegistryCommands({
  createRepository: (transaction) => new PrismaSourceRegistryRepository(transaction),
});

export const { listSourcesForAdmin, getSourceAdminData } = createSourceRegistryQueries({
  createRepository: (transaction) => new PrismaSourceRegistryRepository(transaction),
});

export { SourceRegistryError } from "./domain/source-registry-error.ts";
