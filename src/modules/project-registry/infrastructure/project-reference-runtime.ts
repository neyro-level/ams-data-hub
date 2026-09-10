import { getPrismaClient } from "../../../platform/database/prisma/client.ts";
import type { ScopedDb } from "../../../platform/database/scoped-db.ts";
import { createProjectCommands } from "../application/project-commands.ts";
import { createProjectQueries } from "../application/project-queries.ts";
import type { ProjectReadScope } from "../application/ports/project-query-repository.ts";
import { PrismaProjectQueryRepository } from "./prisma-project-query-repository.ts";
import { PrismaProjectReferenceRepository } from "./prisma-project-reference-repository.ts";

const commands = createProjectCommands({
  createRepository(scopedDb: ScopedDb) {
    return new PrismaProjectReferenceRepository(scopedDb);
  },
});

const queries = createProjectQueries({
  createRepository(scope: ProjectReadScope) {
    return new PrismaProjectQueryRepository(getPrismaClient(), scope);
  },
});

export const {
  changeProjectStatus,
  createProject,
  updateProjectSettings,
} = commands;
export const {
  getProject,
  getProjectFormOptions,
  getProjectSummary,
  listProjects,
} = queries;
