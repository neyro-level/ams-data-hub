import "server-only";

import { createSourceRegistryCommands } from "./application/source-registry-commands.ts";
import { createSourceRegistryQueries } from "./application/source-registry-queries.ts";
import { adapterProfileRegistry } from "./domain/adapter-profile-registry.ts";
import { PrismaSourceRegistryRepository } from "./infrastructure/prisma-source-registry-repository.ts";

export const sourceRegistryCommands = createSourceRegistryCommands({
  createRepository: (transaction) => new PrismaSourceRegistryRepository(transaction),
  adapterProfileRegistry,
});

export const { listSourcesForAdmin, getSourceAdminData } = createSourceRegistryQueries({
  createRepository: (transaction) => new PrismaSourceRegistryRepository(transaction),
});

export { SourceRegistryError } from "./domain/source-registry-error.ts";
export { adapterProfileRegistry } from "./domain/adapter-profile-registry.ts";
