import "server-only";

import { createProjectPublicContactCommands } from "./application/project-public-contact-commands.ts";
import { getProjectPublicContact, listProjectPublicContactsForAdmin } from "./application/project-public-contact-queries.ts";
import { ProjectStateError } from "./domain/project-state-error.ts";
import { PrismaProjectPublicContactRepository } from "./infrastructure/prisma-project-public-contact-repository.ts";

export const projectPublicContactCommands = createProjectPublicContactCommands({
  createRepository: (transaction) => new PrismaProjectPublicContactRepository(transaction),
});

export { getProjectPublicContact, listProjectPublicContactsForAdmin, ProjectStateError };
