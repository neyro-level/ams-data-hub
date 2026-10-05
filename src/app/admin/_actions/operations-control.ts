"use server";

import {
  type FreezeJobsInput,
  type RequestOperationalActionInput,
  type UnfreezeJobsInput,
} from "../../../modules/operations-control/index.ts";
import { requestOperationalAction } from "../../../modules/operations-control/server.ts";
import { freezeMutatingJobs, unfreezeMutatingJobs } from "../../../modules/platform-operations/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const requestOperationalActionAction = platformAdminAction<
  RequestOperationalActionInput,
  Awaited<ReturnType<typeof requestOperationalAction>>
>("fleet", requestOperationalAction);

export const freezeJobsAction = platformAdminAction<
  FreezeJobsInput,
  Awaited<ReturnType<typeof freezeMutatingJobs>>
>("fleet", freezeMutatingJobs);

export const unfreezeJobsAction = platformAdminAction<
  UnfreezeJobsInput,
  Awaited<ReturnType<typeof unfreezeMutatingJobs>>
>("fleet", unfreezeMutatingJobs);
