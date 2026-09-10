"use server";

import type { ConfirmMetricaGoalsInput } from "../../../modules/project-registry/contracts.ts";
import { confirmMetricaGoals } from "../../../modules/project-registry/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const confirmMetricaGoalsAction = platformAdminAction<ConfirmMetricaGoalsInput, Awaited<ReturnType<typeof confirmMetricaGoals>>>("providers", confirmMetricaGoals);
