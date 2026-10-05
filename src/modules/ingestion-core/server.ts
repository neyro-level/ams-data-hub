import "server-only";

import { createUlid } from "@ams-data-hub/data-contracts";
import { createInventoryIdentityCommands } from "./application/inventory-identity-commands.ts";
import { createSourceRegistryCommands } from "./application/source-registry-commands.ts";
import { createSourceRegistryQueries } from "./application/source-registry-queries.ts";
import { adapterProfileRegistry } from "./domain/adapter-profile-registry.ts";
import { PrismaInventoryIdentityRepository } from "./infrastructure/prisma-inventory-identity-repository.ts";
import { PrismaSourceRegistryRepository } from "./infrastructure/prisma-source-registry-repository.ts";

export const sourceRegistryCommands = createSourceRegistryCommands({
  createRepository: (transaction) => new PrismaSourceRegistryRepository(transaction),
  adapterProfileRegistry,
});

export const { listSourcesForAdmin, getSourceAdminData } = createSourceRegistryQueries({
  createRepository: (transaction) => new PrismaSourceRegistryRepository(transaction),
});

export const inventoryIdentityCommands = createInventoryIdentityCommands({
  createRepository: (transaction) => new PrismaInventoryIdentityRepository(transaction),
  createUid: (timestamp) => createUlid(timestamp),
});

export { SourceRegistryError } from "./domain/source-registry-error.ts";
export { adapterProfileRegistry } from "./domain/adapter-profile-registry.ts";
export {
  normalizedContentHash,
  runIndependentSourceImports,
  runSourceImport,
  type GoodRevisionReceipt,
  type ImportPipelineDependencies,
  type ImportPipelineStage,
  type MutationPlan,
  type RawArtifactReceipt,
  type SourceImportResult,
  type SourceImportTarget,
  type StagingReceipt,
} from "./application/import-pipeline.ts";
