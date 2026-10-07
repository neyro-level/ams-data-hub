import "server-only";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import type { SecretRef } from "../../../platform/security/secret-ref.ts";
import type { ObjectStorage } from "../../../platform/storage/object-storage.ts";
import type { SnapshotTrustSet } from "../contracts.ts";
import { composeSnapshot } from "../application/snapshot-composer.ts";
import { signSnapshotManifest, verifySnapshotSignatureCandidate } from "../application/snapshot-signing.ts";
import { createEd25519SecretRefSigner } from "./ed25519-secret-ref-signer.ts";
import { createSnapshotCandidateAssemblyServer } from "./snapshot-candidate-assembly.ts";

/** Server-owned signing configuration; publication/fresh admission is separate. */
export function createSnapshotSignedBuildServer(bound: {
  organizationId: string; projectId: string; storage: Pick<ObjectStorage, "head">;
  keyId: string; privateKeyRef: SecretRef; trustSet: SnapshotTrustSet;
  signal?: AbortSignal;
}) {
  const signer = createEd25519SecretRefSigner({ keyId: bound.keyId, privateKeyRef: bound.privateKeyRef });
  const trustSet: SnapshotTrustSet = Object.freeze({
    currentKeyId: bound.trustSet.currentKeyId, nextKeyId: bound.trustSet.nextKeyId,
    publicKeys: Object.freeze({ ...bound.trustSet.publicKeys }),
    revokedKeyIds: Object.freeze([...bound.trustSet.revokedKeyIds]),
  });
  if (trustSet.revokedKeyIds.includes(signer.keyId)
    || ![trustSet.currentKeyId, trustSet.nextKeyId].includes(signer.keyId)
    || !Object.hasOwn(trustSet.publicKeys, signer.keyId) || !trustSet.publicKeys[signer.keyId]) {
    throw new Error("SNAPSHOT_BUILD_KEY_UNTRUSTED");
  }
  const assemble = createSnapshotCandidateAssemblyServer(bound);
  return async (principal: PrincipalContext, lookup: Parameters<typeof assemble>[1]) => {
    const candidate = await assemble(principal, lookup);
    const metadata = candidate.manifestMetadata;
    const composition = composeSnapshot({
      ...metadata, publishedAt: metadata.generatedAt, keyId: signer.keyId,
      requiresProjectContact: candidate.requiresProjectContact, datasets: candidate.datasets,
    });
    const manifest = await signSnapshotManifest(composition, signer).catch(() => {
      throw new Error("SNAPSHOT_BUILD_SIGNING_FAILED");
    });
    const verification = verifySnapshotSignatureCandidate({ manifest, trustSet, lastGood: null });
    if (!verification.accepted) throw new Error("SNAPSHOT_BUILD_SIGNATURE_INVALID");
    return { receiptId: candidate.receiptId, inputHash: candidate.inputHash, sourceAnchors: candidate.sourceAnchors,
      projectAnchors: candidate.projectAnchors,
      catalogAnchors: candidate.catalogAnchors,
      mediaAnchors: candidate.mediaAnchors,
      composition, manifest, diagnostics: candidate.diagnostics };
  };
}
