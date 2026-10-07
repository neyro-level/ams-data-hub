import "server-only";
import type { ObjectStorage } from "../../../platform/storage/object-storage.ts";
import { createCapturedMediaVerifier } from "../../media-assets/server.ts";
import type { SnapshotBuildInputReceipt } from "../application/snapshot-build-input.ts";
import { prepareSnapshotMediaProjectionInput, projectSnapshotMedia } from "../application/snapshot-media-projector.ts";
import { prepareSnapshotPublicationMediaPins, selectSnapshotPublicationMediaAnchors } from "../../media-assets/index.ts";
import type { SnapshotCatalogSelection } from "../application/snapshot-catalog-selection.ts";

/** Internal persisted receipt + server-selected project-owned storage. Call only outside DB transactions. */
export function createSnapshotMediaProjectionServer(bound: { organizationId: string; projectId: string; storage: Pick<ObjectStorage, "head"> }) {
  const verify = createCapturedMediaVerifier(bound);
  const { organizationId, projectId } = bound;
  return async (input: SnapshotBuildInputReceipt, selection?: SnapshotCatalogSelection) => {
    if (input.organizationId !== organizationId || input.projectId !== projectId) throw new Error("SNAPSHOT_MEDIA_SCOPE_INVALID");
    const prepared = prepareSnapshotMediaProjectionInput(input, selection);
    const pins = prepareSnapshotPublicationMediaPins(prepared); // Copy provenance before the first HEAD.
    const verified = await verify({ organizationId: input.organizationId, projectId: input.projectId }, prepared.candidates.map((row) => row.candidate));
    const mediaAnchors = selectSnapshotPublicationMediaAnchors(projectId, pins, verified.attachments);
    return { ...projectSnapshotMedia(verified.attachments), mediaAnchors, diagnostics: verified.diagnostics };
  };
}
