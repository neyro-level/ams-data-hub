import "server-only";
import { createPublicKey } from "node:crypto";
import { z } from "zod";
import { defineSecretRef, resolveSecretRef } from "../../../platform/security/secret-ref.ts";
import type { SnapshotTrustSet } from "../contracts.ts";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const keyId = id.refine((value) => !["__proto__", "prototype", "constructor"].includes(value));
const reference = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u);
const scopeSchema = z.object({ organizationId: id, projectId: id }).strict();
// Reuse the existing registry. Signing fields may be present but are neither
// required nor resolved: selected PUBLISH has no signing capability.
const bindingSchema = scopeSchema.extend({ keyId: keyId.optional(), privateKeyRef: reference.optional(),
  currentKeyId: keyId, nextKeyId: keyId.nullable(), revokedKeyIds: z.array(keyId).max(32),
  publicKeyRefs: z.record(keyId, reference).refine((rows) => Object.keys(rows).length > 0 && Object.keys(rows).length <= 32),
}).strict();
type Environment = Readonly<Record<string, string | undefined>>;
const scopeKey = (scope: z.infer<typeof scopeSchema>) => `${scope.organizationId}/${scope.projectId}`;

function readRegistry(environment: Environment) {
  try {
    const raw = environment.PROJECT_SNAPSHOT_SIGNING_BINDINGS;
    if (!raw || Buffer.byteLength(raw) > 128 * 1024) throw new Error();
    const rows = z.array(bindingSchema).min(1).max(256).parse(JSON.parse(raw));
    const indexed = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (indexed.has(scopeKey(row)) || !Object.hasOwn(row.publicKeyRefs, row.currentKeyId)
        || (row.nextKeyId !== null && !Object.hasOwn(row.publicKeyRefs, row.nextKeyId))) throw new Error();
      indexed.set(scopeKey(row), row);
    }
    return indexed;
  } catch { throw new Error("PROJECT_SNAPSHOT_TRUST_BINDINGS_INVALID"); }
}

/** Validate value-free registry before startup; resolve PUBLIC keys lazily.
 * Re-read policy each call so the final cut sees revocation/config rotation. */
export function createProjectSnapshotTrustResolver(environment: Environment = process.env) {
  readRegistry(environment);
  return (rawScope: z.infer<typeof scopeSchema>): SnapshotTrustSet => {
    const scope = scopeSchema.safeParse(rawScope);
    if (!scope.success) throw new Error("PROJECT_SNAPSHOT_TRUST_BINDING_REQUIRED");
    const binding = readRegistry(environment).get(scopeKey(scope.data));
    if (!binding) throw new Error("PROJECT_SNAPSHOT_TRUST_BINDING_REQUIRED");
    try {
      const publicKeys = Object.fromEntries(Object.entries(binding.publicKeyRefs).map(([key, name]) => {
        const pem = resolveSecretRef(defineSecretRef(name), environment);
        if (!pem.trimStart().startsWith("-----BEGIN PUBLIC KEY-----")) throw new Error();
        const publicKey = createPublicKey(pem);
        if (publicKey.asymmetricKeyType !== "ed25519") throw new Error();
        return [key, publicKey.export({ format: "pem", type: "spki" }).toString()];
      }));
      return { currentKeyId: binding.currentKeyId, nextKeyId: binding.nextKeyId,
        revokedKeyIds: [...binding.revokedKeyIds], publicKeys };
    } catch { throw new Error("PROJECT_SNAPSHOT_TRUST_CONFIGURATION_INVALID"); }
  };
}
