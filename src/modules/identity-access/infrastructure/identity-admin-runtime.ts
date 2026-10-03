import {
  runInIdentityBootstrapDatabaseTransaction,
  type DatabaseTransaction,
} from "../../../platform/database/transaction.ts";
import { createCompleteAccountSetup } from "../application/complete-account-setup.ts";
import { createCompletePlatformRecovery } from "../application/complete-platform-recovery.ts";
import { createIdentityAdminCommands } from "../application/identity-admin-commands.ts";
import { createIdentityAdminQueries } from "../application/identity-admin-queries.ts";
import { PrismaIdentityAdminRepository } from "./prisma-identity-admin-repository.ts";

const identityCompletionDependencies = {
  withRepository<TResult>(
    execute: (repository: PrismaIdentityAdminRepository) => Promise<TResult>,
  ) {
    return runInIdentityBootstrapDatabaseTransaction((transaction) =>
      execute(new PrismaIdentityAdminRepository(transaction)),
    );
  },
};

export const completeAccountSetup = createCompleteAccountSetup(
  identityCompletionDependencies,
);
export const completePlatformRecovery = createCompletePlatformRecovery(
  identityCompletionDependencies,
);

const commands = createIdentityAdminCommands({
  createRepository(transaction: DatabaseTransaction) {
    return new PrismaIdentityAdminRepository(transaction);
  },
});

const queries = createIdentityAdminQueries({
  createRepository(transaction: DatabaseTransaction) {
    return new PrismaIdentityAdminRepository(transaction);
  },
});

export const {
  createMembership,
  createOrganization,
  createUser,
  issuePlatformRecovery,
  removeMembership,
  updateMembership,
  updateOrganization,
  resetUserPassword,
  setUserEnabled,
} = commands;

export const {
  getIdentityAdminFormOptions,
  listMemberships,
  listOrganizations,
  listUsers,
} = queries;
