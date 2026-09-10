"use server";

import type { CreateThresholdProfileInput, UpdateThresholdProfileInput } from "../../../modules/project-registry/contracts.ts";
import { saveThresholdProfile } from "../../../modules/project-registry/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const createThresholdProfileAction = platformAdminAction<CreateThresholdProfileInput, Awaited<ReturnType<typeof saveThresholdProfile>>>("profiles", saveThresholdProfile);
export const updateThresholdProfileAction = platformAdminAction<UpdateThresholdProfileInput, Awaited<ReturnType<typeof saveThresholdProfile>>>("profiles", saveThresholdProfile);
