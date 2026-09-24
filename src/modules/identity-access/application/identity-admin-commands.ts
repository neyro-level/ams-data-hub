import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { defineCommand } from "../../../platform/commands/define-command.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  createMembershipInputSchema,
  createOrganizationInputSchema,
  createUserInputSchema,
  IdentityAdminError,
  issuePlatformRecoveryInputSchema,
  nextIdentityVersion,
  removeMembershipInputSchema,
  resetUserPasswordInputSchema,
  setUserEnabledInputSchema,
  updateMembershipInputSchema,
  updateOrganizationInputSchema,
} from "../domain/admin-identity.ts";
import {
  requireIdentityAdminActor,
  requireIdentityAdminScope,
} from "./identity-admin-authorization.ts";
import type { IdentityAdminRepository } from "./ports/identity-admin-repository.ts";

export interface OrganizationCommandResult {
  organizationId: string;
  version: number;
}

export interface MembershipCommandResult {
  membershipId: string;
  version: number;
}

export interface RemoveMembershipCommandResult {
  membershipId: string;
}

export interface IdentityAdminCommandDependencies {
  createRepository(transaction: DatabaseTransaction): IdentityAdminRepository;
}

export function createIdentityAdminCommands(
  dependencies: IdentityAdminCommandDependencies,
) {
  const createUser = defineCommand<PrincipalContext, typeof createUserInputSchema, { userId: string; membershipId: string | null; setupToken: string }>({
    name: "identity-access.user.create",
    input: createUserInputSchema,
    authorize: (principal) => { requireIdentityAdminActor(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireIdentityAdminActor(principal);
      const repository = dependencies.createRepository(transaction);
      const safeInput = input;
      const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
      const result = await repository.createUser({ ...safeInput, passwordHash });
      const setupToken = randomBytes(32).toString("base64url");
      await repository.issueAccountSetupToken({
        userId: result.userId,
        tokenHash: createHash("sha256").update(setupToken).digest("hex"),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      await repository.appendAudit({
        actorId: actor.actorId,
        action: "user.create",
        entityType: "User",
        entityId: result.userId,
        organizationId: safeInput.organizationId || null,
        beforeMarker: null,
        afterMarker: {
          username: input.username,
          systemRole: input.systemRole,
          membershipCreated: Boolean(result.membershipId),
        },
        correlationId: actor.correlationId,
      });
      return { ...result, setupToken };
    },
  });

  const resetUserPassword = defineCommand<PrincipalContext, typeof resetUserPasswordInputSchema, { userId: string }>({
    name: "identity-access.user.password-reset",
    input: resetUserPasswordInputSchema,
    authorize: (principal) => { requireIdentityAdminActor(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireIdentityAdminActor(principal);
      const repository = dependencies.createRepository(transaction);
      const passwordHash = await hashPassword(input.password);
      if (!await repository.resetUserPassword(input.userId, passwordHash)) throw new IdentityAdminError("USER_NOT_FOUND");
      await repository.appendAudit({ actorId: actor.actorId, action: "user.password-reset", entityType: "User", entityId: input.userId, organizationId: null, beforeMarker: null, afterMarker: { sessionsRevoked: true }, correlationId: actor.correlationId });
      return { userId: input.userId };
    },
  });

  const issuePlatformRecovery = defineCommand<PrincipalContext, typeof issuePlatformRecoveryInputSchema, { userId: string; recoveryToken: string }>({
    name: "identity-access.platform-admin.recovery.issue",
    input: issuePlatformRecoveryInputSchema,
    authorize: (principal) => { requireIdentityAdminActor(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireIdentityAdminActor(principal);
      const recoveryToken = randomBytes(32).toString("base64url");
      const repository = dependencies.createRepository(transaction);
      const issued = await repository.issuePlatformRecoveryToken({ userId: input.userId, tokenHash: createHash("sha256").update(recoveryToken).digest("hex"), expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
      if (!issued) throw new IdentityAdminError("USER_NOT_FOUND");
      await repository.appendAudit({ actorId: actor.actorId, action: "platform-admin.recovery.issue", entityType: "User", entityId: input.userId, organizationId: null, beforeMarker: null, afterMarker: { expiresInMinutes: 60 }, correlationId: actor.correlationId });
      return { userId: input.userId, recoveryToken };
    },
  });

  const setUserEnabled = defineCommand<PrincipalContext, typeof setUserEnabledInputSchema, { userId: string; enabled: boolean }>({
    name: "identity-access.user.set-enabled",
    input: setUserEnabledInputSchema,
    authorize: (principal) => { requireIdentityAdminActor(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireIdentityAdminActor(principal);
      const repository = dependencies.createRepository(transaction);
      if (!await repository.setUserEnabled(input.userId, input.enabled)) throw new IdentityAdminError("USER_NOT_FOUND");
      await repository.appendAudit({ actorId: actor.actorId, action: input.enabled ? "user.enable" : "user.disable", entityType: "User", entityId: input.userId, organizationId: null, beforeMarker: null, afterMarker: { enabled: input.enabled, sessionsRevoked: !input.enabled }, correlationId: actor.correlationId });
      return input;
    },
  });

  const createOrganization = defineCommand<
    PrincipalContext,
    typeof createOrganizationInputSchema,
    OrganizationCommandResult
  >({
    name: "identity-access.organization.create",
    input: createOrganizationInputSchema,
    authorize: (principal) => {
      requireIdentityAdminActor(principal);
    },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireIdentityAdminActor(principal);
      const repository = dependencies.createRepository(transaction);
      const organization = await repository.createOrganization(input);
      await repository.appendAudit({
        actorId: actor.actorId,
        action: "organization.create",
        entityType: "Organization",
        entityId: organization.id,
        organizationId: organization.id,
        beforeMarker: null,
        afterMarker: {
          name: input.name,
          slug: input.slug,
          version: organization.version,
        },
        correlationId: actor.correlationId,
      });
      return { organizationId: organization.id, version: organization.version };
    },
  });

  const updateOrganization = defineCommand<
    PrincipalContext,
    typeof updateOrganizationInputSchema,
    OrganizationCommandResult
  >({
    name: "identity-access.organization.update",
    input: updateOrganizationInputSchema,
    authorize: (principal, input) => {
      requireIdentityAdminScope(principal, input.organizationId);
    },
    execute: async ({ principal, input, transaction }) => {
      const scope = requireIdentityAdminScope(principal, input.organizationId);
      const repository = dependencies.createRepository(transaction);
      const organization = await repository.findOrganizationForAction(
        input.organizationId,
      );
      if (!organization) {
        throw new IdentityAdminError("ORGANIZATION_NOT_FOUND_OR_FORBIDDEN");
      }
      if (organization.version !== input.version) {
        throw new IdentityAdminError("ORGANIZATION_STALE");
      }

      const updated = await repository.updateOrganization(input);
      if (!updated) {
        throw new IdentityAdminError("ORGANIZATION_STALE");
      }

      const version = nextIdentityVersion(input.version, "ORGANIZATION_STALE");
      await repository.appendAudit({
        actorId: scope.actorId,
        action: "organization.update",
        entityType: "Organization",
        entityId: organization.id,
        organizationId: scope.organizationId,
        beforeMarker: {
          name: organization.name,
          slug: organization.slug,
          version: organization.version,
        },
        afterMarker: {
          name: input.name,
          slug: input.slug,
          version,
        },
        correlationId: scope.correlationId,
      });
      return { organizationId: organization.id, version };
    },
  });

  const createMembership = defineCommand<
    PrincipalContext,
    typeof createMembershipInputSchema,
    MembershipCommandResult
  >({
    name: "identity-access.membership.create",
    input: createMembershipInputSchema,
    authorize: (principal, input) => {
      requireIdentityAdminScope(principal, input.organizationId);
    },
    execute: async ({ principal, input, transaction }) => {
      const scope = requireIdentityAdminScope(principal, input.organizationId);
      const repository = dependencies.createRepository(transaction);
      const membership = await repository.createMembership(input);
      await repository.appendAudit({
        actorId: scope.actorId,
        action: "membership.create",
        entityType: "Member",
        entityId: membership.id,
        organizationId: scope.organizationId,
        beforeMarker: null,
        afterMarker: {
          userId: input.userId,
          tenantRole: input.tenantRole,
          version: membership.version,
        },
        correlationId: scope.correlationId,
      });
      return { membershipId: membership.id, version: membership.version };
    },
  });

  const updateMembership = defineCommand<
    PrincipalContext,
    typeof updateMembershipInputSchema,
    MembershipCommandResult
  >({
    name: "identity-access.membership.update",
    input: updateMembershipInputSchema,
    authorize: (principal, input) => {
      requireIdentityAdminScope(principal, input.organizationId);
    },
    execute: async ({ principal, input, transaction }) => {
      const scope = requireIdentityAdminScope(principal, input.organizationId);
      const repository = dependencies.createRepository(transaction);
      const membership = await repository.findMembershipForAction({
        organizationId: input.organizationId,
        membershipId: input.membershipId,
      });
      if (!membership) {
        throw new IdentityAdminError("MEMBERSHIP_NOT_FOUND_OR_FORBIDDEN");
      }
      if (membership.version !== input.version) {
        throw new IdentityAdminError("MEMBERSHIP_STALE");
      }

      const updated = await repository.updateMembership(input);
      if (!updated) {
        throw new IdentityAdminError("MEMBERSHIP_STALE");
      }

      const version = nextIdentityVersion(input.version, "MEMBERSHIP_STALE");
      await repository.appendAudit({
        actorId: scope.actorId,
        action: "membership.update",
        entityType: "Member",
        entityId: membership.id,
        organizationId: scope.organizationId,
        beforeMarker: {
          userId: membership.userId,
          tenantRole: membership.tenantRole,
          version: membership.version,
        },
        afterMarker: {
          userId: membership.userId,
          tenantRole: input.tenantRole,
          version,
        },
        correlationId: scope.correlationId,
      });
      return { membershipId: membership.id, version };
    },
  });

  const removeMembership = defineCommand<
    PrincipalContext,
    typeof removeMembershipInputSchema,
    RemoveMembershipCommandResult
  >({
    name: "identity-access.membership.remove",
    input: removeMembershipInputSchema,
    authorize: (principal, input) => {
      requireIdentityAdminScope(principal, input.organizationId);
    },
    execute: async ({ principal, input, transaction }) => {
      const scope = requireIdentityAdminScope(principal, input.organizationId);
      const repository = dependencies.createRepository(transaction);
      const membership = await repository.findMembershipForAction({
        organizationId: input.organizationId,
        membershipId: input.membershipId,
      });
      if (!membership) {
        throw new IdentityAdminError("MEMBERSHIP_NOT_FOUND_OR_FORBIDDEN");
      }
      if (membership.version !== input.version) {
        throw new IdentityAdminError("MEMBERSHIP_STALE");
      }

      const removed = await repository.removeMembership({
        organizationId: input.organizationId,
        membershipId: input.membershipId,
        version: input.version,
      });
      if (!removed) {
        throw new IdentityAdminError("MEMBERSHIP_STALE");
      }

      await repository.appendAudit({
        actorId: scope.actorId,
        action: "membership.remove",
        entityType: "Member",
        entityId: membership.id,
        organizationId: scope.organizationId,
        beforeMarker: {
          userId: membership.userId,
          tenantRole: membership.tenantRole,
          version: membership.version,
        },
        afterMarker: null,
        correlationId: scope.correlationId,
      });
      return { membershipId: membership.id };
    },
  });

  return {
    createMembership,
    createOrganization,
    createUser,
    issuePlatformRecovery,
    removeMembership,
    resetUserPassword,
    setUserEnabled,
    updateMembership,
    updateOrganization,
  };
}
