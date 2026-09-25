export type ProjectRegistryErrorCode =
  | "PROJECT_REGISTRY_ADMIN_ACCESS_DENIED"
  | "PROJECT_NOT_FOUND_OR_STALE"
  | "PROJECT_SLUG_CONFLICT"
  | "PROJECT_REFERENCE_INVALID";

export class ProjectRegistryError extends Error {
  constructor(readonly code: ProjectRegistryErrorCode) {
    super(code);
    this.name = "ProjectRegistryError";
  }
}
