import type { CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { adapterProfileRegistry } from "../domain/adapter-profile-registry.ts";

const PAGE = 200;
export type SourceSnapshotFactSink = (kind: "sources" | "inventory", records: CanonicalJsonValue[]) => void;
export interface SourceSnapshotFactScope { organizationId: string; projectId: string }
export interface SourceSnapshotInventoryFact {
  uid: string; sourceId: string; externalOfferId: string; status: string; version: number;
  normalizedHash: string; sourceHash: string; firstSeenAt: Date; lastSeenAt: Date;
  sourceCreatedAt: Date | null; sourceUpdatedAt: Date | null; missingSince: Date | null; missingGoodRuns: number;
  createdAt: Date; updatedAt: Date; approvedHeadId: string | null; approvedHeadSequence: number | null;
  factRevisionId: string | null; factRevisionSequence: number | null;
  factProfileKey: string | null; factProfileVersion: string | null;
}

/** Captures exact immutable GOOD references, never raw records/URLs/phones. */
export function createSourceSnapshotFactReader(transaction: DatabaseTransaction) {
  return {
    async capture(scope: SourceSnapshotFactScope, sink: SourceSnapshotFactSink,
      visitInventoryPage?: (rows: readonly SourceSnapshotInventoryFact[]) => Promise<void>): Promise<void> {
      const profiles = new Set<string>();
      const pinProfile = (key: string, version: string) => {
        const identity = `${key}@${version}`;
        if (!profiles.has(identity)) {
          const profile = adapterProfileRegistry.getProfile(key, version);
          sink("sources", [JSON.parse(JSON.stringify({ entityType: "profile", identity,
            configuration: profile.configuration ?? null, formatContract: profile.formatContract ?? null })) as CanonicalJsonValue]);
          profiles.add(identity);
        }
        return identity;
      };
      let after = "";
      while (true) {
        const rows = await transaction.source.findMany({
          where: { organizationId: scope.organizationId, projectId: scope.projectId, id: { gt: after } }, orderBy: { id: "asc" }, take: PAGE,
          select: { id: true, enabled: true, version: true, datasetType: true, sharingPolicy: true,
            lastGoodRevisionId: true, lastGoodRevision: { select: {
              id: true, status: true, sequence: true, sourceVersion: true, adapterKey: true, adapterVersion: true,
              profileKey: true, profileVersion: true, safetyPolicy: true, safetyPolicyVersion: true,
              normalizedContentHash: true, recordCount: true, invalidRecordCount: true, completedAt: true,
            } } },
        });
        if (!rows.length) break;
        sink("sources", rows.map((row) => {
          const revision = row.lastGoodRevision;
          if (row.lastGoodRevisionId && (!revision || revision.status !== "GOOD" || !revision.sequence)) {
            throw new Error("SNAPSHOT_INPUT_SOURCE_HEAD_INVALID");
          }
          const profileIdentity = revision ? pinProfile(revision.profileKey, revision.profileVersion) : null;
          return JSON.parse(JSON.stringify({ entityType: "source", sourceId: row.id, enabled: row.enabled, sourceVersion: row.version,
            datasetType: row.datasetType, sharingPolicy: row.sharingPolicy,
            approvedHead: revision, profileIdentity })) as CanonicalJsonValue;
        }));
        after = rows.at(-1)!.id;
      }
      sink("sources", []);
      after = "";
      while (true) {
        const rows = await transaction.$queryRaw<SourceSnapshotInventoryFact[]>(Prisma.sql`
          SELECT i."uid", i."sourceId", i."externalOfferId", i."status"::text, i."version",
            i."normalizedHash", i."sourceHash", i."firstSeenAt", i."lastSeenAt", i."sourceCreatedAt",
            i."sourceUpdatedAt", i."missingSince", i."missingGoodRuns", i."createdAt", i."updatedAt",
            h."id" AS "approvedHeadId", h."sequence" AS "approvedHeadSequence",
            fact."revisionId" AS "factRevisionId", fact."sequence" AS "factRevisionSequence",
            fact."profileKey" AS "factProfileKey", fact."profileVersion" AS "factProfileVersion"
          FROM "InventoryIdentity" i
          JOIN "Source" s ON s."id" = i."sourceId" AND s."organizationId" = i."organizationId" AND s."projectId" = i."projectId"
          LEFT JOIN "SourceRevision" h ON h."id" = s."lastGoodRevisionId" AND h."status" = 'GOOD'
            AND h."organizationId" = i."organizationId" AND h."projectId" = i."projectId" AND h."sourceId" = i."sourceId"
          LEFT JOIN LATERAL (
            SELECT r."revisionId", v."sequence", v."profileKey", v."profileVersion" FROM "SourceRevisionRecord" r JOIN "SourceRevision" v
              ON v."id" = r."revisionId" AND v."organizationId" = r."organizationId"
              AND v."projectId" = r."projectId" AND v."sourceId" = r."sourceId"
            WHERE r."organizationId" = i."organizationId" AND r."projectId" = i."projectId"
              AND r."sourceId" = i."sourceId" AND r."externalId" = i."externalOfferId"
              AND r."inventoryUid" = i."uid" AND r."recordHash" = i."normalizedHash"
              AND v."status" = 'GOOD' AND v."sequence" <= h."sequence"
            ORDER BY v."sequence" DESC LIMIT 1
          ) fact ON true
          WHERE i."organizationId" = ${scope.organizationId} AND i."projectId" = ${scope.projectId}
            AND i."uid" > ${after}
          ORDER BY i."uid" ASC LIMIT ${PAGE}
        `);
        if (!rows.length) break;
        for (const row of rows) if (row.status === "ACTIVE" && !row.factRevisionId) {
          throw new Error("SNAPSHOT_INPUT_INVENTORY_FACT_MISSING");
        }
        sink("inventory", rows.map((row) => {
          const factProfileIdentity = row.factProfileKey && row.factProfileVersion
            ? pinProfile(row.factProfileKey, row.factProfileVersion) : null;
          return JSON.parse(JSON.stringify({ ...row, factProfileIdentity })) as CanonicalJsonValue;
        }));
        if (visitInventoryPage) await visitInventoryPage(rows);
        after = rows.at(-1)!.uid;
      }
      sink("inventory", []);
    },
  };
}
