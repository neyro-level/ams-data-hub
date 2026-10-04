export type ProjectStateErrorCode =
  | "PROJECT_STATE_ADMIN_ACCESS_DENIED"
  | "PROJECT_PUBLIC_CONTACT_ACCESS_DENIED"
  | "PROJECT_PUBLIC_CONTACT_NOT_FOUND"
  | "PROJECT_PUBLIC_CONTACT_REFERENCE_INVALID"
  | "PROJECT_PUBLIC_CONTACT_STALE";

export class ProjectStateError extends Error {
  constructor(readonly code: ProjectStateErrorCode) {
    super(code);
    this.name = "ProjectStateError";
  }
}
