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
    // The exact pin queries below validate every expected uid/source/hash/fact.
    // One count cut additionally detects any active identity omitted by the
    // signed anchors, without a redundant 200-row scan of the same identities.
    if (await transaction.inventoryIdentity.count({ where: { ...scope, status: "ACTIVE" } }) !== expected.inventory.length) stale();
    const revisions = new Map<string, { sourceId: string; sequence: number; profileKey: string; profileVersion: string }>();
    for (const pin of expected.inventory) {
      const existing = revisions.get(pin.factRevisionId);
      if (existing && (existing.sourceId !== pin.sourceId || existing.sequence !== pin.factRevisionSequence
        || existing.profileKey !== pin.factProfileKey || existing.profileVersion !== pin.factProfileVersion)) stale();
      revisions.set(pin.factRevisionId, { sourceId: pin.sourceId, sequence: pin.factRevisionSequence,
        profileKey: pin.factProfileKey, profileVersion: pin.factProfileVersion });
    }
    const revisionPins = [...revisions].map(([id, pin]) => ({ id, ...pin }));
    for (let offset = 0; offset < revisionPins.length; offset += PAGE) {
      const pins = revisionPins.slice(offset, offset + PAGE);
      const values = pins.map((pin, index) => Prisma.sql`(${index}::int, ${pin.id}::text, ${pin.sourceId}::text,
        ${pin.sequence}::int, ${pin.profileKey}::text, ${pin.profileVersion}::text)`);
      const rows = await transaction.$queryRaw<{ index: number; found: boolean }[]>(Prisma.sql`
        WITH requested("index", revision, source, sequence, profile, version) AS (VALUES ${Prisma.join(values)})
        SELECT q."index", (v.id IS NOT NULL) AS found
        FROM requested q LEFT JOIN "SourceRevision" v ON v.id=q.revision
          AND v."organizationId"=${scope.organizationId} AND v."projectId"=${scope.projectId}
          AND v."sourceId"=q.source AND v.status='GOOD' AND v.sequence=q.sequence
          AND v."profileKey"=q.profile AND v."profileVersion"=q.version
        ORDER BY q."index"`);
      if (rows.length !== pins.length || rows.some((row, index) => row.index !== index || !row.found)) stale();
    }
    for (let offset = 0; offset < expected.inventory.length; offset += PAGE) {
      const pins = expected.inventory.slice(offset, offset + PAGE);
      const values = pins.map((pin, index) => Prisma.sql`(${index}::int, ${pin.uid}::text, ${pin.sourceId}::text,
        ${pin.normalizedHash}::text, ${pin.factRevisionId}::text)`);
      const rows = await transaction.$queryRaw<{ index: number; found: boolean }[]>(Prisma.sql`
        WITH requested("index", uid, source, hash, revision) AS (VALUES ${Prisma.join(values)})
        SELECT q."index", (i.uid IS NOT NULL AND r."externalId" IS NOT NULL) AS found
        FROM requested q LEFT JOIN "InventoryIdentity" i
          ON i."organizationId"=${scope.organizationId} AND i."projectId"=${scope.projectId}
          AND i.uid=q.uid AND i."sourceId"=q.source AND i.status='ACTIVE' AND i."normalizedHash"=q.hash
        LEFT JOIN "SourceRevisionRecord" r ON r."organizationId"=i."organizationId"
          AND r."projectId"=i."projectId" AND r."sourceId"=i."sourceId" AND r."revisionId"=q.revision
          AND r."inventoryUid"=i.uid AND r."externalId"=i."externalOfferId" AND r."recordHash"=q.hash
        ORDER BY q."index"`);
      if (rows.length !== pins.length || rows.some((row, index) => row.index !== index || !row.found)) stale();
    }
  };
}
