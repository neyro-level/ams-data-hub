"use server";

import type {
  CreateBuildingInput,
  CreateBuildingsBatchInput,
  CreateDeveloperInput,
  CreateDevelopmentInput,
  UpdateBuildingInput,
  UpdateDeveloperInput,
  UpdateDevelopmentInput,
} from "../../../modules/shared-catalog/contracts.ts";
import { sharedCatalogCommands } from "../../../modules/shared-catalog/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const createCatalogDeveloperAction = platformAdminAction<CreateDeveloperInput, Awaited<ReturnType<typeof sharedCatalogCommands.createDeveloper>>>("catalog", sharedCatalogCommands.createDeveloper);
export const updateCatalogDeveloperAction = platformAdminAction<UpdateDeveloperInput, Awaited<ReturnType<typeof sharedCatalogCommands.updateDeveloper>>>("catalog", sharedCatalogCommands.updateDeveloper);
export const createCatalogDevelopmentAction = platformAdminAction<CreateDevelopmentInput, Awaited<ReturnType<typeof sharedCatalogCommands.createDevelopment>>>("catalog", sharedCatalogCommands.createDevelopment);
export const updateCatalogDevelopmentAction = platformAdminAction<UpdateDevelopmentInput, Awaited<ReturnType<typeof sharedCatalogCommands.updateDevelopment>>>("catalog", sharedCatalogCommands.updateDevelopment);
export const createCatalogBuildingAction = platformAdminAction<CreateBuildingInput, Awaited<ReturnType<typeof sharedCatalogCommands.createBuilding>>>("catalog", sharedCatalogCommands.createBuilding);
export const updateCatalogBuildingAction = platformAdminAction<UpdateBuildingInput, Awaited<ReturnType<typeof sharedCatalogCommands.updateBuilding>>>("catalog", sharedCatalogCommands.updateBuilding);
export const createCatalogBuildingsBatchAction = platformAdminAction<CreateBuildingsBatchInput, Awaited<ReturnType<typeof sharedCatalogCommands.createBuildingsBatch>>>("catalog", sharedCatalogCommands.createBuildingsBatch);
