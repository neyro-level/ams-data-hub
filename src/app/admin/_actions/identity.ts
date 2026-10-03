"use server";

import {
  IdentityAdminError,
} from "../../../modules/identity-access/contracts.ts";
import type {
  CreateMembershipInput,
  CreateOrganizationInput,
  CreateUserInput,
  RemoveMembershipInput,
  ResetUserPasswordInput,
  SetUserEnabledInput,
  UpdateMembershipInput,
  UpdateOrganizationInput,
} from "../../../modules/identity-access/contracts.ts";
import {
  createMembership,
  createOrganization,
  createUser,
  isClientAccessEnabled,
  removeMembership,
  updateMembership,
  updateOrganization,
  resetUserPassword,
  setUserEnabled,
} from "../../../modules/identity-access/server.ts";
import { platformAdminAction } from "./platform-admin-action.ts";

function requireClientAccess() {
  if (!isClientAccessEnabled()) {
    throw new IdentityAdminError("CLIENT_ACCESS_DISABLED");
  }
}

async function createClientMembership(principal: Parameters<typeof createMembership>[0], input: CreateMembershipInput) {
  requireClientAccess();
  return createMembership(principal, input);
}

async function updateClientMembership(principal: Parameters<typeof updateMembership>[0], input: UpdateMembershipInput) {
  requireClientAccess();
  return updateMembership(principal, input);
}

async function removeClientMembership(principal: Parameters<typeof removeMembership>[0], input: RemoveMembershipInput) {
  requireClientAccess();
  return removeMembership(principal, input);
}

async function createPlatformUser(principal: Parameters<typeof createUser>[0], input: CreateUserInput) {
  if (input.systemRole === "USER") requireClientAccess();
  return createUser(principal, input);
}

export const createOrganizationAction = platformAdminAction<CreateOrganizationInput, Awaited<ReturnType<typeof createOrganization>>>("organizations", createOrganization);
export const updateOrganizationAction = platformAdminAction<UpdateOrganizationInput, Awaited<ReturnType<typeof updateOrganization>>>("organizations", updateOrganization);
export const createMembershipAction = platformAdminAction<CreateMembershipInput, Awaited<ReturnType<typeof createMembership>>>("memberships", createClientMembership);
export const updateMembershipAction = platformAdminAction<UpdateMembershipInput, Awaited<ReturnType<typeof updateMembership>>>("memberships", updateClientMembership);
export const removeMembershipAction = platformAdminAction<RemoveMembershipInput, Awaited<ReturnType<typeof removeMembership>>>("memberships", removeClientMembership);
export const createUserAction = platformAdminAction<CreateUserInput, Awaited<ReturnType<typeof createUser>>>("memberships", createPlatformUser);
export const resetUserPasswordAction = platformAdminAction<ResetUserPasswordInput, Awaited<ReturnType<typeof resetUserPassword>>>("memberships", resetUserPassword);
export const setUserEnabledAction = platformAdminAction<SetUserEnabledInput, Awaited<ReturnType<typeof setUserEnabled>>>("memberships", setUserEnabled);
