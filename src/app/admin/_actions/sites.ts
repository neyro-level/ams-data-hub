"use server";

import type { CreateSiteInput, UpdateSiteInput } from "../../../modules/project-registry/contracts.ts";
import { saveSite } from "../../../modules/project-registry/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const createSiteAction = platformAdminAction<CreateSiteInput, Awaited<ReturnType<typeof saveSite>>>("sites", saveSite);
export const updateSiteAction = platformAdminAction<UpdateSiteInput, Awaited<ReturnType<typeof saveSite>>>("sites", saveSite);
