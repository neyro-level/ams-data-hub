export type SourceRegistryErrorCode =
  | "SOURCE_REGISTRY_ADMIN_ACCESS_DENIED"
  | "SOURCE_REGISTRY_REFERENCE_INVALID"
  | "SOURCE_REGISTRY_NOT_FOUND"
  | "SOURCE_REGISTRY_STALE"
  | "SOURCE_REGISTRY_CONFLICT";

export class SourceRegistryError extends Error {
  constructor(readonly code: SourceRegistryErrorCode) {
    super(code);
    this.name = "SourceRegistryError";
  }
}
