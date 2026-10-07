import "server-only";
import { z } from "zod";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction,
  type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { createProjectSnapshotKey } from "../../../platform/storage/object-storage.ts";
import { createSnapshotPublicationProjectReader } from "../../project-state/server.ts";
import { createSnapshotPublicationSourceReader } from "../../ingestion-core/server.ts";
import { createSnapshotPublicationCatalogReader } from "../../shared-catalog/server.ts";
import { createSnapshotPublicationMediaReader } from "../../media-assets/server.ts";
import type { SnapshotBuildInputReceipt } from "../application/snapshot-build-input.ts";
import { PrismaSnapshotInputRepository } from "./prisma-snapshot-input-repository.ts";
import { PrismaSnapshotPublicationRepository } from "./prisma-snapshot-publication-repository.ts";
import { PrismaSnapshotDeliveryRepository } from "./prisma-snapshot-delivery-repository.ts";
import { lockSnapshotPublication } from "./snapshot-publication-lock.ts";
import { createSnapshotArtifactStagingServer } from "./snapshot-artifact-staging.ts";

const lookupSchema = z.object({ idempotencyKeyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
function assertNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("SNAPSHOT_PUBLICATION_CANCELLED");
}

/** Server-only persisted receipt -> settled PUT -> fresh atomic publication.
 * No caller-supplied staged result, manifest, permission metadata or service state. */
export function createSnapshotPublicationServer(bound: Parameters<typeof createSnapshotArtifactStagingServer>[0]) {
  const scope = { organizationId: bound.organizationId, projectId: bound.projectId };
  return async (principal: PrincipalContext, rawLookup: z.input<typeof lookupSchema>, signal?: AbortSignal) => {
    if (principal.kind !== "project-job" || principal.jobName !== "snapshot-input"
      || principal.organizationId !== scope.organizationId || principal.projectId !== scope.projectId) {
      throw new Error("SNAPSHOT_INPUT_ACCESS_DENIED");
    }
    const lookup = lookupSchema.parse(rawLookup); assertNotCancelled(signal);
    const receipt = await runInAuthorizedDatabaseTransaction(createDatabaseAuthorizationContext(principal),
      (tx) => new PrismaSnapshotInputRepository(tx).find(scope.organizationId, scope.projectId,
        lookup.idempotencyKeyHash, lookup.requestHash), { isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 30_000 });
    if (!receipt) throw new Error("SNAPSHOT_INPUT_NOT_FOUND");
    const context = createDatabaseAuthorizationContext(createProjectJobPrincipal({ ...scope,
      jobName: "snapshot-publication", correlationId: principal.correlationId }));
    const cut = <T>(execute: (tx: DatabaseTransaction) => Promise<T>) => runInAuthorizedDatabaseTransaction(context,
      async (tx) => { await lockSnapshotPublication(tx, scope); return execute(tx); },
      { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
    const committed = async (tx: DatabaseTransaction, input: SnapshotBuildInputReceipt) => {
      const run = await new PrismaSnapshotDeliveryRepository(tx).getRun(scope.organizationId, scope.projectId, input.publishSequence);
      if (!run) return null;
      const binding = await tx.snapshotPublicationBinding.findUnique({ where: {
        organizationId_projectId_buildInputId: { ...scope, buildInputId: input.id } } });
      if (!binding || binding.inputHash !== input.inputHash || binding.publishSequence !== input.publishSequence
        || run.manifestSha256 !== binding.manifestSha256
        || run.manifestKey !== createProjectSnapshotKey(scope.projectId, binding.manifestSha256)
        || run.publishedAt.getTime() !== input.capturedAt.getTime()) {
        throw new Error("SNAPSHOT_PUBLICATION_COMMITTED_CONFLICT");
      }
      return run;
    };
    const replay = await cut((tx) => committed(tx, receipt));
    if (replay) return replay; // No signer/key lookup, HEAD, PUT or current-pointer rewrite.
    try {
      assertNotCancelled(signal);
      // Construct lazily: a durable committed result survives a rotated/missing signer.
      const staged = await createSnapshotArtifactStagingServer(bound)(principal, lookup);
      assertNotCancelled(signal);
      return await cut(async (tx) => {
        const existing = await committed(tx, receipt);
        if (existing) return existing; // Concurrent success wins over freshness changes.
        assertNotCancelled(signal);
        await createSnapshotPublicationProjectReader(tx)(scope, staged.projectAnchors);
        await createSnapshotPublicationSourceReader(tx)(scope, staged.sourceAnchors);
        await createSnapshotPublicationCatalogReader(tx)(scope, staged.catalogAnchors);
        await createSnapshotPublicationMediaReader(tx)(scope, staged.mediaAnchors);
        const binding = await new PrismaSnapshotPublicationRepository(tx).bind({ ...scope,
          receiptId: receipt.id, inputHash: receipt.inputHash, manifest: staged.manifest });
        if (staged.binding.buildInputId !== receipt.id || binding.manifestSha256 !== staged.current.manifestSha256
          || staged.current.manifestKey !== createProjectSnapshotKey(scope.projectId, binding.manifestSha256)) {
          throw new Error("SNAPSHOT_PUBLICATION_STORAGE_MISMATCH");
        }
        assertNotCancelled(signal);
        const run = await new PrismaSnapshotDeliveryRepository(tx).publishCurrentAndCreateRun(staged.current);
        assertNotCancelled(signal); // Still inside callback: cancellation rolls back pointer AND run.
        return run;
      });
    } catch (error) {
      // A concurrent invocation may have committed between early replay and
      // signing/staging/admission failure. Never report that durable success failed.
      const existing = await cut((tx) => committed(tx, receipt));
      if (existing) return existing;
      throw error;
    }
  };
}
