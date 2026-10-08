import "server-only";
export { createRawRetentionSnapshotProvenanceValidator, type RawRetentionCapturedSourceHead, type RawRetentionCapturedInventoryPin } from "./infrastructure/raw-retention-snapshot-provenance.ts";
export { createSnapshotPublicationSourceReader } from "./infrastructure/snapshot-publication-source-reader.ts";
export { createSnapshotRollbackSourceReader } from "./infrastructure/snapshot-rollback-source-reader.ts";
export { assertSnapshotSourceGoodTrigger, createSnapshotSourceGoodTriggerReader } from "./infrastructure/snapshot-source-trigger.ts";
export { createSourceExecutionServer } from "./infrastructure/streaming-source-runtime.ts";
export { createSnapshotGoodFactResolver, type SnapshotGoodFactPin, type SnapshotGoodNormalizedFact,
  type SnapshotCapturedFactProfile } from "./infrastructure/snapshot-good-fact-resolver.ts";
export { createSourceSnapshotFactReader, type SourceSnapshotInventoryFact } from "./infrastructure/source-snapshot-facts.ts";
export { createInventoryPublicProjectionServer } from "./infrastructure/inventory-public-projection-server.ts";

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
export { prepareSuspiciousRevisionRejection } from "./infrastructure/suspicious-revision-rejection.ts";
export { applySuspiciousRevisionApproval } from "./infrastructure/suspicious-revision-approval.ts";
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
export { createRawArtifactRetentionSourceReader, type RawArtifactRetentionSourceCut } from "./infrastructure/raw-artifact-retention-source-reader.ts";
