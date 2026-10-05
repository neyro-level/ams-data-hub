import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { unsignedSnapshotManifestV1Schema, type SnapshotComposition } from "../contracts.ts";

export function composeRollbackSnapshot(input: {
  source: SnapshotComposition;
  currentPublishSequence: number;
  generatedAt: string;
  publishedAt: string;
  keyId: string;
}): SnapshotComposition {
  if (input.currentPublishSequence < input.source.manifest.publishSequence) {
    throw new Error("SNAPSHOT_ROLLBACK_SOURCE_IS_FUTURE");
  }
  const manifest = unsignedSnapshotManifestV1Schema.parse({
    ...input.source.manifest,
    publishSequence: input.currentPublishSequence + 1,
    generatedAt: input.generatedAt,
    publishedAt: input.publishedAt,
    keyId: input.keyId,
    files: input.source.manifest.files.map((file) => ({ ...file })),
  });
  return {
    manifest,
    manifestPayload: canonicalJsonBytes(manifest as CanonicalJsonValue),
    files: input.source.files.map((file) => ({ manifest: { ...file.manifest }, body: Uint8Array.from(file.body) })),
  };
}
