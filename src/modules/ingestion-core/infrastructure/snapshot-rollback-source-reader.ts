import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { snapshotPublicationSourceAnchorsSchema, type SnapshotPublicationSourceAnchors } from "../application/snapshot-publication-source-anchors.ts";

const PAGE = 200;
const denied = (): never => { throw new Error("SNAPSHOT_ROLLBACK_SOURCE_DENIED"); };

/** Historical attribution + current permissions, NOT current-head/cohort equality.
 * Internal approved-capture pins only; caller owns global -> publication locks in RC. */
export function createSnapshotRollbackSourceReader(tx: DatabaseTransaction) {
  return async (scope: { organizationId: string; projectId: string }, raw: SnapshotPublicationSourceAnchors): Promise<void> => {
    const parsed = snapshotPublicationSourceAnchorsSchema.safeParse(raw);
    if (!parsed.success) throw new Error("SNAPSHOT_ROLLBACK_SOURCE_ANCHORS_INVALID");
    const access = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`
      SELECT snapshot_publication_scope(${scope.organizationId}, ${scope.projectId}) AS allowed`);
    if (access.length !== 1 || !access[0]!.allowed) throw new Error("SNAPSHOT_ROLLBACK_SOURCE_ACCESS_DENIED");
    const pins = parsed.data;
    for (let offset = 0; offset < pins.sources.length; offset += PAGE) {
      const page = pins.sources.slice(offset, offset + PAGE);
      const rows = await tx.source.findMany({ where: { ...scope, id: { in: page.map((pin) => pin.sourceId) } }, take: PAGE + 1,
        select: { id: true, datasetType: true, sharingPolicy: true } });
      const found = new Map(rows.map((row) => [row.id, row]));
      if (rows.length !== page.length || found.size !== rows.length) denied();
      for (const pin of page) {
        const row = found.get(pin.sourceId);
        if (!row || row.datasetType !== pin.datasetType || row.sharingPolicy !== pin.sharingPolicy) denied();
      }
      const heads = page.flatMap((pin) => pin.approvedHead ? [{ sourceId: pin.sourceId, ...pin.approvedHead }] : []);
      if (!heads.length) continue;
      const approved = await tx.sourceRevision.findMany({ where: { ...scope, status: "GOOD", OR: heads }, take: PAGE + 1,
        select: { id: true } });
      if (approved.length !== heads.length || new Set(approved.map((row) => row.id)).size !== heads.length) denied();
    }
    for (let offset = 0; offset < pins.inventory.length; offset += PAGE) {
      const page = pins.inventory.slice(offset, offset + PAGE);
      const values = page.map((pin, index) => Prisma.sql`(${index}::int, ${pin.uid}::text, ${pin.sourceId}::text,
        ${pin.normalizedHash}::text, ${pin.factRevisionId}::text, ${pin.factRevisionSequence}::int,
        ${pin.factProfileKey}::text, ${pin.factProfileVersion}::text)`);
      const rows = await tx.$queryRaw<{ index: number; found: boolean }[]>(Prisma.sql`
        WITH requested("index", uid, source, hash, revision, sequence, profile, version) AS (VALUES ${Prisma.join(values)})
        SELECT q."index", (i.uid IS NOT NULL AND v.id IS NOT NULL AND r."externalId" IS NOT NULL) AS found
        FROM requested q LEFT JOIN "InventoryIdentity" i
          ON i."organizationId"=${scope.organizationId} AND i."projectId"=${scope.projectId}
          AND i.uid=q.uid AND i."sourceId"=q.source AND i.status='ACTIVE'
        LEFT JOIN "SourceRevision" v ON v.id=q.revision AND v."organizationId"=${scope.organizationId}
          AND v."projectId"=${scope.projectId} AND v."sourceId"=q.source AND v.status='GOOD'
          AND v.sequence=q.sequence AND v."profileKey"=q.profile AND v."profileVersion"=q.version
        LEFT JOIN "SourceRevisionRecord" r ON r."organizationId"=i."organizationId"
          AND r."projectId"=i."projectId" AND r."sourceId"=i."sourceId" AND r."revisionId"=v.id
          AND r."inventoryUid"=i.uid AND r."externalId"=i."externalOfferId" AND r."recordHash"=q.hash
        ORDER BY q."index"`);
      if (rows.length !== page.length || rows.some((row, index) => row.index !== index || !row.found)) denied();
    }
  };
}
