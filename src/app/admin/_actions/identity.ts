"use server";

import type {
  CreateMembershipInput,
  CreateOrganizationInput,
  CreateUserInput,
  RemoveMembershipInput,
  UpdateMembershipInput,
  UpdateOrganizationInput,
  ResetUserPasswordInput,
  SetUserEnabledInput,
} from "../../../modules/identity-access/contracts.ts";
import {
  createMembership,
  createOrganization,
  createUser,
  removeMembership,
  updateMembership,
  updateOrganization,
  resetUserPassword,
  setUserEnabled,
} from "../../../modules/identity-access/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const createOrganizationAction = platformAdminAction<CreateOrganizationInput, Awaited<ReturnType<typeof createOrganization>>>("organizations", createOrganization);
export const updateOrganizationAction = platformAdminAction<UpdateOrganizationInput, Awaited<ReturnType<typeof updateOrganization>>>("organizations", updateOrganization);
export const createMembershipAction = platformAdminAction<CreateMembershipInput, Awaited<ReturnType<typeof createMembership>>>("memberships", createMembership);
export const updateMembershipAction = platformAdminAction<UpdateMembershipInput, Awaited<ReturnType<typeof updateMembership>>>("memberships", updateMembership);
export const removeMembershipAction = platformAdminAction<RemoveMembershipInput, Awaited<ReturnType<typeof removeMembership>>>("memberships", removeMembership);
export const createUserAction = platformAdminAction<CreateUserInput, Awaited<ReturnType<typeof createUser>>>("memberships", createUser);
export const resetUserPasswordAction = platformAdminAction<ResetUserPasswordInput, Awaited<ReturnType<typeof resetUserPassword>>>("memberships", resetUserPassword);
export const setUserEnabledAction = platformAdminAction<SetUserEnabledInput, Awaited<ReturnType<typeof setUserEnabled>>>("memberships", setUserEnabled);
