import type { SnapshotDatasetInput } from "../contracts.ts";
import { SnapshotCompositionError } from "../domain/snapshot-error.ts";

/** Existing listing fallback flow, determined only from captured active pins. */
export function snapshotRequiresProjectContact(inventoryUids: readonly string[], eligibleBindings: ReadonlyMap<string, string>): boolean {
  return inventoryUids.some((uid) => !eligibleBindings.has(uid));
}

/** Reused at pre-IO admission and composition; a foreign contact never satisfies it. */
export function assertSnapshotProjectContact(datasets: readonly SnapshotDatasetInput[], projectId: string, required: boolean): void {
  if (required && !datasets.some((dataset) => dataset.kind === "project/contacts"
    && dataset.records.some((record) => record.key === projectId))) {
    throw new SnapshotCompositionError("SNAPSHOT_PROJECT_CONTACT_REQUIRED", projectId);
  }
}
