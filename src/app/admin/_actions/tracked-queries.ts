"use server";

import type { CreateTrackedQuerySetInput, UpdateTrackedQuerySetInput } from "../../../modules/project-registry/contracts.ts";
import { saveTrackedQuerySet } from "../../../modules/project-registry/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const createTrackedQuerySetAction = platformAdminAction<CreateTrackedQuerySetInput, Awaited<ReturnType<typeof saveTrackedQuerySet>>>("tracked-queries", saveTrackedQuerySet);
export const updateTrackedQuerySetAction = platformAdminAction<UpdateTrackedQuerySetInput, Awaited<ReturnType<typeof saveTrackedQuerySet>>>("tracked-queries", saveTrackedQuerySet);
