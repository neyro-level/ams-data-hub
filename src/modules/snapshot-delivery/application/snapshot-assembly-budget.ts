import { canonicalJsonBytes } from "@ams-data-hub/data-contracts";
import { SNAPSHOT_DATASET_KINDS, type SnapshotDatasetKind, type SnapshotRecordInput } from "../contracts.ts";
import { SNAPSHOT_INPUT_MAX_BYTES } from "./snapshot-build-input.ts";

/** Aggregate uncompressed canonical array bytes, including empty arrays and page-spanning separators. */
export class SnapshotAssemblyBudget {
  private bytes = SNAPSHOT_DATASET_KINDS.length * 2;
  private readonly counts = new Map<SnapshotDatasetKind, number>();
  constructor(private readonly limit = SNAPSHOT_INPUT_MAX_BYTES) {
    if (!Number.isSafeInteger(limit) || limit < this.bytes) throw new Error("SNAPSHOT_ASSEMBLY_LIMIT_EXCEEDED");
  }
  add(kind: SnapshotDatasetKind, records: readonly SnapshotRecordInput[]): void {
    let count = this.counts.get(kind) ?? 0;
    for (const record of records) {
      this.bytes += canonicalJsonBytes(record.value).byteLength + (count > 0 ? 1 : 0);
      if (this.bytes > this.limit) throw new Error("SNAPSHOT_ASSEMBLY_LIMIT_EXCEEDED");
      count++;
    }
    this.counts.set(kind, count);
  }
}
