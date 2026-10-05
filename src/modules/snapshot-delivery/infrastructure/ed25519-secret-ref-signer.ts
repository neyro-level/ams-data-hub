import "server-only";

import { createPrivateKey, sign } from "node:crypto";
import { resolveSecretRef, type SecretRef } from "../../../platform/security/secret-ref.ts";
import type { SnapshotSigner } from "../contracts.ts";

export function createEd25519SecretRefSigner(input: {
  keyId: string;
  privateKeyRef: SecretRef;
}): SnapshotSigner {
  if (!input.keyId.trim()) throw new Error("Snapshot signing keyId is required");
  return Object.freeze({
    keyId: input.keyId,
    async sign(payload: Uint8Array): Promise<Uint8Array> {
      const privateKeyPem = resolveSecretRef(input.privateKeyRef);
      const privateKey = createPrivateKey(privateKeyPem);
      if (privateKey.asymmetricKeyType !== "ed25519") {
        throw new Error("Snapshot signing key must be Ed25519");
      }
      return Uint8Array.from(sign(null, payload, privateKey));
    },
  });
}
