import type { TenantRole } from "../../../../platform/authorization/principal.ts";
import type {
  CreateMembershipInput,
  CreateOrganizationInput,
  IdentityAdminFormOptions,
  IdentityAdminListQuery,
  IdentityAdminUserListItem,
  MembershipListResult,
  OrganizationListResult,
  ProvisionClientInput,
  ProvisionClientResult,
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

export type ProvisionClientPersistenceInput = Omit<ProvisionClientInput, "password"> & {
  passwordHash: string;
  actorId: string;
  correlationId: string;
};

export interface IdentityAdminRepository {
  listOrganizations(query: IdentityAdminListQuery): Promise<OrganizationListResult>;
  listMemberships(query: IdentityAdminListQuery): Promise<MembershipListResult>;
  listFormOptions(): Promise<IdentityAdminFormOptions>;
  listUsers(): Promise<IdentityAdminUserListItem[]>;
  provisionClient(input: ProvisionClientPersistenceInput): Promise<ProvisionClientResult>;
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
