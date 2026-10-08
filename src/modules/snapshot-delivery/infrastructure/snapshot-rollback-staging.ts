import "server-only";
import { z } from "zod";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction, type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { createProjectSnapshotKey, ProjectSnapshotStorage, type ObjectStorage, type BoundedObjectStorage } from "../../../platform/storage/object-storage.ts";
import type { SecretRef } from "../../../platform/security/secret-ref.ts";
import { snapshotManifestV1Schema, type SnapshotManifestV1, type SnapshotTrustSet } from "../contracts.ts";
import { composeRollbackSnapshot } from "../application/snapshot-rollback.ts";
import { signSnapshotManifest, verifySnapshotSignatureCandidate } from "../application/snapshot-signing.ts";
import { PrismaSnapshotRollbackRepository, type SnapshotRollbackLease } from "./prisma-snapshot-rollback-repository.ts";
import { PrismaSnapshotDeliveryRepository } from "./prisma-snapshot-delivery-repository.ts";
import { createApprovedSnapshotRollbackSourceReader } from "./snapshot-rollback-source.ts";
import { admitHistoricalSnapshotRollback } from "./snapshot-rollback-admission.ts";
import { createEd25519SecretRefSigner } from "./ed25519-secret-ref-signer.ts";

const scopeSchema = z.object({ organizationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  projectId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u) }).strict();
type Scope = z.infer<typeof scopeSchema>;
type Reservation = NonNullable<Awaited<ReturnType<DatabaseTransaction["snapshotRollbackReservation"]["findUnique"]>>>;
type Binding = NonNullable<Awaited<ReturnType<DatabaseTransaction["snapshotRollbackBinding"]["findUnique"]>>>;
function cancelled(signal?: AbortSignal) { if (signal?.aborted) throw new Error("SNAPSHOT_PUBLICATION_CANCELLED"); }
function trusted(manifest: SnapshotManifestV1, trustSet: SnapshotTrustSet, sequence?: number) {
  const result = verifySnapshotSignatureCandidate({ manifest, trustSet,
    lastGood: sequence === undefined ? null : { projectId: manifest.projectId, schemaMajor: 1, publishSequence: sequence } });
  if (!result.accepted) throw new Error(`SNAPSHOT_ARTIFACT_${result.reason}`);
}
async function committed(tx: DatabaseTransaction, scope: Scope, reservation: Reservation, binding: Binding | null) {
  const run = await new PrismaSnapshotDeliveryRepository(tx).getRun(scope.organizationId, scope.projectId, reservation.publishSequence);
  if (!run) return null;
  if (!binding?.stagedAt || binding.publishSequence !== reservation.publishSequence || run.manifestSha256 !== binding.manifestSha256
    || run.manifestKey !== createProjectSnapshotKey(scope.projectId, binding.manifestSha256)
    || run.publishedAt.getTime() !== reservation.createdAt.getTime()) throw new Error("SNAPSHOT_ROLLBACK_COMMITTED_CONFLICT");
  return run;
}

/** Snapshot-owned staging and finish closure. Does not register an executor or
 * mark an operational request successful. Caller owns the atomic final Ops cut. */
