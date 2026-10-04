"use server";

import type {
  CreateProjectInput,
  UpdateProjectInput,
} from "../../../modules/project-registry/index.ts";
import {
  createProject,
  updateProject,
} from "../../../modules/project-registry/server.ts";
import type { ConfirmAgentConsentBatchInput, SaveManualAgentInput, ReplaceProjectPublicContactInput } from "../../../modules/project-state/index.ts";
import { agentCommands, projectPublicContactCommands } from "../../../modules/project-state/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const createProjectAction = platformAdminAction<CreateProjectInput, Awaited<ReturnType<typeof createProject>>>("projects", createProject);
export const updateProjectAction = platformAdminAction<UpdateProjectInput, Awaited<ReturnType<typeof updateProject>>>("projects", updateProject);
export const replaceProjectPublicContactAction = platformAdminAction<
  ReplaceProjectPublicContactInput,
  Awaited<ReturnType<typeof projectPublicContactCommands.replaceProjectPublicContact>>
>("projects", projectPublicContactCommands.replaceProjectPublicContact);
export const saveManualAgentAction = platformAdminAction<
  SaveManualAgentInput,
  Awaited<ReturnType<typeof agentCommands.saveManualAgent>>
>("projects", agentCommands.saveManualAgent);
export const confirmAgentConsentBatchAction = platformAdminAction<
  ConfirmAgentConsentBatchInput,
  Awaited<ReturnType<typeof agentCommands.confirmAgentConsentBatch>>
>("projects", agentCommands.confirmAgentConsentBatch);
