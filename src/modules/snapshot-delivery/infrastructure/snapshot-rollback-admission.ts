import "server-only";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { createSnapshotRollbackSourceReader } from "../../ingestion-core/server.ts";
import { createSnapshotRollbackProjectReader } from "../../project-state/server.ts";
import { createSnapshotRollbackCatalogReader } from "../../shared-catalog/server.ts";
import { createSnapshotPublicationMediaReader } from "../../media-assets/server.ts";
import type { prepareSelectedSnapshotAdmission } from "../application/snapshot-selected-admission.ts";

/** Snapshot-owned internal seam, not exported to operations. These anchors MUST
 * originate from authenticated artifacts attributed to a persisted approved
 * source capture. This alone neither authenticates source nor publishes rollback. */
export async function admitHistoricalSnapshotRollback(tx: DatabaseTransaction,
  scope: { organizationId: string; projectId: string }, anchors: ReturnType<typeof prepareSelectedSnapshotAdmission>) {
  await createSnapshotRollbackProjectReader(tx)(scope, anchors.projectAnchors, anchors.rollbackAgentContacts);
  await createSnapshotRollbackSourceReader(tx)(scope, anchors.sourceAnchors);
  await createSnapshotRollbackCatalogReader(tx)(scope, anchors.catalogAnchors);
  await createSnapshotPublicationMediaReader(tx)(scope, anchors.mediaAnchors);
}
