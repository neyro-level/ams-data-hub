"use server";

import type {
  CreateMembershipInput,
  CreateOrganizationInput,
  RemoveMembershipInput,
  UpdateMembershipInput,
  UpdateOrganizationInput,
  ProvisionClientInput,
  ResetUserPasswordInput,
  SetUserEnabledInput,
} from "../../../modules/identity-access/contracts.ts";
import {
  createMembership,
  createOrganization,
  removeMembership,
  updateMembership,
  updateOrganization,
  provisionClient,
  resetUserPassword,
  setUserEnabled,
} from "../../../modules/identity-access/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

export const createOrganizationAction = platformAdminAction<CreateOrganizationInput, Awaited<ReturnType<typeof createOrganization>>>("organizations", createOrganization);
export const updateOrganizationAction = platformAdminAction<UpdateOrganizationInput, Awaited<ReturnType<typeof updateOrganization>>>("organizations", updateOrganization);
export const createMembershipAction = platformAdminAction<CreateMembershipInput, Awaited<ReturnType<typeof createMembership>>>("memberships", createMembership);
export const updateMembershipAction = platformAdminAction<UpdateMembershipInput, Awaited<ReturnType<typeof updateMembership>>>("memberships", updateMembership);
export const removeMembershipAction = platformAdminAction<RemoveMembershipInput, Awaited<ReturnType<typeof removeMembership>>>("memberships", removeMembership);
export const provisionClientAction = platformAdminAction<ProvisionClientInput, Awaited<ReturnType<typeof provisionClient>>>("memberships", provisionClient);
export const resetUserPasswordAction = platformAdminAction<ResetUserPasswordInput, Awaited<ReturnType<typeof resetUserPassword>>>("memberships", resetUserPassword);
export const setUserEnabledAction = platformAdminAction<SetUserEnabledInput, Awaited<ReturnType<typeof setUserEnabled>>>("memberships", setUserEnabled);
