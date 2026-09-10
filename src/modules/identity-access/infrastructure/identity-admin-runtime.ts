import { getPrismaClient } from "../../../platform/database/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { createIdentityAdminCommands } from "../application/identity-admin-commands.ts";
import { createIdentityAdminQueries } from "../application/identity-admin-queries.ts";
import { PrismaIdentityAdminRepository } from "./prisma-identity-admin-repository.ts";

const commands = createIdentityAdminCommands({
  createRepository(transaction: DatabaseTransaction) {
    return new PrismaIdentityAdminRepository(transaction);
  },
});

const queries = createIdentityAdminQueries({
  createRepository() {
    return new PrismaIdentityAdminRepository(getPrismaClient());
  },
});

export const {
  createMembership,
  createOrganization,
  removeMembership,
  updateMembership,
  updateOrganization,
  provisionClient,
  resetUserPassword,
  setUserEnabled,
} = commands;

export const {
  getIdentityAdminFormOptions,
  listMemberships,
  listOrganizations,
  listUsers,
} = queries;
