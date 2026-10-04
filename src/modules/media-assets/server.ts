import "server-only";

import { runInPrincipalDatabaseTransaction } from "../../platform/database/transaction.ts";
import type { ObjectStorage } from "../../platform/storage/object-storage.ts";
import { createMediaIntakeService } from "./application/media-intake-service.ts";
import { PrismaMediaAssetRepository } from "./infrastructure/prisma-media-asset-repository.ts";

export function createMediaAssetsServer(storage: ObjectStorage) {
  return {
    intakeMedia: createMediaIntakeService({
      storage,
      runInTransaction: runInPrincipalDatabaseTransaction,
      createRepository: (transaction) => new PrismaMediaAssetRepository(transaction),
    }),
  };
}
