import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { defineSecretRef, resolveSecretRef } from "../security/secret-ref.ts";
import { createTimewebS3ObjectStorage, type TimewebS3ObjectStorageOptions } from "./timeweb-s3-object-storage.ts";
import type { ObjectStorage, StreamingObjectStorage, BoundedObjectStorage } from "./object-storage.ts";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const reference = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u);
const scopeSchema = z.object({ organizationId: id, projectId: id }).strict();
const bindingSchema = scopeSchema.extend({ bucketRef: reference, endpointRef: reference, regionRef: reference,
  accessKeyIdRef: reference, secretAccessKeyRef: reference }).strict();
export type ProjectStorageScope = z.infer<typeof scopeSchema>;
export type ProjectObjectStorage = ObjectStorage & StreamingObjectStorage & BoundedObjectStorage;
type Environment = Readonly<Record<string, string | undefined>>;
const scopeKey = (scope: ProjectStorageScope) => `${scope.organizationId}/${scope.projectId}`;

/** Value-free bindings only. A global S3 environment is never an implicit fleet binding. */
export function createProjectObjectStorageResolver(environment: Environment = process.env,
  createStorage: (options: TimewebS3ObjectStorageOptions) => ProjectObjectStorage = createTimewebS3ObjectStorage) {
  let bindings;
  try {
    const raw = environment.PROJECT_STORAGE_BINDINGS;
    if (!raw || Buffer.byteLength(raw) > 128 * 1024) throw new Error();
    bindings = z.array(bindingSchema).min(1).max(256).parse(JSON.parse(raw));
  } catch { throw new Error("PROJECT_STORAGE_BINDINGS_INVALID"); }
  const indexed = new Map<string, (typeof bindings)[number]>();
  const accessReferences = new Set<string>();
  for (const binding of bindings) {
    if (indexed.has(scopeKey(binding)) || accessReferences.has(binding.accessKeyIdRef)) throw new Error("PROJECT_STORAGE_BINDINGS_INVALID");
    indexed.set(scopeKey(binding), binding); accessReferences.add(binding.accessKeyIdRef);
  }
  const cache = new Map<string, ProjectObjectStorage>();
  const bucketOwners = new Map<string, string>(); const credentialOwners = new Map<string, string>();
  return function resolveProjectStorage(rawScope: ProjectStorageScope): ProjectObjectStorage {
    const parsed = scopeSchema.safeParse(rawScope);
    if (!parsed.success) throw new Error("PROJECT_STORAGE_BINDING_REQUIRED");
    const key = scopeKey(parsed.data); const binding = indexed.get(key);
    if (!binding) throw new Error("PROJECT_STORAGE_BINDING_REQUIRED");
    const cached = cache.get(key); if (cached) return cached;
    try {
      // Match the adapter's trimming contract before isolation checks and register
      // the actual normalized secret with the existing redaction resolver.
      const resolve = (name: string) => resolveSecretRef(defineSecretRef(name), { [name]: environment[name]?.trim() });
      const options = { bucket: resolve(binding.bucketRef), endpoint: resolve(binding.endpointRef), region: resolve(binding.regionRef),
        credentials: { accessKeyId: resolve(binding.accessKeyIdRef), secretAccessKey: resolve(binding.secretAccessKeyRef) } };
      const endpoint = new URL(options.endpoint).origin;
      const bucketKey = `${endpoint}/${options.bucket}`;
      const credentialKey = createHash("sha256").update(options.credentials.accessKeyId).digest("hex");
      if ((bucketOwners.has(bucketKey) && bucketOwners.get(bucketKey) !== key)
        || (credentialOwners.has(credentialKey) && credentialOwners.get(credentialKey) !== key)) {
        throw new Error();
      }
      const storage = createStorage(options);
      bucketOwners.set(bucketKey, key); credentialOwners.set(credentialKey, key); cache.set(key, storage);
      return storage;
    } catch { throw new Error("PROJECT_STORAGE_CONFIGURATION_INVALID"); }
  };
}
