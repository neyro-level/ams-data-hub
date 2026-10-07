import "server-only";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction } from "../../../platform/database/transaction.ts";
import { createProjectSnapshotKey, ProjectSnapshotStorage } from "../../../platform/storage/object-storage.ts";
import { stageSnapshotArtifacts } from "../application/snapshot-delivery.ts";
import { PrismaSnapshotPublicationRepository } from "./prisma-snapshot-publication-repository.ts";
import { createSnapshotSignedBuildServer } from "./snapshot-signed-build.ts";
import type { ObjectStorage } from "../../../platform/storage/object-storage.ts";

/** Prepare durable identity and immutable artifacts, never expose a current pointer. */
export function createSnapshotArtifactStagingServer(bound: Parameters<typeof createSnapshotSignedBuildServer>[0] & { storage: ObjectStorage }) {
  const scope = { organizationId: bound.organizationId, projectId: bound.projectId };
  const build = createSnapshotSignedBuildServer(bound);
  const storage = new ProjectSnapshotStorage(scope.projectId, bound.storage);
  return async (principal: PrincipalContext, lookup: Parameters<typeof build>[1]) => {
    const signed = await build(principal, lookup); // Strict scope/lookup and privacy/signature gates precede binding.
    const publication = createProjectJobPrincipal({ ...scope, jobName: "snapshot-publication", correlationId: principal.correlationId });
    const binding = await runInAuthorizedDatabaseTransaction(createDatabaseAuthorizationContext(publication),
      (tx) => new PrismaSnapshotPublicationRepository(tx).bind({ ...scope, receiptId: signed.receiptId,
        inputHash: signed.inputHash, manifest: signed.manifest }),
      { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
    const current = await stageSnapshotArtifacts({ organizationId: scope.organizationId,
      composition: signed.composition, manifest: signed.manifest }, storage); // No DB cut remains open.
    if (current.manifestSha256 !== binding.manifestSha256
      || current.manifestKey !== createProjectSnapshotKey(scope.projectId, binding.manifestSha256)) {
      throw new Error("SNAPSHOT_PUBLICATION_STORAGE_MISMATCH");
    }
    return { binding, current, manifest: signed.manifest, diagnostics: signed.diagnostics };
  };
}
