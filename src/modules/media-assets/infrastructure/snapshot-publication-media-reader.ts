import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { PUBLICATION_MEDIA_TRIM_CHARACTERS, publicationMediaMetadataKey, snapshotPublicationMediaAnchorsSchema,
  type SnapshotPublicationMediaAnchors } from "../application/snapshot-publication-media-anchors.ts";

function stale(): never { throw new Error("SNAPSHOT_PUBLICATION_MEDIA_STALE"); }
function unique<T extends { id: string }>(values: readonly T[]): T[] {
  const found = new Map<string, T>();
  for (const row of values) {
    const old = found.get(row.id); if (old && publicationMediaMetadataKey(old) !== publicationMediaMetadataKey(row)) stale();
    found.set(row.id, row);
  }
  return [...found.values()];
}
function validate(result: readonly { requestedCount: number; valid: boolean }[], expected: number) {
  if (result.length !== 1 || result[0]?.requestedCount !== expected || !result[0].valid) stale();
}
/** Metadata/boolean-only reads in caller-owned RC under global -> publication locks. No object IO. */
export function createSnapshotPublicationMediaReader(tx: DatabaseTransaction) {
  return async (scope: { organizationId: string; projectId: string }, raw: SnapshotPublicationMediaAnchors): Promise<void> => {
    const parsed = snapshotPublicationMediaAnchorsSchema.safeParse(raw);
    if (!parsed.success || parsed.data.projectId !== scope.projectId) throw new Error("SNAPSHOT_PUBLICATION_MEDIA_ANCHORS_INVALID");
    const pins = parsed.data;
    const access = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT snapshot_publication_scope(${scope.organizationId}, ${scope.projectId}) AS allowed`);
    if (access.length !== 1 || !access[0]!.allowed) throw new Error("SNAPSHOT_PUBLICATION_MEDIA_ACCESS_DENIED");
    const assets = unique(pins.attachments.map((row) => row.asset));
    const relations = unique(pins.attachments.flatMap((row) => row.relation ? [row.relation] : []));
    const observations = unique(pins.attachments.flatMap((row) => row.observation ? [row.observation] : []));
    // The anchors schema bounds the complete cohort to 50k attachments. Pass
    // copied metadata as JSON and force one primary-key lookup per distinct id;
    // this keeps exact validation independent of unrelated table volume without
    // exposing private URLs or producer metadata to the application result.
    const assetRows = await tx.$queryRaw<{ requestedCount: number; valid: boolean }[]>(Prisma.sql`
      WITH requested AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(assets)}::jsonb) AS q(
          id text, sha256 text, "storageKey" text, "contentType" text, "byteSize" int,
          "rightsBasis" text, "hasLicense" boolean)
      )
      SELECT count(*)::int AS "requestedCount", coalesce(bool_and(found.valid IS TRUE), TRUE) AS valid
      FROM requested q LEFT JOIN LATERAL (
        SELECT TRUE AS valid FROM "MediaAsset" a WHERE a.id=q.id
          AND a."organizationId"=${scope.organizationId} AND a."projectId"=${scope.projectId}
          AND a.sha256=q.sha256 AND a."storageKey"=q."storageKey" AND a."contentType"=q."contentType"
          AND a."byteSize"=q."byteSize" AND a."rightsBasis"::text=q."rightsBasis"
          AND (NULLIF(btrim(a.license, ${PUBLICATION_MEDIA_TRIM_CHARACTERS}), '') IS NOT NULL)=q."hasLicense"
        LIMIT 1
      ) found ON TRUE`);
    validate(assetRows, assets.length);
    const relationRows = await tx.$queryRaw<{ requestedCount: number; valid: boolean }[]>(Prisma.sql`
      WITH requested AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(relations)}::jsonb) AS q(
          id text, "sourceId" text, "sourceRevisionId" text, "entityType" text, "entityUid" text,
          kind text, "assetId" text, "canonicalUrlHash" text)
      )
      SELECT count(*)::int AS "requestedCount", coalesce(bool_and(found.valid IS TRUE), TRUE) AS valid
      FROM requested q LEFT JOIN LATERAL (
        SELECT TRUE AS valid FROM "MediaSource" m WHERE m.id=q.id
          AND m."organizationId"=${scope.organizationId} AND m."projectId"=${scope.projectId}
          AND m."sourceId"=q."sourceId" AND m."sourceRevisionId"=q."sourceRevisionId"
          AND m."entityType"=q."entityType" AND m."entityUid"=q."entityUid" AND m.kind::text=q.kind
          AND m."assetId"=q."assetId"
          AND encode(sha256(convert_to(m."canonicalSourceUrl", 'UTF8')), 'hex')=q."canonicalUrlHash"
          AND m.status IN ('MIRRORED','WARNING') AND m."mirroredAt" IS NOT NULL
        LIMIT 1
      ) found ON TRUE`);
    validate(relationRows, relations.length);
    const observationRows = await tx.$queryRaw<{ requestedCount: number; valid: boolean }[]>(Prisma.sql`
      WITH requested AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(observations)}::jsonb) AS q(
          id text, "sourceId" text, "developmentUid" text, "buildingUid" text, kind text, position int,
          "canonicalUrlHash" text, "rightsBasis" text, "hasLicense" boolean, "hasAttribution" boolean)
      )
      SELECT count(*)::int AS "requestedCount", coalesce(bool_and(found.valid IS TRUE), TRUE) AS valid
      FROM requested q LEFT JOIN LATERAL (
        SELECT TRUE AS valid FROM "SharedMediaAsset" s WHERE s.id=q.id
          AND s."organizationId"=${scope.organizationId} AND s."projectId"=${scope.projectId}
          AND s."sourceId"=q."sourceId" AND s."developmentUid"=q."developmentUid"
          AND s."buildingUid" IS NOT DISTINCT FROM q."buildingUid" AND s.kind::text=q.kind AND s.position=q.position
          AND s."rightsBasis"::text=q."rightsBasis"
          AND encode(sha256(convert_to(s."canonicalSourceUrl", 'UTF8')), 'hex')=q."canonicalUrlHash"
          AND (NULLIF(btrim(s.license, ${PUBLICATION_MEDIA_TRIM_CHARACTERS}), '') IS NOT NULL)=q."hasLicense"
          AND (NULLIF(btrim(s.attribution, ${PUBLICATION_MEDIA_TRIM_CHARACTERS}), '') IS NOT NULL)=q."hasAttribution"
        LIMIT 1
      ) found ON TRUE`);
    validate(observationRows, observations.length);
  };
}
