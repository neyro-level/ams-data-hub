import "server-only";

import { runInPrincipalDatabaseTransaction } from "../../platform/database/transaction.ts";
import { safeOutboundBuffered } from "../../platform/http/safe-outbound.ts";
import type { ObjectStorage } from "../../platform/storage/object-storage.ts";
import { createMediaIntakeService } from "./application/media-intake-service.ts";
import { createMediaMirrorService } from "./application/media-mirror-service.ts";
import { createInventoryMediaProjectionService } from "./application/media-projection-service.ts";
import { PrismaMediaProjectionRepository } from "./infrastructure/prisma-media-projection-repository.ts";
import { createInventoryPublicMediaReadService } from "./application/media-public-read-service.ts";
import { PrismaMediaAssetRepository } from "./infrastructure/prisma-media-asset-repository.ts";
import { PrismaMediaMirrorRepository } from "./infrastructure/prisma-media-mirror-repository.ts";

export function createMediaAssetsServer(storage: ObjectStorage) {
  const projectInventoryMedia = createInventoryMediaProjectionService({
    storage, runInTransaction: runInPrincipalDatabaseTransaction,
    createRepository: (transaction) => new PrismaMediaProjectionRepository(transaction),
  });
  return {
    projectInventoryMedia,
    readInventoryPublicMedia: createInventoryPublicMediaReadService({ storage, projectMedia: projectInventoryMedia }),
    intakeMedia: createMediaIntakeService({
      storage,
      runInTransaction: runInPrincipalDatabaseTransaction,
      createRepository: (transaction) => new PrismaMediaAssetRepository(transaction),
    }),
    mirrorMediaBatch: createMediaMirrorService({
      storage,
      fetchMedia: safeOutboundBuffered,
      runInTransaction: runInPrincipalDatabaseTransaction,
      createRepository: (transaction) => new PrismaMediaMirrorRepository(transaction),
    }),
  };
}
