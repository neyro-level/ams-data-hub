"use server";

import type { RequestMaintenanceInput } from "../../../modules/platform-operations/contracts.ts";
import { requestMaintenance } from "../../../modules/platform-operations/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const requestMaintenanceAction = platformAdminAction<RequestMaintenanceInput, Awaited<ReturnType<typeof requestMaintenance>>>("operations", requestMaintenance);
