import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { snapshotPublicationCatalogAnchorsSchema, type SnapshotPublicationCatalogAnchors } from "../application/snapshot-publication-catalog-anchors.ts";
import { createSnapshotPublicationCatalogReader } from "./snapshot-publication-catalog-reader.ts";

/** Selected old entities, current subscription permissions. No latest cohort or
 * new public data. Caller holds global -> publication locks in ReadCommitted. */
export function createSnapshotRollbackCatalogReader(tx: DatabaseTransaction) {
  return async (scope: { organizationId: string; projectId: string }, raw: SnapshotPublicationCatalogAnchors): Promise<void> => {
    const parsed = snapshotPublicationCatalogAnchorsSchema.safeParse(raw);
    if (!parsed.success || parsed.data.projectId !== scope.projectId) throw new Error("SNAPSHOT_ROLLBACK_CATALOG_ANCHORS_INVALID");
    const access = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`
      SELECT snapshot_publication_scope(${scope.organizationId}, ${scope.projectId}) AS allowed`);
    if (access.length !== 1 || !access[0]!.allowed) throw new Error("SNAPSHOT_ROLLBACK_CATALOG_ACCESS_DENIED");
    const subscription = await tx.projectCatalogSubscription.findUnique({ where: { organizationId_projectId: scope },
      select: { mode: true, version: true, cities: { take: 101, select: { cityUid: true } },
        selections: { take: 501, select: { developmentUid: true, decision: true } } } });
    if (!subscription) throw new Error("SNAPSHOT_ROLLBACK_CATALOG_DENIED");
    const refreshed = snapshotPublicationCatalogAnchorsSchema.safeParse({ ...parsed.data, subscription: {
      mode: subscription.mode, version: subscription.version, cityUids: subscription.cities.map((row) => row.cityUid),
      selections: subscription.selections } });
    if (!refreshed.success) throw new Error("SNAPSHOT_ROLLBACK_CATALOG_DENIED");
    await createSnapshotPublicationCatalogReader(tx)(scope, refreshed.data);
  };
}
