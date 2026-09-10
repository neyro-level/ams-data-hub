"use server";

import { searchTopvisorRegions } from "../../../modules/project-registry/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const searchTopvisorRegionsAction = platformAdminAction<{ search: string }, Awaited<ReturnType<typeof searchTopvisorRegions>>>(
  "memberships",
  searchTopvisorRegions,
);
