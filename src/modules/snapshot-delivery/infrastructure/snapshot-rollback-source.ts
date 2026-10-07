import "server-only";
import { createPublicKey } from "node:crypto";
import { z } from "zod";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ObjectStorage, BoundedObjectStorage } from "../../../platform/storage/object-storage.ts";
import type { SnapshotTrustSet } from "../contracts.ts";
import { prepareSelectedSnapshotAdmission } from "../application/snapshot-selected-admission.ts";
import { PrismaSnapshotInputRepository } from "./prisma-snapshot-input-repository.ts";
import { PrismaSnapshotRollbackRepository } from "./prisma-snapshot-rollback-repository.ts";
import { readStagedSnapshotComposition } from "./snapshot-staged-artifact-reader.ts";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const scopeSchema = z.object({ organizationId: id, projectId: id }).strict();
const lookupSchema = z.object({ sourcePublishSequence: z.number().int().positive().max(2_147_483_647) }).strict();

/** Snapshot-private archive read, NOT consumer acceptance or fresh permission.
 * No caller-supplied source/root/canonical bytes or trust-policy override. */
export function createApprovedSnapshotRollbackSourceReader(bound: {
  organizationId: string; projectId: string; storage: ObjectStorage & BoundedObjectStorage;
  getTrust(): SnapshotTrustSet;
}) {
  const scope = scopeSchema.parse({ organizationId: bound.organizationId, projectId: bound.projectId });
  return async (principal: PrincipalContext, rawLookup: z.input<typeof lookupSchema>, signal?: AbortSignal) => {
    if (principal.kind !== "project-job" || principal.jobName !== "snapshot-input"
      || principal.organizationId !== scope.organizationId || principal.projectId !== scope.projectId) throw new Error("SNAPSHOT_INPUT_ACCESS_DENIED");
    const lookup = lookupSchema.parse(rawLookup);
    const cancelled = () => { if (signal?.aborted) throw new Error("SNAPSHOT_PUBLICATION_CANCELLED"); };
    cancelled();
    const context = createDatabaseAuthorizationContext(createProjectJobPrincipal({ ...scope,
      jobName: "snapshot-publication", correlationId: principal.correlationId }));
    // Approval and bounded root capture share one consistent snapshot. Finish
    // the DB cut before public config/GET; no row/advisory lock crosses IO.
    const approved = await runInAuthorizedDatabaseTransaction(context, async (tx) => {
      const source = await new PrismaSnapshotRollbackRepository(tx).approvedSource(scope, lookup.sourcePublishSequence);
      const root = await tx.snapshotBuildInput.findFirst({ where: { ...scope, id: source.rootBuildInputId },
        select: { id: true, idempotencyKeyHash: true, requestHash: true } });
      if (!root) throw new Error("SNAPSHOT_ROLLBACK_SOURCE_INVALID");
      const receipt = await new PrismaSnapshotInputRepository(tx).find(scope.organizationId, scope.projectId,
        root.idempotencyKeyHash, root.requestHash);
      if (!receipt || receipt.id !== source.rootBuildInputId || receipt.inputHash !== source.inputHash
        || receipt.publishSequence > lookup.sourcePublishSequence) throw new Error("SNAPSHOT_ROLLBACK_SOURCE_INVALID");
      return { source, receipt };
    }, { isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 30_000 });
    cancelled();
    // Retained PUBLIC key authenticates these exact already-approved bytes only.
    // Revocation continues to deny consumer acceptance and every new signature.
    // Do not mutate the server's live trust set or admit other archival keys.
    const trust = bound.getTrust(); let publicKey: string;
    try {
      if (!Object.hasOwn(trust.publicKeys, approved.source.keyId)) throw new Error();
      const pem = trust.publicKeys[approved.source.keyId]!;
      if (Buffer.byteLength(pem) > 16 * 1024 || !pem.trimStart().startsWith("-----BEGIN PUBLIC KEY-----")) throw new Error();
      const parsed = createPublicKey(pem);
      if (parsed.asymmetricKeyType !== "ed25519") throw new Error();
      publicKey = parsed.export({ format: "pem", type: "spki" }).toString();
    } catch { throw new Error("SNAPSHOT_ROLLBACK_ARCHIVE_KEY_REQUIRED"); }
    cancelled();
    const artifacts = await readStagedSnapshotComposition({ projectId: scope.projectId, storage: bound.storage, signal,
      binding: { projectId: scope.projectId, publishSequence: lookup.sourcePublishSequence,
        manifestCanonical: approved.source.manifestCanonical, manifestSha256: approved.source.manifestSha256, keyId: approved.source.keyId },
      trustSet: { currentKeyId: approved.source.keyId, nextKeyId: null,
        publicKeys: { [approved.source.keyId]: publicKey }, revokedKeyIds: [] }, lastGood: null });
    // Attribution-only copy: a prior rollback has different sequence/time but
    // unchanged content. Never return this view as a verified/signed artifact.
    const attribution = { ...artifacts.verified, manifest: { ...artifacts.verified.manifest,
      publishSequence: approved.receipt.publishSequence, generatedAt: approved.receipt.capturedAt.toISOString(),
      publishedAt: approved.receipt.capturedAt.toISOString() } };
    const anchors = prepareSelectedSnapshotAdmission(approved.receipt, attribution);
    cancelled();
    return { source: { ...scope, publishSequence: lookup.sourcePublishSequence, ...approved.source },
      composition: artifacts.composition, anchors };
  };
}
