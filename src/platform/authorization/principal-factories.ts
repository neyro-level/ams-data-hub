import { createCorrelationId } from "../http/correlation.ts";
import {
  createIdentityDatabaseAuthorizationContext,
  runInAuthorizedDatabaseTransaction,
} from "../database/transaction.ts";
import type {
  PlatformAdminPrincipal,
  PrincipalContext,
  TenantRole,
  TenantUserPrincipal,
} from "./principal.ts";

export interface PrincipalFactoryOptions {
  correlationId?: string;
  selectedOrganizationId?: string | null;
  platformAdminMfaVerified?: boolean;
}

export interface PrincipalState {
  principal: PrincipalContext;
  displayName: string;
}

export interface PrincipalResolution {
  state: PrincipalState | null;
  organizationChoices: Array<{ id: string; name: string }>;
  autoSelectedOrganizationId: string | null;
}

function parseTenantRole(value: string): TenantRole {
  if (value === "ORG_ADMIN" || value === "ORG_EDITOR" || value === "ORG_VIEWER") {
    return value;
  }
  throw new Error(`Unsupported tenant role: ${value}`);
}

export function resolveTenantMembership<T extends { organizationId: string }>(
  memberships: readonly T[],
  selectedOrganizationId?: string | null,
): T | null {
  if (selectedOrganizationId) {
    const selected = memberships.find((membership) =>
      membership.organizationId === selectedOrganizationId);
    if (selected) return selected;
  }
  return memberships.length === 1 ? memberships[0] : null;
}

export async function getPrincipalResolutionByUserId(
  userId: string,
  options: PrincipalFactoryOptions = {},
): Promise<PrincipalResolution> {
  const now = new Date();
  const correlationId = options.correlationId ?? createCorrelationId();
  const user = await runInAuthorizedDatabaseTransaction(
    createIdentityDatabaseAuthorizationContext({ userId, correlationId }),
    (transaction) => transaction.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        systemRole: true,
        disabledAt: true,
        setupTokens: {
          where: { consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
          select: { id: true },
          take: 1,
        },
        members: {
          orderBy: { organizationId: "asc" },
          select: {
            id: true,
            organizationId: true,
            tenantRole: true,
            organization: { select: { name: true } },
          },
        },
        projectMembers: {
          select: { organizationId: true, projectId: true },
        },
      },
    }),
  );
  if (!user || user.disabledAt || user.setupTokens.length > 0) {
    return { state: null, organizationChoices: [], autoSelectedOrganizationId: null };
  }

  const organizationChoices = user.members.map((membership) => ({
    id: membership.organizationId,
    name: membership.organization.name,
  }));

  let principal: PrincipalContext;
  let autoSelectedOrganizationId: string | null = null;
  if (user.systemRole === "PLATFORM_ADMIN") {
    if (!options.platformAdminMfaVerified) {
      return { state: null, organizationChoices: [], autoSelectedOrganizationId: null };
    }
    principal = {
      kind: "platform-admin",
      userId: user.id,
      correlationId,
    } satisfies PlatformAdminPrincipal;
  } else {
    const selectedMembership = resolveTenantMembership(
      user.members,
      options.selectedOrganizationId,
    );
    if (!selectedMembership) {
      return { state: null, organizationChoices, autoSelectedOrganizationId: null };
    }
    if (
      user.members.length === 1
      && selectedMembership.organizationId !== options.selectedOrganizationId
    ) {
      autoSelectedOrganizationId = selectedMembership.organizationId;
    }
    principal = {
      kind: "tenant-user",
      userId: user.id,
      organizationId: selectedMembership.organizationId,
      membershipId: selectedMembership.id,
      role: parseTenantRole(selectedMembership.tenantRole),
      projectIds: selectedMembership.tenantRole === "ORG_ADMIN"
        ? "*"
        : user.projectMembers
          .filter((membership) => membership.organizationId === selectedMembership.organizationId)
          .map((membership) => membership.projectId),
      correlationId,
    } satisfies TenantUserPrincipal;
  }

  return {
    state: {
      principal,
      displayName: user.name,
    },
    organizationChoices,
    autoSelectedOrganizationId,
  };
}

export async function getPrincipalStateByUserId(
  userId: string,
  options: PrincipalFactoryOptions = {},
): Promise<PrincipalState | null> {
  return (await getPrincipalResolutionByUserId(userId, options)).state;
}

export function createJobPrincipal(input: {
  jobName: string;
  organizationId?: string | null;
  projectIds?: readonly string[] | "*";
  correlationId?: string;
}): PrincipalContext {
  return {
    kind: "job",
    jobName: input.jobName,
    organizationId: input.organizationId ?? null,
    projectIds: input.projectIds ?? "*",
    correlationId: input.correlationId ?? createCorrelationId(),
  };
}

export function createProjectJobPrincipal(input: {
  jobName: string;
  organizationId: string;
  projectId: string;
  correlationId?: string;
}): PrincipalContext {
  return {
    kind: "project-job",
    jobName: input.jobName,
    organizationId: input.organizationId,
    projectId: input.projectId,
    correlationId: input.correlationId ?? createCorrelationId(),
  };
}

export function requirePlatformAdmin(principal: PrincipalContext): PlatformAdminPrincipal {
  if (principal.kind !== "platform-admin") {
    throw new Error("PLATFORM_ADMIN_REQUIRED");
  }
  return principal;
}

export function requireTenantUser(principal: PrincipalContext): TenantUserPrincipal {
  if (principal.kind !== "tenant-user") {
    throw new Error("TENANT_USER_REQUIRED");
  }
  return principal;
}
