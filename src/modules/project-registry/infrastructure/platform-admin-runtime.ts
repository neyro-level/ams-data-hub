import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { getPrismaClient } from "../../../platform/database/prisma/client.ts";
import { createPlatformAdminCommands } from "../application/platform-admin-commands.ts";
import { createPlatformAdminQueries } from "../application/platform-admin-queries.ts";
import { PrismaProjectRegistryAdminRepository } from "./prisma-platform-admin-repository.ts";

const commands = createPlatformAdminCommands({
  createRepository(transaction: DatabaseTransaction) {
    return new PrismaProjectRegistryAdminRepository(transaction);
  },
});

const queries = createPlatformAdminQueries({
  createRepository() {
    return new PrismaProjectRegistryAdminRepository(getPrismaClient());
  },
});

export const {
  confirmMetricaGoals,
  saveGoalDefinition,
  saveProviderConnection,
  saveQueryClusterProfile,
  saveSite,
  saveThresholdProfile,
  saveTrackedQuerySet,
} = commands;

export const {
  getProjectRegistryAdminFormOptions,
  listGoalDefinitions,
  listProviderConnections,
  listQueryClusterProfiles,
  listSites,
  listThresholdProfiles,
  listTrackedQuerySets,
} = queries;
