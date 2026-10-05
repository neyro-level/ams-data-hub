export type SnapshotCompositionErrorCode =
  | "SNAPSHOT_DATASET_DUPLICATE"
  | "SNAPSHOT_DATASET_MISSING"
  | "SNAPSHOT_RECORD_DUPLICATE"
  | "SNAPSHOT_REFERENCE_BROKEN"
  | "SNAPSHOT_PROJECT_CONTACT_REQUIRED"
  | "SNAPSHOT_PRIVACY_FORBIDDEN_FIELD"
  | "SNAPSHOT_PRIVACY_RAW_HTML"
  | "SNAPSHOT_COORDINATES_INVALID";

export class SnapshotCompositionError extends Error {
  constructor(
    readonly code: SnapshotCompositionErrorCode,
    readonly path?: string,
  ) {
    super(path ? `${code}:${path}` : code);
    this.name = "SnapshotCompositionError";
  }
}
