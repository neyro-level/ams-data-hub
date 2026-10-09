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
    const revisions = new Map<string, { sourceId: string; sequence: number; profileKey: string; profileVersion: string }>();
    for (const pin of expected.inventory) {
      const existing = revisions.get(pin.factRevisionId);
      if (existing && (existing.sourceId !== pin.sourceId || existing.sequence !== pin.factRevisionSequence
        || existing.profileKey !== pin.factProfileKey || existing.profileVersion !== pin.factProfileVersion)) stale();
      revisions.set(pin.factRevisionId, { sourceId: pin.sourceId, sequence: pin.factRevisionSequence,
        profileKey: pin.factProfileKey, profileVersion: pin.factProfileVersion });
    }
    // The schema bounds the complete cohort to 50k rows. Pass only copied
    // metadata as one JSON parameter and aggregate server-side so publication
    // admission is exact without one client/server round trip per 200-row page.
    const requested = JSON.stringify(expected.inventory.map((pin) => ({
      uid: pin.uid, sourceId: pin.sourceId, hash: pin.normalizedHash, revision: pin.factRevisionId,
      sequence: pin.factRevisionSequence, profile: pin.factProfileKey, version: pin.factProfileVersion,
    })));
    const rows = await transaction.$queryRaw<{
      requestedCount: number; activeCount: number; factsValid: boolean; revisionsValid: boolean;
    }[]>(Prisma.sql`
      WITH requested AS (
        SELECT * FROM jsonb_to_recordset(${requested}::jsonb) AS q(
          uid text, "sourceId" text, hash text, revision text, sequence int, profile text, version text)
      ), requested_revisions AS (
        SELECT DISTINCT revision, "sourceId", sequence, profile, version FROM requested
      ), revision_validity AS (
        SELECT NOT EXISTS (
          SELECT 1 FROM requested_revisions rv LEFT JOIN "SourceRevision" v ON v.id=rv.revision
            AND v."organizationId"=${scope.organizationId} AND v."projectId"=${scope.projectId}
            AND v."sourceId"=rv."sourceId" AND v.status='GOOD' AND v.sequence=rv.sequence
            AND v."profileKey"=rv.profile AND v."profileVersion"=rv.version
          WHERE v.id IS NULL
        ) AS valid
      ), fact_validity AS (
        SELECT count(*)::int AS "requestedCount",
          coalesce(bool_and(fact.valid IS TRUE), TRUE) AS valid
        FROM requested q LEFT JOIN LATERAL (
          SELECT TRUE AS valid FROM "InventoryIdentity" i JOIN "SourceRevisionRecord" r
            ON r."revisionId"=q.revision AND r."externalId"=i."externalOfferId"
            AND r."organizationId"=i."organizationId" AND r."projectId"=i."projectId"
            AND r."sourceId"=i."sourceId" AND r."inventoryUid"=i.uid AND r."recordHash"=q.hash
          WHERE i.uid=q.uid AND i."organizationId"=${scope.organizationId}
            AND i."projectId"=${scope.projectId} AND i."sourceId"=q."sourceId"
            AND i.status='ACTIVE' AND i."normalizedHash"=q.hash
          LIMIT 1
        ) fact ON TRUE
      ), active_cohort AS (
        SELECT count(*)::int AS count FROM "InventoryIdentity"
        WHERE "organizationId"=${scope.organizationId} AND "projectId"=${scope.projectId} AND status='ACTIVE'
      )
      SELECT f."requestedCount", a.count AS "activeCount", f.valid AS "factsValid", rv.valid AS "revisionsValid"
      FROM fact_validity f CROSS JOIN active_cohort a CROSS JOIN revision_validity rv`);
    const result = rows[0];
    if (rows.length !== 1 || !result || result.requestedCount !== expected.inventory.length
      || result.activeCount !== expected.inventory.length || !result.factsValid || !result.revisionsValid) stale();
  };
}