export function createSnapshotRollbackStagingServer(bound: {
  organizationId: string; projectId: string; storage: ObjectStorage & BoundedObjectStorage;
  getTrust(): SnapshotTrustSet; getSigning(): { keyId: string; privateKeyRef: SecretRef };
}) {
  const scope = scopeSchema.parse({ organizationId: bound.organizationId, projectId: bound.projectId });
  return async (principal: PrincipalContext, rawLease: SnapshotRollbackLease, signal?: AbortSignal) => {
    const lease = { ...rawLease }; // Caller mutation must not retarget an owned finish.
    if (principal.kind !== "project-job" || principal.jobName !== "snapshot-input" || principal.organizationId !== scope.organizationId
      || principal.projectId !== scope.projectId || lease.organizationId !== scope.organizationId || lease.projectId !== scope.projectId) throw new Error("SNAPSHOT_INPUT_ACCESS_DENIED");
    const context = createDatabaseAuthorizationContext(createProjectJobPrincipal({ ...scope,
      jobName: "snapshot-publication", correlationId: principal.correlationId }));
    const cut = <T>(execute: (tx: DatabaseTransaction, repo: PrismaSnapshotRollbackRepository) => Promise<T>) =>
      runInAuthorizedDatabaseTransaction(context, (tx) => execute(tx, new PrismaSnapshotRollbackRepository(tx)),
        { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
    const where = { organizationId_projectId_requestId: { ...scope, requestId: lease.requestId } };
    const replay = (reservation: Reservation, binding: Binding) => ({ reservation: structuredClone(reservation), binding: structuredClone(binding),
      finish: async (tx: DatabaseTransaction) => {
        await new PrismaSnapshotRollbackRepository(tx).fence(lease);
        const run = await committed(tx, scope, reservation, binding);
        if (!run) throw new Error("SNAPSHOT_ROLLBACK_COMMITTED_CONFLICT"); return run;
      } });
    try {
    // Full lease first. Existing committed publication replays before live
    // config, captured data, signing, IO or fresh permission checks.
    const initial = await cut(async (tx, repo) => {
      const reservation = await repo.reserve(lease);
      const binding = await tx.snapshotRollbackBinding.findUnique({ where });
      return { reservation, binding, run: await committed(tx, scope, reservation, binding) };
    });
    if (initial.run) return replay(initial.reservation, initial.binding!);
    const ownedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
    cancelled(ownedSignal);
    // Pending bound identity must still be trusted. Never re-sign it using a
    // rotated key, even if a new signing ref would now be available.
    if (initial.binding) trusted(snapshotManifestV1Schema.parse(JSON.parse(initial.binding.manifestCanonical)), bound.getTrust());
    const source = await createApprovedSnapshotRollbackSourceReader(bound)(principal,
      { sourcePublishSequence: lease.sourcePublishSequence }, ownedSignal);
    if (source.source.sourceDeliveryRunId !== initial.reservation.sourceDeliveryRunId
      || source.source.rootBuildInputId !== initial.reservation.rootBuildInputId
      || source.source.inputHash !== initial.reservation.inputHash) throw new Error("SNAPSHOT_ROLLBACK_SOURCE_INVALID");
    let manifest: SnapshotManifestV1;
    if (initial.binding) manifest = snapshotManifestV1Schema.parse(JSON.parse(initial.binding.manifestCanonical));
    else {
      const signing = bound.getSigning();
      const trust = bound.getTrust();
      if (trust.revokedKeyIds.includes(signing.keyId) || ![trust.currentKeyId, trust.nextKeyId].includes(signing.keyId)
        || !Object.hasOwn(trust.publicKeys, signing.keyId) || !trust.publicKeys[signing.keyId]) throw new Error("SNAPSHOT_BUILD_KEY_UNTRUSTED");
      const composition = composeRollbackSnapshot({ source: source.composition, currentPublishSequence: initial.reservation.publishSequence - 1,
        generatedAt: initial.reservation.createdAt.toISOString(), publishedAt: initial.reservation.createdAt.toISOString(), keyId: signing.keyId });
      manifest = await signSnapshotManifest(composition, createEd25519SecretRefSigner(signing)).catch(() => {
        throw new Error("SNAPSHOT_ROLLBACK_SIGNING_FAILED");
      });
    }
    cancelled(ownedSignal); trusted(manifest, bound.getTrust());
    const binding = await cut(async (tx, repo) => {
      await repo.fence(lease); cancelled(ownedSignal);
      await admitHistoricalSnapshotRollback(tx, scope, source.anchors);
      trusted(manifest, bound.getTrust()); const pinned = await repo.bind(lease, manifest);
      cancelled(ownedSignal); return pinned;
    });
    if (!binding.stagedAt) {
      cancelled(ownedSignal);
      const storage = new ProjectSnapshotStorage(scope.projectId, bound.storage);
      // Only the new manifest: all thirteen original files are already stored.
      const key = createProjectSnapshotKey(scope.projectId, binding.manifestSha256);
      const stored = await storage.put({ body: new TextEncoder().encode(binding.manifestCanonical),
        contentType: "application/json", sha256: binding.manifestSha256, signal: ownedSignal });
      cancelled(ownedSignal);
      if (stored.key !== key || stored.sha256 !== binding.manifestSha256
        || stored.contentLength !== Buffer.byteLength(binding.manifestCanonical)) throw new Error("SNAPSHOT_PUBLICATION_STORAGE_MISMATCH");
    }
    const staged = await cut(async (tx, repo) => {
      await repo.fence(lease); cancelled(ownedSignal);
      await admitHistoricalSnapshotRollback(tx, scope, source.anchors);
      trusted(manifest, bound.getTrust()); const stage = await repo.markStaged(lease);
      cancelled(ownedSignal); return stage;
    });
    return { reservation: structuredClone(initial.reservation), binding: structuredClone(staged), finish: async (tx: DatabaseTransaction) => {
      const repo = new PrismaSnapshotRollbackRepository(tx); await repo.fence(lease);
      const existing = await committed(tx, scope, initial.reservation, staged);
      if (existing) return existing; // Never rewind a newer current on committed replay.
      cancelled(ownedSignal);
      await admitHistoricalSnapshotRollback(tx, scope, source.anchors);
      const repository = new PrismaSnapshotDeliveryRepository(tx);
      const current = await repository.getCurrentManifest(scope.organizationId, scope.projectId);
      trusted(manifest, bound.getTrust(), current?.publishSequence);
      cancelled(ownedSignal);
      const run = await repository.publishCurrentAndCreateRun({ ...scope, publishSequence: initial.reservation.publishSequence,
        manifestSha256: staged.manifestSha256, manifestKey: createProjectSnapshotKey(scope.projectId, staged.manifestSha256),
        publishedAt: initial.reservation.createdAt });
      cancelled(ownedSignal); return run;
    } };
    } catch (error) {
      // Another invocation may have committed after initial inspection or while
      // our owned IO failed. Only current full-lease + exact committed identity
      // permits replay; lease loss never turns an error into historical success.
      try {
        const recovery = await cut(async (tx, repo) => {
          await repo.fence(lease);
          const reservation = await tx.snapshotRollbackReservation.findUnique({ where });
          if (!reservation || reservation.sourcePublishSequence !== lease.sourcePublishSequence) return null;
          const binding = await tx.snapshotRollbackBinding.findUnique({ where });
          return await committed(tx, scope, reservation, binding) ? { reservation, binding: binding! } : null;
        });
        if (recovery) return replay(recovery.reservation, recovery.binding);
      } catch { /* Preserve original failure; no retry may bypass a stale lease. */ }
      throw error;
    }
  };
}
