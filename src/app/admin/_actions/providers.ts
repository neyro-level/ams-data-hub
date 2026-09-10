"use server";

import type { CreateProviderConnectionInput, UpdateProviderConnectionInput } from "../../../modules/project-registry/contracts.ts";
import { saveProviderConnection } from "../../../modules/project-registry/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const createProviderConnectionAction = platformAdminAction<CreateProviderConnectionInput, Awaited<ReturnType<typeof saveProviderConnection>>>("providers", saveProviderConnection);
export const updateProviderConnectionAction = platformAdminAction<UpdateProviderConnectionInput, Awaited<ReturnType<typeof saveProviderConnection>>>("providers", saveProviderConnection);
