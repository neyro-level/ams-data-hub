export const MAX_SNAPSHOT_SOURCE_REVISIONS = 10_000;

function boundedObject(value: unknown, maxProperties: number): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  let count = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key) || ++count > maxProperties) return false;
  }
  return true;
}

function boundedString(value: unknown, maxCharacters: number): boolean {
  return typeof value === "string" && value.length <= maxCharacters;
}

/** Cheap JSON-shape bounds before Zod cloning and signature canonicalization. */
export function isResourceBoundedManifest(value: unknown, maxFiles: number): boolean {
  if (!boundedObject(value, 11)) return false;
  if (!Array.isArray(value.files) || value.files.length > maxFiles) return false;
  if (!Array.isArray(value.sourceRevisions) || value.sourceRevisions.length > MAX_SNAPSHOT_SOURCE_REVISIONS) return false;
  if (!value.sourceRevisions.every((revision) => boundedString(revision, 1024))) return false;
  for (const key of ["projectId", "catalogRevision", "keyId"]) if (!boundedString(value[key], 1024)) return false;
  for (const key of ["generatedAt", "publishedAt"]) if (!boundedString(value[key], 64)) return false;
  if (!boundedString(value.signature, 4096)) return false;
  for (const key of ["schemaMajor", "schemaMinor", "publishSequence"]) if (!Number.isSafeInteger(value[key])) return false;
  return value.files.every((file: unknown) => boundedObject(file, 5)
    && boundedString(file.kind, 64) && boundedString(file.key, 512) && boundedString(file.sha256, 64)
    && Number.isSafeInteger(file.bytes) && Number.isSafeInteger(file.count));
}
