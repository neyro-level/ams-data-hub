import { createCorrelationId } from "../http/correlation.ts";
import { getPrismaClient } from "../database/prisma/client.ts";
import type {
  PlatformAdminPrincipal,
  PlatformAnalystPrincipal,
  PrincipalContext,
  TenantRole,
  TenantUserPrincipal,
} from "./principal.ts";

export interface PrincipalFactoryOptions {
  correlationId?: string;
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
    principal = {
      kind: "platform-admin",
      userId: user.id,
      correlationId,
    } satisfies PlatformAdminPrincipal;
  } else if (user.systemRole === "SEO_ANALYST") {
    principal = { kind: "platform-analyst", userId: user.id, correlationId } satisfies PlatformAnalystPrincipal;
  } else {
    const selectedMembership = user.members[0];
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
  organizationId: string;
  correlationId?: string;
}): PrincipalContext {
  return {
    kind: "job",
    jobName: input.jobName,
    organizationId: input.organizationId,
    correlationId: input.correlationId ?? createCorrelationId(),
  };
}

export function requirePlatformAdmin(principal: PrincipalContext): PlatformAdminPrincipal {
  if (principal.kind !== "platform-admin") {
    throw new Error("PLATFORM_ADMIN_REQUIRED");
  }
  return principal;
}

export function requirePlatformAnalyst(principal: PrincipalContext): PlatformAnalystPrincipal {
  if (principal.kind !== "platform-analyst") {
    throw new Error("PLATFORM_ANALYST_REQUIRED");
  }
  return principal;
}

export function requireTenantUser(principal: PrincipalContext): TenantUserPrincipal {
  if (principal.kind !== "tenant-user") {
    throw new Error("TENANT_USER_REQUIRED");
  }
  return principal;
}
