"use server";

import type {
  CreateProjectInput,
  UpdateProjectInput,
} from "../../../modules/project-registry/index.ts";
import {
  createProject,
  updateProject,
} from "../../../modules/project-registry/server.ts";
import type { ReplaceProjectPublicContactInput } from "../../../modules/project-state/index.ts";
import { projectPublicContactCommands } from "../../../modules/project-state/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const createProjectAction = platformAdminAction<CreateProjectInput, Awaited<ReturnType<typeof createProject>>>("projects", createProject);
export const updateProjectAction = platformAdminAction<UpdateProjectInput, Awaited<ReturnType<typeof updateProject>>>("projects", updateProject);
export const replaceProjectPublicContactAction = platformAdminAction<
  ReplaceProjectPublicContactInput,
  Awaited<ReturnType<typeof projectPublicContactCommands.replaceProjectPublicContact>>
>("projects", projectPublicContactCommands.replaceProjectPublicContact);
