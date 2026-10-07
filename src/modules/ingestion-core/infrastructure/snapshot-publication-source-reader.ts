import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { snapshotPublicationSourceAnchorsSchema, type SnapshotPublicationSourceAnchors } from "../application/snapshot-publication-source-anchors.ts";

const PAGE = 200;
const stale = () => { throw new Error("SNAPSHOT_PUBLICATION_SOURCE_STALE"); };

/** Caller owns global -> scoped publication locks in ReadCommitted. Plain metadata SELECT only. */
export function createSnapshotPublicationSourceReader(transaction: DatabaseTransaction) {
  return async (scope: { organizationId: string; projectId: string }, raw: SnapshotPublicationSourceAnchors): Promise<void> => {
    const parsed = snapshotPublicationSourceAnchorsSchema.safeParse(raw);
    if (!parsed.success) throw new Error("SNAPSHOT_PUBLICATION_SOURCE_ANCHORS_INVALID");
    const expected = parsed.data;
    const access = await transaction.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`
      SELECT snapshot_publication_scope(${scope.organizationId}, ${scope.projectId}) AS allowed`);
    if (access.length !== 1 || !access[0]!.allowed) throw new Error("SNAPSHOT_PUBLICATION_SOURCE_ACCESS_DENIED");
    const sources = new Map(expected.sources.map((row) => [row.sourceId, row]));
    let after = ""; let count = 0;
    while (true) {
      const rows = await transaction.source.findMany({ where: { ...scope, id: { gt: after } },
        orderBy: { id: "asc" }, take: PAGE, select: { id: true, datasetType: true, sharingPolicy: true,
          lastGoodRevisionId: true, lastGoodRevision: { select: { id: true, status: true,
            sequence: true, normalizedContentHash: true } } } });
      if (!rows.length) break;
      count += rows.length; if (count > sources.size) stale();
      for (const row of rows) {
        const pin = sources.get(row.id); if (!pin || row.datasetType !== pin.datasetType || row.sharingPolicy !== pin.sharingPolicy) stale();
        const approved = pin!.approvedHead; const current = row.lastGoodRevision;
        if (!approved ? row.lastGoodRevisionId !== null || current !== null
          : !current || current.status !== "GOOD" || row.lastGoodRevisionId !== approved.id
            || current.id !== approved.id || current.sequence !== approved.sequence
            || current.normalizedContentHash !== approved.normalizedContentHash) stale();
      }
      after = rows.at(-1)!.id;
    }
    if (count !== sources.size) stale();
    const inventory = new Map(expected.inventory.map((row) => [row.uid, row]));
    after = ""; count = 0;
    while (true) {
      const rows = await transaction.inventoryIdentity.findMany({ where: { ...scope, status: "ACTIVE", uid: { gt: after } },
        orderBy: { uid: "asc" }, take: PAGE, select: { uid: true, sourceId: true, normalizedHash: true } });
      if (!rows.length) break;
      count += rows.length; if (count > inventory.size) stale();
      for (const row of rows) {
        const pin = inventory.get(row.uid);
        if (!pin || row.sourceId !== pin.sourceId || row.normalizedHash !== pin.normalizedHash) stale();
      }
      after = rows.at(-1)!.uid;
    }
    if (count !== inventory.size) stale();
    for (let offset = 0; offset < expected.inventory.length; offset += PAGE) {
      const pins = expected.inventory.slice(offset, offset + PAGE);
      const values = pins.map((pin, index) => Prisma.sql`(${index}::int, ${pin.uid}::text, ${pin.sourceId}::text,
        ${pin.normalizedHash}::text, ${pin.factRevisionId}::text, ${pin.factRevisionSequence}::int,
        ${pin.factProfileKey}::text, ${pin.factProfileVersion}::text)`);
      const rows = await transaction.$queryRaw<{ index: number; found: boolean }[]>(Prisma.sql`
        WITH requested("index", uid, source, hash, revision, sequence, profile, version) AS (VALUES ${Prisma.join(values)})
        SELECT q."index", (i.uid IS NOT NULL AND v.id IS NOT NULL AND r."externalId" IS NOT NULL) AS found
        FROM requested q LEFT JOIN "InventoryIdentity" i
          ON i."organizationId"=${scope.organizationId} AND i."projectId"=${scope.projectId}
          AND i.uid=q.uid AND i."sourceId"=q.source AND i.status='ACTIVE' AND i."normalizedHash"=q.hash
        LEFT JOIN "SourceRevision" v ON v.id=q.revision AND v."organizationId"=${scope.organizationId}
          AND v."projectId"=${scope.projectId} AND v."sourceId"=q.source AND v.status='GOOD'
          AND v.sequence=q.sequence AND v."profileKey"=q.profile AND v."profileVersion"=q.version
        LEFT JOIN "SourceRevisionRecord" r ON r."organizationId"=i."organizationId"
          AND r."projectId"=i."projectId" AND r."sourceId"=i."sourceId" AND r."revisionId"=v.id
          AND r."inventoryUid"=i.uid AND r."externalId"=i."externalOfferId" AND r."recordHash"=q.hash
        ORDER BY q."index"`);
      if (rows.length !== pins.length || rows.some((row, index) => row.index !== index || !row.found)) stale();
    }
  };
}
