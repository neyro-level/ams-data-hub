import { CAPABILITIES, type Capability, type OrganizationRole, ROLE_CAPABILITIES } from "./capabilities.ts";

export const PERMISSIONS = [
  "platform:manage",
  "membership:manage:any",
  "project:read:any",
  "project:read:organization",
  "project:manage:any",
  "operations:read:any",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type TenantRole = OrganizationRole;

export interface TenantUserPrincipal {
  kind: "tenant-user";
  userId: string;
  organizationId: string;
  membershipId: string;
  role: TenantRole;
  projectIds: readonly string[] | "*";
  correlationId: string;
}

export interface PlatformAdminPrincipal {
  kind: "platform-admin";
  userId: string;
  correlationId: string;
}


export interface ApiClientPrincipal {
  kind: "api-client";
  apiClientId: string;
  organizationId: string;
  projectIds: readonly string[] | "*";
  correlationId: string;
}

export interface JobPrincipal {
  kind: "job";
  jobName: string;
  organizationId: string | null;
  projectIds: readonly string[] | "*";
  correlationId: string;
}

export interface ProjectJobPrincipal {
  kind: "project-job";
  jobName: string;
  organizationId: string;
  projectId: string;
  correlationId: string;
}

export type PrincipalContext =
  | TenantUserPrincipal
  | PlatformAdminPrincipal
  | ApiClientPrincipal
  | JobPrincipal
  | ProjectJobPrincipal;

const PLATFORM_ADMIN_PERMISSIONS: readonly Permission[] = PERMISSIONS;
const TENANT_PERMISSIONS: Record<TenantRole, readonly Permission[]> = {
  ORG_ADMIN: [
    "project:read:organization",
    "project:manage:any",
  ],
  ORG_EDITOR: ["project:read:organization"],
  ORG_VIEWER: ["project:read:organization"],
};

export function getPrincipalPermissions(principal: PrincipalContext): readonly Permission[] {
  switch (principal.kind) {
    case "platform-admin":
      return PLATFORM_ADMIN_PERMISSIONS;
    case "tenant-user":
      return TENANT_PERMISSIONS[principal.role];
    case "api-client":
    case "job":
    case "project-job":
      return [];
  }
}

export { CAPABILITIES, type Capability, ROLE_CAPABILITIES };

export function hasPermission(principal: PrincipalContext, permission: Permission): boolean {
  return getPrincipalPermissions(principal).includes(permission);
}

export function isTenantPrincipal(
  principal: PrincipalContext,
): principal is TenantUserPrincipal | ApiClientPrincipal | ProjectJobPrincipal {
  return principal.kind === "tenant-user" || principal.kind === "api-client" || principal.kind === "project-job";
}
