import "server-only";

import type { DatabaseTransaction } from "../../platform/database/transaction.ts";
import { createProjectRegistryCommands } from "./application/project-registry-commands.ts";
import { createProjectRegistryQueries } from "./application/project-registry-queries.ts";
import { PrismaProjectRegistryRepository } from "./infrastructure/prisma-project-registry-repository.ts";

function createRepository(transaction: DatabaseTransaction) {
  return new PrismaProjectRegistryRepository(transaction);
}

const commands = createProjectRegistryCommands({ createRepository });
const queries = createProjectRegistryQueries({ createRepository });

export const { createProject, updateProject } = commands;
export const {
  getProjectRegistryFormOptions,
  listProjects,
  listProjectTreesForUser,
} = queries;
