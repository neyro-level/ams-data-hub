import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { PUBLICATION_MEDIA_TRIM_CHARACTERS, publicationMediaMetadataKey, snapshotPublicationMediaAnchorsSchema,
  type SnapshotPublicationMediaAnchors } from "../application/snapshot-publication-media-anchors.ts";

const PAGE = 200;
function stale(): never { throw new Error("SNAPSHOT_PUBLICATION_MEDIA_STALE"); }
function unique<T extends { id: string }>(values: readonly T[]): T[] {
  const found = new Map<string, T>();
  for (const row of values) {
    const old = found.get(row.id); if (old && publicationMediaMetadataKey(old) !== publicationMediaMetadataKey(row)) stale();
    found.set(row.id, row);
  }
  return [...found.values()];
}
function match(pins: readonly { id: string }[], rows: readonly { id: string }[]) {
  const byId = new Map(rows.map((row) => [row.id, publicationMediaMetadataKey(row)]));
  if (rows.length !== pins.length || byId.size !== rows.length || pins.some((row) => byId.get(row.id) !== publicationMediaMetadataKey(row))) stale();
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
    for (let offset = 0; offset < assets.length; offset += PAGE) {
      const page = assets.slice(offset, offset + PAGE);
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id, sha256, "storageKey", "contentType", "byteSize", "rightsBasis",
          NULLIF(btrim(license, ${PUBLICATION_MEDIA_TRIM_CHARACTERS}), '') IS NOT NULL AS "hasLicense"
        FROM "MediaAsset" WHERE "organizationId"=${scope.organizationId} AND "projectId"=${scope.projectId}
          AND id IN (${Prisma.join(page.map((row) => row.id))}) LIMIT ${PAGE + 1}`);
      match(page, rows);
    }
    for (let offset = 0; offset < relations.length; offset += PAGE) {
      const page = relations.slice(offset, offset + PAGE);
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id, "sourceId", "sourceRevisionId", "entityType", "entityUid", kind, "assetId",
          encode(sha256(convert_to("canonicalSourceUrl", 'UTF8')), 'hex') AS "canonicalUrlHash",
          status IN ('MIRRORED','WARNING') AND "mirroredAt" IS NOT NULL AS eligible
        FROM "MediaSource" WHERE "organizationId"=${scope.organizationId} AND "projectId"=${scope.projectId}
          AND id IN (${Prisma.join(page.map((row) => row.id))}) LIMIT ${PAGE + 1}`);
      match(page.map((row) => ({ ...row, eligible: true })), rows);
    }
    for (let offset = 0; offset < observations.length; offset += PAGE) {
      const page = observations.slice(offset, offset + PAGE);
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id, "sourceId", "developmentUid", "buildingUid", kind, position, "rightsBasis",
          encode(sha256(convert_to("canonicalSourceUrl", 'UTF8')), 'hex') AS "canonicalUrlHash",
          NULLIF(btrim(license, ${PUBLICATION_MEDIA_TRIM_CHARACTERS}), '') IS NOT NULL AS "hasLicense",
          NULLIF(btrim(attribution, ${PUBLICATION_MEDIA_TRIM_CHARACTERS}), '') IS NOT NULL AS "hasAttribution"
        FROM "SharedMediaAsset" WHERE "organizationId"=${scope.organizationId} AND "projectId"=${scope.projectId}
          AND id IN (${Prisma.join(page.map((row) => row.id))}) LIMIT ${PAGE + 1}`);
      match(page, rows);
    }
  };
}
