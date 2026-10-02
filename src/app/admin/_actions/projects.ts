"use server";

import type {
  CreateProjectInput,
  UpdateProjectInput,
} from "../../../modules/project-registry/index.ts";
import {
  createProject,
  updateProject,
} from "../../../modules/project-registry/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const createProjectAction = platformAdminAction<CreateProjectInput, Awaited<ReturnType<typeof createProject>>>("projects", createProject);
export const updateProjectAction = platformAdminAction<UpdateProjectInput, Awaited<ReturnType<typeof updateProject>>>("projects", updateProject);
