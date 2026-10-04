"use server";

import type {
  CreateSourceInput,
  RequestManualSourceRunInput,
  SetSourceEnabledInput,
  UpdateSourceInput,
} from "../../../modules/ingestion-core/index.ts";
import { sourceRegistryCommands } from "../../../modules/ingestion-core/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const createSourceAction = platformAdminAction<CreateSourceInput, Awaited<ReturnType<typeof sourceRegistryCommands.createSource>>>("sources", sourceRegistryCommands.createSource);
export const updateSourceAction = platformAdminAction<UpdateSourceInput, Awaited<ReturnType<typeof sourceRegistryCommands.updateSource>>>("sources", sourceRegistryCommands.updateSource);
export const setSourceEnabledAction = platformAdminAction<SetSourceEnabledInput, Awaited<ReturnType<typeof sourceRegistryCommands.setSourceEnabled>>>("sources", sourceRegistryCommands.setSourceEnabled);
export const requestManualSourceRunAction = platformAdminAction<RequestManualSourceRunInput, Awaited<ReturnType<typeof sourceRegistryCommands.requestManualSourceRun>>>("sources", sourceRegistryCommands.requestManualSourceRun);
