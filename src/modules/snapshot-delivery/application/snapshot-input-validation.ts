import {
  SNAPSHOT_INPUT_PROJECTOR_VERSION, SNAPSHOT_INPUT_SCHEMA_VERSION,
  SnapshotInputPartsBuilder, snapshotBuildInputDigest, snapshotInputHash,
  type SnapshotBuildInputReceipt, type SnapshotInputPart,
} from "./snapshot-build-input.ts";

/** Internal persisted input, not an authentication boundary for request JSON. */
export function validateSnapshotInput(input: SnapshotBuildInputReceipt): SnapshotInputPart[] {
  if (input.inputSchemaVersion !== SNAPSHOT_INPUT_SCHEMA_VERSION
    || input.projectorVersion !== SNAPSHOT_INPUT_PROJECTOR_VERSION
    || !Number.isSafeInteger(input.publishSequence) || input.publishSequence <= 0
    || !Number.isSafeInteger(input.schemaMinor) || input.schemaMinor < 0
    || !Number.isSafeInteger(input.projectStateRevision) || input.projectStateRevision <= 0
    || !(input.capturedAt instanceof Date) || !Number.isFinite(input.capturedAt.getTime())) {
    throw new Error("SNAPSHOT_INPUT_INVALID");
  }
  const builder = new SnapshotInputPartsBuilder();
  for (const part of input.parts) builder.add(part.kind, part.payload);
  const owned = builder.finish();
  if (owned.length !== input.parts.length || owned.some((part, index) => {
    const original = input.parts[index]!;
    return part.kind !== original.kind || part.partIndex !== original.partIndex
      || part.payloadHash !== original.payloadHash;
  }) || snapshotBuildInputDigest(input) !== input.inputHash
    || snapshotInputHash(owned.filter((part) => part.kind === "catalog")
      .map(({ partIndex, payloadHash }) => ({ partIndex, payloadHash }))) !== input.catalogRevision) {
    throw new Error("SNAPSHOT_INPUT_INVALID");
  }
  return owned;
}
