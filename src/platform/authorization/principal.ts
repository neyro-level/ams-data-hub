export const PERMISSIONS = [
  "platform:manage",
  "membership:manage:any",
  "project:read:any",
  "project:read:organization",
  "project:manage:any",
  "operations:read:any",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type TenantRole = "ORG_OWNER" | "ORG_MEMBER" | "VIEWER";

export interface TenantUserPrincipal {
  kind: "tenant-user";
  userId: string;
  organizationId: string;
  membershipId: string;
  role: TenantRole;
  correlationId: string;
}

export interface PlatformAdminPrincipal {
  kind: "platform-admin";
  userId: string;
  correlationId: string;
}

export interface PlatformStaffPrincipal {
  kind: "platform-staff";
  userId: string;
  correlationId: string;
}

export interface ApiClientPrincipal {
  kind: "api-client";
  apiClientId: string;
  organizationId: string;
  correlationId: string;
}

export interface JobPrincipal {
  kind: "job";
  jobName: string;
  organizationId: string | null;
  correlationId: string;
}

export type PrincipalContext =
  | TenantUserPrincipal
  | PlatformAdminPrincipal
  | PlatformStaffPrincipal
  | ApiClientPrincipal
  | JobPrincipal;

const PLATFORM_ADMIN_PERMISSIONS: readonly Permission[] = PERMISSIONS;
const PLATFORM_STAFF_PERMISSIONS: readonly Permission[] = [
  "project:read:any",
  "operations:read:any",
];
const TENANT_PERMISSIONS: Record<TenantRole, readonly Permission[]> = {
  ORG_OWNER: [
    "project:read:organization",
    "project:manage:any",
  ],
  ORG_MEMBER: ["project:read:organization"],
  VIEWER: ["project:read:organization"],
};

export function getPrincipalPermissions(principal: PrincipalContext): readonly Permission[] {
  switch (principal.kind) {
    case "platform-admin":
      return PLATFORM_ADMIN_PERMISSIONS;
    case "platform-staff":
      return PLATFORM_STAFF_PERMISSIONS;
    case "tenant-user":
      return TENANT_PERMISSIONS[principal.role];
    case "api-client":
    case "job":
      return [];
  }
}

export function hasPermission(principal: PrincipalContext, permission: Permission): boolean {
  return getPrincipalPermissions(principal).includes(permission);
}

export function isTenantPrincipal(
  principal: PrincipalContext,
): principal is TenantUserPrincipal | ApiClientPrincipal {
  return principal.kind === "tenant-user" || principal.kind === "api-client";
}
