import "server-only";

import { createProjectPublicContactCommands } from "./application/project-public-contact-commands.ts";
import { getProjectPublicContact, listProjectPublicContactsForAdmin } from "./application/project-public-contact-queries.ts";
import { ProjectStateError } from "./domain/project-state-error.ts";
import { PrismaProjectPublicContactRepository } from "./infrastructure/prisma-project-public-contact-repository.ts";
import { createEntityEditorialCommands } from "./application/entity-editorial-commands.ts";
import { listProjectEditorialPublic } from "./application/entity-editorial-queries.ts";
import { PrismaEntityEditorialRepository } from "./infrastructure/prisma-entity-editorial-repository.ts";
import { createProjectUrlRegistryCommands } from "./application/project-url-registry-commands.ts";
import { createProjectUrlRegistryQueries } from "./application/project-url-registry-queries.ts";
import { PrismaProjectUrlRegistryRepository } from "./infrastructure/prisma-project-url-registry-repository.ts";
import { createListingDevelopmentLinkCommands } from "./application/listing-development-link-commands.ts";
import { PrismaListingDevelopmentLinkRepository } from "./infrastructure/prisma-listing-development-link-repository.ts";
import { createAgentCommands } from "./application/agent-commands.ts";
import { createAgentQueries } from "./application/agent-queries.ts";
import { PrismaAgentRepository } from "./infrastructure/prisma-agent-repository.ts";
import { createFeedAgentMatchingCommands } from "./application/feed-agent-matching.ts";
import { PrismaAgentMatchingRepository } from "./infrastructure/prisma-agent-matching-repository.ts";

export const projectPublicContactCommands = createProjectPublicContactCommands({
  createRepository: (transaction) => new PrismaProjectPublicContactRepository(transaction),
});

export const entityEditorialCommands = createEntityEditorialCommands({
  createRepository: (transaction) => new PrismaEntityEditorialRepository(transaction),
});

export const projectUrlRegistryCommands = createProjectUrlRegistryCommands({
  createRepository: (transaction) => new PrismaProjectUrlRegistryRepository(transaction),
});

export const { getProjectUrlRegistry } = createProjectUrlRegistryQueries({
  createRepository: (transaction) => new PrismaProjectUrlRegistryRepository(transaction),
});

export const listingDevelopmentLinkCommands = createListingDevelopmentLinkCommands({
  createRepository: (transaction) => new PrismaListingDevelopmentLinkRepository(transaction),
});

export const agentCommands = createAgentCommands({
  createRepository: (transaction) => new PrismaAgentRepository(transaction),
});

export const listAgentsForAdmin = createAgentQueries({
  createRepository: (transaction) => new PrismaAgentRepository(transaction),
});

export const feedAgentMatchingCommands = createFeedAgentMatchingCommands({
  createRepository: (transaction) => new PrismaAgentMatchingRepository(transaction),
});

export { getProjectPublicContact, listProjectPublicContactsForAdmin, listProjectEditorialPublic, ProjectStateError };
