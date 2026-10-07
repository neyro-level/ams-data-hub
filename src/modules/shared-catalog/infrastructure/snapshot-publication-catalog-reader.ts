import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { snapshotPublicationCatalogAnchorsSchema, snapshotPublicationSubscriptionSchema,
  type SnapshotPublicationCatalogAnchors } from "../application/snapshot-publication-catalog-anchors.ts";

const PAGE = 200;
function stale(): never { throw new Error("SNAPSHOT_PUBLICATION_CATALOG_STALE"); }
function match(pins: readonly { uid: string }[], rows: readonly { uid: string }[]) {
  const key = (row: object) => JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));
  const byUid = new Map(rows.map((row) => [row.uid, key(row)]));
  if (rows.length !== pins.length || byUid.size !== rows.length || pins.some((pin) => byUid.get(pin.uid) !== key(pin))) stale();
}
/** Plain selected-metadata reads in caller-owned RC under global -> publication locks. */
export function createSnapshotPublicationCatalogReader(tx: DatabaseTransaction) {
  return async (scope: { organizationId: string; projectId: string }, raw: SnapshotPublicationCatalogAnchors): Promise<void> => {
    const parsed = snapshotPublicationCatalogAnchorsSchema.safeParse(raw);
    if (!parsed.success || parsed.data.projectId !== scope.projectId) throw new Error("SNAPSHOT_PUBLICATION_CATALOG_ANCHORS_INVALID");
    const pins = parsed.data;
    const access = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT snapshot_publication_scope(${scope.organizationId}, ${scope.projectId}) AS allowed`);
    if (access.length !== 1 || !access[0]!.allowed) throw new Error("SNAPSHOT_PUBLICATION_CATALOG_ACCESS_DENIED");
    const subscription = await tx.projectCatalogSubscription.findUnique({ where: { organizationId_projectId: scope },
      select: { mode: true, version: true, cities: { take: 101, select: { cityUid: true } },
        selections: { take: 501, select: { developmentUid: true, decision: true } } } });
    if (!subscription) stale();
    const current = snapshotPublicationSubscriptionSchema.safeParse({ mode: subscription.mode, version: subscription.version,
      cityUids: subscription.cities.map((row) => row.cityUid), selections: subscription.selections });
    if (!current.success || JSON.stringify(current.data) !== JSON.stringify(pins.subscription)) stale();
    for (let offset = 0; offset < pins.developers.length; offset += PAGE) {
      const page = pins.developers.slice(offset, offset + PAGE);
      match(page, await tx.developer.findMany({ where: { uid: { in: page.map((row) => row.uid) } }, take: PAGE + 1,
        select: { uid: true, lifecycle: true, mergedIntoUid: true } }));
    }
    for (let offset = 0; offset < pins.developments.length; offset += PAGE) {
      const page = pins.developments.slice(offset, offset + PAGE);
      match(page, await tx.development.findMany({ where: { uid: { in: page.map((row) => row.uid) } }, take: PAGE + 1,
        select: { uid: true, lifecycle: true, mergedIntoUid: true, developerUid: true, cityUid: true, districtUid: true } }));
    }
    for (let offset = 0; offset < pins.buildings.length; offset += PAGE) {
      const page = pins.buildings.slice(offset, offset + PAGE);
      match(page, await tx.building.findMany({ where: { uid: { in: page.map((row) => row.uid) } }, take: PAGE + 1,
        select: { uid: true, lifecycle: true, mergedIntoUid: true, developmentUid: true } }));
    }
  };
}
