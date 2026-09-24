import { createCorrelationId } from "../http/correlation.ts";
import { getPrismaClient } from "../database/prisma/client.ts";
import type {
  PlatformAdminPrincipal,
  PlatformStaffPrincipal,
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

function parseTenantRole(value: string): TenantRole {
  if (value === "ORG_OWNER" || value === "ORG_MEMBER" || value === "VIEWER") {
    return value;
  }
  throw new Error(`Unsupported tenant role: ${value}`);
}

export async function getPrincipalStateByUserId(
  userId: string,
  options: PrincipalFactoryOptions = {},
): Promise<PrincipalState | null> {
  const user = await getPrismaClient().user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      systemRole: true,
      disabledAt: true,
      members: {
        orderBy: { organizationId: "asc" },
        select: { id: true, organizationId: true, tenantRole: true },
      },
    },
  });
  if (!user || user.disabledAt) return null;

  const correlationId = options.correlationId ?? createCorrelationId();
  let principal: PrincipalContext;
  if (user.systemRole === "PLATFORM_ADMIN") {
    if (!options.platformAdminMfaVerified) return null;
    principal = {
      kind: "platform-admin",
      userId: user.id,
      correlationId,
    } satisfies PlatformAdminPrincipal;
  } else if (user.systemRole === "STAFF") {
    principal = { kind: "platform-staff", userId: user.id, correlationId } satisfies PlatformStaffPrincipal;
  } else {
    const selectedMembership = options.selectedOrganizationId
      ? user.members.find((membership) => membership.organizationId === options.selectedOrganizationId)
      : user.members.length === 1 ? user.members[0] : null;
    if (!selectedMembership) return null;
    principal = {
      kind: "tenant-user",
      userId: user.id,
      organizationId: selectedMembership.organizationId,
      membershipId: selectedMembership.id,
      role: parseTenantRole(selectedMembership.tenantRole),
      correlationId,
    } satisfies TenantUserPrincipal;
  }

  return {
    principal,
    displayName: user.name,
  };
}

export function createJobPrincipal(input: {
  jobName: string;
  organizationId?: string | null;
  correlationId?: string;
}): PrincipalContext {
  return {
    kind: "job",
    jobName: input.jobName,
    organizationId: input.organizationId ?? null,
    correlationId: input.correlationId ?? createCorrelationId(),
  };
}

export function requirePlatformAdmin(principal: PrincipalContext): PlatformAdminPrincipal {
  if (principal.kind !== "platform-admin") {
    throw new Error("PLATFORM_ADMIN_REQUIRED");
  }
  return principal;
}

export function requirePlatformStaff(principal: PrincipalContext): PlatformStaffPrincipal {
  if (principal.kind !== "platform-staff") {
    throw new Error("PLATFORM_STAFF_REQUIRED");
  }
  return principal;
}

export function requireTenantUser(principal: PrincipalContext): TenantUserPrincipal {
  if (principal.kind !== "tenant-user") {
    throw new Error("TENANT_USER_REQUIRED");
  }
  return principal;
}
