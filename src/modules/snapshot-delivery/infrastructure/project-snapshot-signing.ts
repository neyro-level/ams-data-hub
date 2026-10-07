import "server-only";
import { createPublicKey } from "node:crypto";
import { z } from "zod";
import { defineSecretRef, resolveSecretRef } from "../../../platform/security/secret-ref.ts";
import type { SnapshotTrustSet } from "../contracts.ts";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const keyId = id.refine((value) => !["__proto__", "prototype", "constructor"].includes(value));
const reference = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u);
const scopeSchema = z.object({ organizationId: id, projectId: id }).strict();
const bindingSchema = scopeSchema.extend({ keyId, privateKeyRef: reference, currentKeyId: keyId,
  nextKeyId: keyId.nullable(), revokedKeyIds: z.array(keyId).max(32),
  publicKeyRefs: z.record(keyId, reference).refine((rows) => Object.keys(rows).length > 0 && Object.keys(rows).length <= 32),
}).strict();
type Environment = Readonly<Record<string, string | undefined>>;
const scopeKey = (scope: z.infer<typeof scopeSchema>) => `${scope.organizationId}/${scope.projectId}`;

/** Value-free exact-project signing registry, with no global or cross-project fallback. */
export function createProjectSnapshotSigningResolver(environment: Environment = process.env) {
  let bindings;
  try {
    const raw = environment.PROJECT_SNAPSHOT_SIGNING_BINDINGS;
    if (!raw || Buffer.byteLength(raw) > 128 * 1024) throw new Error();
    bindings = z.array(bindingSchema).min(1).max(256).parse(JSON.parse(raw));
  } catch { throw new Error("PROJECT_SNAPSHOT_SIGNING_BINDINGS_INVALID"); }
  const indexed = new Map<string, (typeof bindings)[number]>();
  for (const binding of bindings) {
    if (indexed.has(scopeKey(binding)) || ![binding.currentKeyId, binding.nextKeyId].includes(binding.keyId)
      || binding.revokedKeyIds.includes(binding.keyId) || !Object.hasOwn(binding.publicKeyRefs, binding.keyId)
      || !Object.hasOwn(binding.publicKeyRefs, binding.currentKeyId)
      || (binding.nextKeyId !== null && !Object.hasOwn(binding.publicKeyRefs, binding.nextKeyId))) {
      throw new Error("PROJECT_SNAPSHOT_SIGNING_BINDINGS_INVALID");
    }
    indexed.set(scopeKey(binding), binding);
  }
  return function resolveSnapshotSigning(rawScope: z.infer<typeof scopeSchema>) {
    const scope = scopeSchema.safeParse(rawScope);
    if (!scope.success) throw new Error("PROJECT_SNAPSHOT_SIGNING_BINDING_REQUIRED");
    const binding = indexed.get(scopeKey(scope.data));
    if (!binding) throw new Error("PROJECT_SNAPSHOT_SIGNING_BINDING_REQUIRED");
    try {
      const publicKeyPairs: [string, string][] = [];
      for (const [key, name] of Object.entries(binding.publicKeyRefs)) {
        const pem = resolveSecretRef(defineSecretRef(name), environment);
        const publicKey = createPublicKey(pem);
        if (publicKey.asymmetricKeyType !== "ed25519") throw new Error();
        publicKeyPairs.push([key, publicKey.export({ format: "pem", type: "spki" }).toString()]);
      }
      const trustSet: SnapshotTrustSet = { currentKeyId: binding.currentKeyId, nextKeyId: binding.nextKeyId,
        revokedKeyIds: [...binding.revokedKeyIds], publicKeys: Object.fromEntries(publicKeyPairs) };
      return { keyId: binding.keyId, privateKeyRef: defineSecretRef(binding.privateKeyRef), trustSet };
    } catch { throw new Error("PROJECT_SNAPSHOT_SIGNING_CONFIGURATION_INVALID"); }
  };
}
