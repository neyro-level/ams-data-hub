import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createProjectSnapshotKey, type ObjectStorage, type BoundedObjectStorage } from "../../../platform/storage/object-storage.ts";
import { snapshotManifestV1Schema, type SnapshotTrustSet } from "../contracts.ts";
import { verifySnapshotSignatureCandidate } from "../application/snapshot-signing.ts";
import { prepareSelectedSnapshotAdmission } from "../application/snapshot-selected-admission.ts";
import { createSnapshotPublicationProjectReader } from "../../project-state/server.ts";
import { createSnapshotPublicationSourceReader } from "../../ingestion-core/server.ts";
import { createSnapshotPublicationCatalogReader } from "../../shared-catalog/server.ts";
import { createSnapshotPublicationMediaReader } from "../../media-assets/server.ts";
import { inspectSelectedSnapshotStageServer, loadSelectedSnapshotCaptureServer } from "./snapshot-selected-stage.ts";
import { readStagedSnapshotArtifacts } from "./snapshot-staged-artifact-reader.ts";
import { readCommittedSnapshotRun } from "./snapshot-publication-replay.ts";
import { PrismaSnapshotDeliveryRepository } from "./prisma-snapshot-delivery-repository.ts";
import { lockSnapshotPublication } from "./snapshot-publication-lock.ts";

export async function inspectSelectedSnapshotRunServer(principal: PrincipalContext, lookup: { buildInputId: string }) {
  const selected = await inspectSelectedSnapshotStageServer(principal, lookup);
  if (!selected) throw new Error("SNAPSHOT_STAGE_NOT_FOUND");
  return selected.run; // IDs/public delivery metadata only, no capture or canonical binding.
}

/** Bounded artifact IO/captured admission first; returns a snapshot-owned finish
 * closure, not private facts. Caller owns one short RC atomic domain/result cut.
 * getTrust is synchronous server-owned public config, never secret/provider IO. */
export function createSelectedSnapshotPublicationServer(bound: {
  organizationId: string; projectId: string; storage: ObjectStorage & BoundedObjectStorage;
  getTrust(): SnapshotTrustSet;
}) {
  const scope = { organizationId: bound.organizationId, projectId: bound.projectId };
  return async (principal: PrincipalContext, lookup: { buildInputId: string }, signal?: AbortSignal) => {
    if (principal.kind !== "project-job" || principal.jobName !== "snapshot-input"
      || principal.organizationId !== scope.organizationId || principal.projectId !== scope.projectId) throw new Error("SNAPSHOT_INPUT_ACCESS_DENIED");
    const cancelled = () => { if (signal?.aborted) throw new Error("SNAPSHOT_PUBLICATION_CANCELLED"); };
    cancelled();
    const selected = await loadSelectedSnapshotCaptureServer(principal, lookup);
    const verified = await readStagedSnapshotArtifacts({ projectId: scope.projectId, storage: bound.storage,
      trustSet: bound.getTrust(), lastGood: null, signal, binding: { projectId: selected.binding.projectId,
        publishSequence: selected.binding.publishSequence, manifestSha256: selected.binding.manifestSha256,
        manifestCanonical: selected.binding.manifestCanonical, keyId: selected.binding.keyId } });
    const anchors = prepareSelectedSnapshotAdmission(selected.receipt, verified);
    cancelled();
    return async (tx: DatabaseTransaction) => {
      const access = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`
        SELECT snapshot_publication_scope(${scope.organizationId}, ${scope.projectId}) AS allowed`);
      if (access[0]?.allowed !== true) throw new Error("SNAPSHOT_INPUT_ACCESS_DENIED");
      await lockSnapshotPublication(tx, scope);
      const existing = await readCommittedSnapshotRun(tx, scope, selected.receipt);
      if (existing) return existing; // Config/freshness changes cannot undo prior publication.
      cancelled();
      await createSnapshotPublicationProjectReader(tx)(scope, anchors.projectAnchors);
      await createSnapshotPublicationSourceReader(tx)(scope, anchors.sourceAnchors);
      await createSnapshotPublicationCatalogReader(tx)(scope, anchors.catalogAnchors);
      await createSnapshotPublicationMediaReader(tx)(scope, anchors.mediaAnchors);
      const repository = new PrismaSnapshotDeliveryRepository(tx);
      const current = await repository.getCurrentManifest(scope.organizationId, scope.projectId);
      const trust = verifySnapshotSignatureCandidate({ manifest: snapshotManifestV1Schema.parse(verified.manifest), trustSet: bound.getTrust(),
        lastGood: current ? { projectId: scope.projectId, schemaMajor: 1, publishSequence: current.publishSequence } : null });
      if (!trust.accepted) throw new Error(`SNAPSHOT_ARTIFACT_${trust.reason}`);
      cancelled();
      const run = await repository.publishCurrentAndCreateRun({ ...scope, publishSequence: selected.stage.publishSequence,
        manifestSha256: selected.stage.manifestSha256, manifestKey: createProjectSnapshotKey(scope.projectId, selected.stage.manifestSha256),
        publishedAt: selected.receipt.capturedAt });
      cancelled(); return run;
    };
  };
}
