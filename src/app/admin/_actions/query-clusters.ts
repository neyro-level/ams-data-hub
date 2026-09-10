"use server";

import type { CreateQueryClusterProfileInput, UpdateQueryClusterProfileInput } from "../../../modules/project-registry/contracts.ts";
import { saveQueryClusterProfile } from "../../../modules/project-registry/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const createQueryClusterProfileAction = platformAdminAction<CreateQueryClusterProfileInput, Awaited<ReturnType<typeof saveQueryClusterProfile>>>("profiles", saveQueryClusterProfile);
export const updateQueryClusterProfileAction = platformAdminAction<UpdateQueryClusterProfileInput, Awaited<ReturnType<typeof saveQueryClusterProfile>>>("profiles", saveQueryClusterProfile);
