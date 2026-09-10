import type {
  JobPrincipal,
  PlatformAdminPrincipal,
  PlatformAnalystPrincipal,
  TenantRole,
  TenantUserPrincipal,
} from "../../src/platform/authorization/principal.ts";

const correlationId = "00000000-0000-4000-8000-000000000001";

export function createPlatformAdminPrincipal(
  userId = "platform-admin-1",
): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId, correlationId };
}

export function createPlatformAnalystPrincipal(
  userId = "platform-analyst-1",
): PlatformAnalystPrincipal {
  return { kind: "platform-analyst", userId, correlationId };
}

export function createTenantUserPrincipal(input: {
  userId?: string;
  organizationId: string;
  membershipId?: string;
  role?: TenantRole;
}): TenantUserPrincipal {
  return {
    kind: "tenant-user",
    userId: input.userId ?? "tenant-user-1",
    organizationId: input.organizationId,
    membershipId: input.membershipId ?? "membership-1",
    role: input.role ?? "VIEWER",
    correlationId,
  };
}

export function createDeniedJobPrincipal(organizationId: string): JobPrincipal {
  return { kind: "job", jobName: "denied-test", organizationId, correlationId };
}
