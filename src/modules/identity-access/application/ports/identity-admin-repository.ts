import type { TenantRole } from "../../../../platform/authorization/principal.ts";
import type {
  CreateMembershipInput,
  CreateOrganizationInput,
  CreateUserInput,
  CreateUserResult,
  IdentityAdminFormOptions,
  IdentityAdminListQuery,
  IdentityAdminUserListItem,
  MembershipListResult,
  OrganizationListResult,
  UpdateMembershipInput,
  UpdateOrganizationInput,
} from "../../domain/admin-identity.ts";

export interface OrganizationActionRecord {
  id: string;
  slug: string;
  name: string;
  version: number;
}

export interface MembershipActionRecord {
  id: string;
  organizationId: string;
  userId: string;
  tenantRole: TenantRole;
  version: number;
}

export interface IdentityAdminAuditInput {
  actorId: string;
  action: string;
  entityType: "Organization" | "Member" | "User";
  entityId: string;
  organizationId: string | null;
  beforeMarker: Record<string, string | number | boolean | null> | null;
  afterMarker: Record<string, string | number | boolean | null> | null;
  correlationId: string;
}

export type CreateUserPersistenceInput = Omit<CreateUserInput, "password"> & {
  passwordHash: string;
};

export interface IdentityAdminRepository {
  listOrganizations(query: IdentityAdminListQuery): Promise<OrganizationListResult>;
  listMemberships(query: IdentityAdminListQuery): Promise<MembershipListResult>;
  listFormOptions(): Promise<IdentityAdminFormOptions>;
  listUsers(): Promise<IdentityAdminUserListItem[]>;
  createUser(input: CreateUserPersistenceInput): Promise<CreateUserResult>;
  issueAccountSetupToken(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  completeAccountSetup(input: { tokenHash: string; passwordHash: string; now: Date }): Promise<string | null>;
  issuePlatformRecoveryToken(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<boolean>;
  completePlatformRecovery(input: { tokenHash: string; passwordHash: string; now: Date }): Promise<string | null>;
  resetUserPassword(userId: string, passwordHash: string): Promise<boolean>;
  setUserEnabled(userId: string, enabled: boolean): Promise<boolean>;
  createOrganization(input: CreateOrganizationInput): Promise<{ id: string; version: number }>;
  findOrganizationForAction(organizationId: string): Promise<OrganizationActionRecord | null>;
  updateOrganization(input: UpdateOrganizationInput): Promise<boolean>;
  createMembership(input: CreateMembershipInput): Promise<{ id: string; version: number }>;
  findMembershipForAction(input: {
    organizationId: string;
    membershipId: string;
  }): Promise<MembershipActionRecord | null>;
  updateMembership(input: UpdateMembershipInput): Promise<boolean>;
  removeMembership(input: {
    organizationId: string;
    membershipId: string;
    version: number;
  }): Promise<boolean>;
  appendAudit(input: IdentityAdminAuditInput): Promise<void>;
}
