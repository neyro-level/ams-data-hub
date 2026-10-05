import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { createPublicKey, verify } from "node:crypto";
import {
  snapshotManifestV1Schema,
  type SnapshotAcceptanceState,
  type SnapshotComposition,
  type SnapshotManifestV1,
  type SnapshotSigner,
  type SnapshotTrustSet,
  type SnapshotVerificationRejection,
  type SnapshotVerificationResult,
  type UnsignedSnapshotManifestV1,
} from "../contracts.ts";

function unsignedManifest(manifest: SnapshotManifestV1): UnsignedSnapshotManifestV1 {
  const { signature, ...unsigned } = manifest;
  void signature;
  return unsigned;
}

function signingPayload(manifest: SnapshotManifestV1): Uint8Array {
  return canonicalJsonBytes(unsignedManifest(manifest) as CanonicalJsonValue);
}

export async function signSnapshotManifest(
  composition: SnapshotComposition,
  signer: SnapshotSigner,
): Promise<SnapshotManifestV1> {
  if (composition.manifest.keyId !== signer.keyId) {
    throw new Error("Snapshot signer keyId does not match the unsigned manifest");
  }
  const signature = await signer.sign(composition.manifestPayload);
  return snapshotManifestV1Schema.parse({
    ...composition.manifest,
    signature: Buffer.from(signature).toString("base64url"),
  });
}

export function verifySnapshotSignatureCandidate(input: {
  manifest: SnapshotManifestV1;
  trustSet: SnapshotTrustSet;
  lastGood: SnapshotAcceptanceState | null;
}): SnapshotVerificationResult {
  const { manifest, trustSet, lastGood } = input;
  const reject = (reason: SnapshotVerificationRejection): SnapshotVerificationResult => ({
    accepted: false,
    reason,
    nextState: lastGood,
  });

  if (trustSet.revokedKeyIds.includes(manifest.keyId)) return reject("REVOKED_KEY_ID");
  const allowedKeyIds = new Set([trustSet.currentKeyId, trustSet.nextKeyId].filter((keyId): keyId is string => keyId !== null));
  const publicKeyPem = trustSet.publicKeys[manifest.keyId];
  if (!allowedKeyIds.has(manifest.keyId) || !publicKeyPem) return reject("UNKNOWN_KEY_ID");
  if (lastGood && manifest.projectId !== lastGood.projectId) return reject("PROJECT_MISMATCH");
  if (lastGood && manifest.schemaMajor !== lastGood.schemaMajor) return reject("SCHEMA_MAJOR_UNSUPPORTED");
  if (lastGood && manifest.publishSequence <= lastGood.publishSequence) return reject("STALE_PUBLISH_SEQUENCE");

  let validSignature = false;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    validSignature = publicKey.asymmetricKeyType === "ed25519"
      && verify(null, signingPayload(manifest), publicKey, Buffer.from(manifest.signature, "base64url"));
  } catch {
    validSignature = false;
  }
  if (!validSignature) return reject("INVALID_SIGNATURE");

  return {
    accepted: true,
    nextState: {
      projectId: manifest.projectId,
      schemaMajor: manifest.schemaMajor,
      publishSequence: manifest.publishSequence,
    },
  };
}
