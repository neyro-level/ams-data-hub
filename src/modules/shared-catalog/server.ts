import "server-only";

export { normalizeGeoName } from "./domain/normalize-geo-name.ts";
export { SharedCatalogError } from "./domain/shared-catalog-error.ts";

import { createSharedCatalogCommands } from "./application/shared-catalog-commands.ts";
import { createCatalogSubscriptionCommands } from "./application/catalog-subscription-commands.ts";
import { getProjectCatalogSnapshotSelection } from "./application/catalog-subscription-queries.ts";
import { getCatalogAdminData } from "./application/shared-catalog-queries.ts";
import { PrismaCatalogSubscriptionRepository } from "./infrastructure/prisma-catalog-subscription-repository.ts";
import { PrismaSharedCatalogRepository } from "./infrastructure/prisma-shared-catalog-repository.ts";

export const sharedCatalogCommands = createSharedCatalogCommands({
  createRepository: (transaction) => new PrismaSharedCatalogRepository(transaction),
});

export const catalogSubscriptionCommands = createCatalogSubscriptionCommands({
  createRepository: (transaction) => new PrismaCatalogSubscriptionRepository(transaction),
});

export { getCatalogAdminData, getProjectCatalogSnapshotSelection };
