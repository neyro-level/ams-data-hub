export type RawArtifactRemovalAvailability = "PRESENT" | "REMOVED" | "UNKNOWN" | null;

/** Metadata classification only; never authorizes storage IO. A late receipt
 * cannot prove resurrection without a strictly post-deletion PUT intent. */
export function rawArtifactRemovalAvailability(deleted: { requestedAt: Date; completedAt: Date | null } | null,
  put: { createdAt: Date; storedAt: Date | null } | null): RawArtifactRemovalAvailability {
  if (!deleted) return null;
  if (!deleted.completedAt) throw new Error("RAW_RETENTION_JOURNAL_INVALID");
  return !put ? "REMOVED" : put.storedAt && put.createdAt > deleted.completedAt && put.storedAt >= put.createdAt
    ? "PRESENT" : put.storedAt && put.storedAt < deleted.requestedAt ? "REMOVED" : "UNKNOWN";
}
