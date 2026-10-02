import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import {
  runInPrincipalDatabaseTransaction,
  type DatabaseTransaction,
} from "../../../platform/database/transaction.ts";
import {
  identityAdminListQuerySchema,
  type IdentityAdminListQuery,
} from "../domain/admin-identity.ts";
import { requireIdentityAdminActor } from "./identity-admin-authorization.ts";
import type { IdentityAdminRepository } from "./ports/identity-admin-repository.ts";

export interface IdentityAdminQueryDependencies {
  createRepository(transaction: DatabaseTransaction): IdentityAdminRepository;
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
    return runInPrincipalDatabaseTransaction(principal, (transaction) =>
      dependencies.createRepository(transaction).listOrganizations(query),
    );
  }

  async function listMemberships(
    principal: PrincipalContext,
    rawQuery: Partial<IdentityAdminListQuery>,
  ) {
    requireIdentityAdminActor(principal);
    const query = identityAdminListQuerySchema.parse(rawQuery);
    return runInPrincipalDatabaseTransaction(principal, (transaction) =>
      dependencies.createRepository(transaction).listMemberships(query),
    );
  }

  async function getIdentityAdminFormOptions(principal: PrincipalContext) {
    requireIdentityAdminActor(principal);
    return runInPrincipalDatabaseTransaction(principal, (transaction) =>
      dependencies.createRepository(transaction).listFormOptions(),
    );
  }

  async function listUsers(principal: PrincipalContext) {
    requireIdentityAdminActor(principal);
    return runInPrincipalDatabaseTransaction(principal, (transaction) =>
      dependencies.createRepository(transaction).listUsers(),
    );
  }

  return {
    getIdentityAdminFormOptions,
    listOrganizations,
    listMemberships,
    listUsers,
  };
}
