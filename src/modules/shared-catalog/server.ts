import "server-only";

export { normalizeGeoName } from "./domain/normalize-geo-name.ts";
export { SharedCatalogError } from "./domain/shared-catalog-error.ts";

import { createSharedCatalogCommands } from "./application/shared-catalog-commands.ts";
import { PrismaSharedCatalogRepository } from "./infrastructure/prisma-shared-catalog-repository.ts";

export const sharedCatalogCommands = createSharedCatalogCommands({
  createRepository: (transaction) => new PrismaSharedCatalogRepository(transaction),
});
