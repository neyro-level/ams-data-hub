import "server-only";
import type { z } from "zod";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction } from "../../../platform/database/transaction.ts";
import { createSnapshotPublicationProjectReader } from "../../project-state/server.ts";
import { createSnapshotPublicationSourceReader } from "../../ingestion-core/server.ts";
import { createSnapshotPublicationCatalogReader } from "../../shared-catalog/server.ts";
import { createSnapshotPublicationMediaReader } from "../../media-assets/server.ts";
import { createSnapshotArtifactStagingServer } from "./snapshot-artifact-staging.ts";
import { snapshotPublicationLookupSchema } from "./snapshot-publication-replay.ts";
import { lockSnapshotPublication } from "./snapshot-publication-lock.ts";

function scopeOf(principal: PrincipalContext) {
  if (principal.kind !== "project-job" || principal.jobName !== "snapshot-input") throw new Error("SNAPSHOT_INPUT_ACCESS_DENIED");
  return { organizationId: principal.organizationId, projectId: principal.projectId };
}
function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("SNAPSHOT_PUBLICATION_CANCELLED");
}

/** Metadata-only, config-free replay. No private captured facts, signer, HEAD,
 * PUT or mutable admission; this proves old BUILD, never new PUBLISH approval. */
export async function inspectStagedSnapshotServer(principal: PrincipalContext,
  rawLookup: z.input<typeof snapshotPublicationLookupSchema>) {
  const scope = scopeOf(principal); const lookup = snapshotPublicationLookupSchema.parse(rawLookup);
  return runInAuthorizedDatabaseTransaction(createDatabaseAuthorizationContext(principal), async (tx) => {
    const input = await tx.snapshotBuildInput.findFirst({ where: { ...scope, ...lookup },
      select: { id: true, inputHash: true, publishSequence: true } });
    if (!input) return null;
    const receipt = await tx.snapshotArtifactStageReceipt.findUnique({ where: {
      organizationId_projectId_buildInputId: { ...scope, buildInputId: input.id },
    } });
    if (!receipt) return null;
    if (receipt.inputHash !== input.inputHash || receipt.publishSequence !== input.publishSequence
      || receipt.idempotencyKeyHash !== lookup.idempotencyKeyHash) throw new Error("SNAPSHOT_STAGE_RECEIPT_INVALID");
    return receipt;
  }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
}

/** Existing assembly/sign/stage -> fresh post-PUT cut -> immutable receipt.
 * Never writes current/DeliveryRun and exposes no caller-metadata record seam. */
export function createSnapshotStagedBuildServer(bound: Parameters<typeof createSnapshotArtifactStagingServer>[0]) {
  return async (principal: PrincipalContext, rawLookup: z.input<typeof snapshotPublicationLookupSchema>, signal?: AbortSignal) => {
    const scope = scopeOf(principal); const lookup = snapshotPublicationLookupSchema.parse(rawLookup);
    if (scope.organizationId !== bound.organizationId || scope.projectId !== bound.projectId) throw new Error("SNAPSHOT_INPUT_ACCESS_DENIED");
    const ownedSignal = signal && bound.signal ? AbortSignal.any([signal, bound.signal]) : signal ?? bound.signal;
    const existing = await inspectStagedSnapshotServer(principal, lookup);
    if (existing) return existing;
    try {
      checkCancelled(ownedSignal);
      const staged = await createSnapshotArtifactStagingServer(bound)(principal, lookup, ownedSignal);
      checkCancelled(ownedSignal);
      const publication = createProjectJobPrincipal({ ...scope, jobName: "snapshot-publication", correlationId: principal.correlationId });
      return await runInAuthorizedDatabaseTransaction(createDatabaseAuthorizationContext(publication), async (tx) => {
        await lockSnapshotPublication(tx, scope);
        const prior = await tx.snapshotArtifactStageReceipt.findUnique({ where: {
          organizationId_projectId_buildInputId: { ...scope, buildInputId: staged.binding.buildInputId },
        } });
        if (prior) return prior;
        checkCancelled(ownedSignal);
        await createSnapshotPublicationProjectReader(tx)(scope, staged.projectAnchors);
        await createSnapshotPublicationSourceReader(tx)(scope, staged.sourceAnchors);
        await createSnapshotPublicationCatalogReader(tx)(scope, staged.catalogAnchors);
        await createSnapshotPublicationMediaReader(tx)(scope, staged.mediaAnchors);
        const receipt = await tx.snapshotArtifactStageReceipt.create({ data: { ...scope,
          buildInputId: staged.binding.buildInputId, inputHash: staged.binding.inputHash,
          publishSequence: staged.binding.publishSequence, manifestSha256: staged.binding.manifestSha256,
          idempotencyKeyHash: lookup.idempotencyKeyHash,
        } });
        checkCancelled(ownedSignal); // Late cancellation rolls back this receipt.
        return receipt;
      }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
    } catch (error) {
      // A concurrent stage may commit while this invocation fails or cancels.
      const replay = await inspectStagedSnapshotServer(principal, lookup);
      if (replay) return replay;
      throw error;
    }
  };
}
