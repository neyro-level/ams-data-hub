import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import {
  identityAdminListQuerySchema,
  type IdentityAdminListQuery,
} from "../domain/admin-identity.ts";
import { requireIdentityAdminActor } from "./identity-admin-authorization.ts";
import type { IdentityAdminRepository } from "./ports/identity-admin-repository.ts";

export interface IdentityAdminQueryDependencies {
  createRepository(): IdentityAdminRepository;
}

export function createIdentityAdminQueries(
  dependencies: IdentityAdminQueryDependencies,
) {
  async function listOrganizations(
    principal: PrincipalContext,
    rawQuery: Partial<IdentityAdminListQuery>,
  ) {
    requireIdentityAdminActor(principal);
    const query = identityAdminListQuerySchema.parse(rawQuery);
    return dependencies.createRepository().listOrganizations(query);
  }

  async function listMemberships(
    principal: PrincipalContext,
    rawQuery: Partial<IdentityAdminListQuery>,
  ) {
    requireIdentityAdminActor(principal);
    const query = identityAdminListQuerySchema.parse(rawQuery);
    return dependencies.createRepository().listMemberships(query);
  }

  async function getIdentityAdminFormOptions(principal: PrincipalContext) {
    requireIdentityAdminActor(principal);
    return dependencies.createRepository().listFormOptions();
  }

  async function listUsers(principal: PrincipalContext) {
    requireIdentityAdminActor(principal);
    return dependencies.createRepository().listUsers();
  }

  return {
    getIdentityAdminFormOptions,
    listOrganizations,
    listMemberships,
    listUsers,
  };
}
