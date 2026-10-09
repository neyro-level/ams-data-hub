import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";

export interface RawRetentionCapturedSourceHead { sourceId: string; revisionId: string; sequence: number }
export interface RawRetentionCapturedInventoryPin {
  uid: string; sourceId: string; externalOfferId: string; normalizedHash: string; sourceHash: string;
  factRevisionId: string; factRevisionSequence: number; approvedHeadId: string; approvedHeadSequence: number;
}

/** Ingestion owns the meaning of GOOD/provenance. Validate captured metadata,
 * not current mutable heads, and never return raw records/private payloads. */
export function createRawRetentionSnapshotProvenanceValidator(tx: DatabaseTransaction) {
  return {
    async validate(scope: { organizationId: string; projectId: string },
      sources: readonly RawRetentionCapturedSourceHead[], inventory: readonly RawRetentionCapturedInventoryPin[]) {
      const access = await tx.$queryRaw<{ allowed: boolean; isolation: string }[]>(Prisma.sql`
        SELECT public.raw_artifact_retention_scope(${scope.organizationId},${scope.projectId}) AS allowed,
          current_setting('transaction_isolation') AS isolation`);
      if (access.length !== 1 || access[0]!.allowed !== true) throw new Error("RAW_RETENTION_ACCESS_DENIED");
      if (access[0]!.isolation !== "read committed") throw new Error("RAW_RETENTION_FRESH_CUT_REQUIRED");
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0))::text`);
      if (sources.length > 50_000 || inventory.length > 50_000) return false;
      // Several protected roots may pin different heads of the same Source.
      const ids = [...new Set(sources.map((row) => row.revisionId))];
      const revisions = await tx.sourceRevision.findMany({ where: { ...scope, id: { in: ids } },
        select: { id: true, sourceId: true, status: true, sequence: true } });
      const byId = new Map(revisions.map((row) => [row.id, row]));
      for (const pin of sources) {
        const revision = byId.get(pin.revisionId);
        if (!revision || revision.status !== "GOOD" || revision.sourceId !== pin.sourceId || revision.sequence !== pin.sequence) return false;
      }
      for (let start = 0; start < inventory.length; start += 200) {
        const page = inventory.slice(start, start + 200);
        const rows = await tx.$queryRaw<{ invalid: bigint }[]>(Prisma.sql`
          SELECT count(*) AS invalid
          FROM jsonb_to_recordset(${JSON.stringify(page)}::jsonb) AS p(uid text,"sourceId" text,"externalOfferId" text,
            "normalizedHash" text,"sourceHash" text,"factRevisionId" text,"factRevisionSequence" integer,
            "approvedHeadId" text,"approvedHeadSequence" integer)
          WHERE NOT EXISTS (
            SELECT 1 FROM public."SourceRevision" h
            JOIN public."SourceRevision" f ON f."organizationId"=h."organizationId" AND f."projectId"=h."projectId"
              AND f."sourceId"=h."sourceId" AND f.id=p."factRevisionId" AND f.sequence=p."factRevisionSequence" AND f.status='GOOD'
            JOIN public."SourceRevisionRecord" r ON r."organizationId"=f."organizationId" AND r."projectId"=f."projectId"
              AND r."sourceId"=f."sourceId" AND r."revisionId"=f.id
              AND r."inventoryUid"=p.uid AND r."externalId"=p."externalOfferId" AND r."recordHash"=p."normalizedHash"
            WHERE h."organizationId"=${scope.organizationId} AND h."projectId"=${scope.projectId} AND h."sourceId"=p."sourceId"
              AND h.id=p."approvedHeadId" AND h.sequence=p."approvedHeadSequence" AND h.status='GOOD' AND f.sequence<=h.sequence
              AND EXISTS (SELECT 1 FROM public."SourceRevision" v
                JOIN public."SourceRevisionRecord" vr ON vr."organizationId"=v."organizationId" AND vr."projectId"=v."projectId"
                  AND vr."sourceId"=v."sourceId" AND vr."revisionId"=v.id
                WHERE v."organizationId"=h."organizationId" AND v."projectId"=h."projectId" AND v."sourceId"=h."sourceId"
                  AND v.status='GOOD' AND v.sequence<=h.sequence AND v."rawArtifactHash"=p."sourceHash"
                  AND vr."inventoryUid"=p.uid AND vr."externalId"=p."externalOfferId" AND vr."recordHash"=p."normalizedHash")
          )`);
        if (rows.length !== 1 || rows[0]!.invalid !== 0n) return false;
      }
      return true;
    },
  };
}
