"use server";

import type { CreateGoalDefinitionInput, UpdateGoalDefinitionInput } from "../../../modules/project-registry/contracts.ts";
import { saveGoalDefinition } from "../../../modules/project-registry/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const createGoalDefinitionAction = platformAdminAction<CreateGoalDefinitionInput, Awaited<ReturnType<typeof saveGoalDefinition>>>("goals", saveGoalDefinition);
export const updateGoalDefinitionAction = platformAdminAction<UpdateGoalDefinitionInput, Awaited<ReturnType<typeof saveGoalDefinition>>>("goals", saveGoalDefinition);
