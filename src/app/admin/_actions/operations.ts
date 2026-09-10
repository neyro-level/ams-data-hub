"use server";

import type { RequestProjectSyncInput } from "../../../modules/platform-operations/contracts.ts";
import { requestProjectSync } from "../../../modules/platform-operations/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const requestProjectSyncAction = platformAdminAction<RequestProjectSyncInput, Awaited<ReturnType<typeof requestProjectSync>>>("operations", requestProjectSync);
