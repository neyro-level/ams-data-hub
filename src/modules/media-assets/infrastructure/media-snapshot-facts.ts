import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { createMediaKey } from "../../../platform/storage/object-storage.ts";
import { MAX_MEDIA_BYTES, MEDIA_CONTENT_TYPES } from "../contracts.ts";
import { canonicalizeMediaSourceUrl } from "../domain/media-source.ts";

export interface InventorySnapshotMediaPin {
  sourceId: string; inventoryUid: string; externalOfferId: string; normalizedHash: string;
  factRevisionId: string; factRevisionSequence: number; approvedHeadId: string; approvedHeadSequence: number;
}
export interface MediaSnapshotFactScope { organizationId: string; projectId: string }
export type MediaSnapshotFactSink = (kind: "media", rows: CanonicalJsonValue[]) => void;
const invalid = () => new Error("SNAPSHOT_INPUT_MEDIA_PIN_INVALID");
const json = (row: object): CanonicalJsonValue => JSON.parse(JSON.stringify(row)) as CanonicalJsonValue;
const assetSelect = { id: true, organizationId: true, projectId: true, sha256: true, storageKey: true,
  contentType: true, byteSize: true, rightsBasis: true, license: true } as const;
type CapturedAsset = Prisma.MediaAssetGetPayload<{ select: typeof assetSelect }>;
function eligibleAsset(scope: MediaSnapshotFactScope, asset: CapturedAsset | null): asset is CapturedAsset {
  return Boolean(asset && asset.organizationId === scope.organizationId && asset.projectId === scope.projectId
    && /^[a-f0-9]{64}$/u.test(asset.sha256) && asset.storageKey === createMediaKey(asset.sha256)
    && MEDIA_CONTENT_TYPES.some((type) => type === asset.contentType) && asset.byteSize > 0 && asset.byteSize <= MAX_MEDIA_BYTES
    && (asset.rightsBasis !== "LICENSED" || asset.license?.trim()));
}
function assetFact(asset: CapturedAsset) {
  return { id: asset.id, sha256: asset.sha256, storageKey: asset.storageKey, contentType: asset.contentType,
    byteSize: asset.byteSize, rightsBasis: asset.rightsBasis, hasLicense: Boolean(asset.license?.trim()) };
}

/** DB-only candidate capture. All object checks/public projection happen later. */
export function createMediaSnapshotFactReader(transaction: DatabaseTransaction, sink: MediaSnapshotFactSink) {
  let buffer: CanonicalJsonValue[] = [];
  let bytes = 2;
  let emitted = false;
  let failed = false;
  let finished = false;
  function flush() {
    if (!buffer.length) return;
    sink("media", buffer);
    emitted = true; buffer = []; bytes = 2;
  }
  function append(row: CanonicalJsonValue) {
    const length = canonicalJsonBytes(row).byteLength;
    if (length + 2 > 1048576) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
    if (buffer.length >= 200 || bytes + length + Number(buffer.length > 0) > 1048576) flush();
    bytes += length + Number(buffer.length > 0); buffer.push(row);
  }
  async function images(scope: MediaSnapshotFactScope, pin: InventorySnapshotMediaPin,
    revisionId: string, maxSequence: number, expectedHash: string | null): Promise<string[] | null> {
    const rows = await transaction.$queryRaw<{ images: unknown }[]>(Prisma.sql`
      SELECT CASE WHEN octet_length((r."payload" #> '{draft,imageUrls}')::text) <= 1048576
        THEN r."payload" #> '{draft,imageUrls}' ELSE NULL END AS images
      FROM "SourceRevisionRecord" r JOIN "SourceRevision" v ON v."id" = r."revisionId"
        AND v."organizationId" = r."organizationId" AND v."projectId" = r."projectId" AND v."sourceId" = r."sourceId"
      WHERE r."organizationId" = ${scope.organizationId} AND r."projectId" = ${scope.projectId}
        AND r."sourceId" = ${pin.sourceId} AND r."revisionId" = ${revisionId}
        AND r."inventoryUid" = ${pin.inventoryUid} AND r."externalId" = ${pin.externalOfferId}
        AND (${expectedHash}::text IS NULL OR r."recordHash" = ${expectedHash})
        AND v."status" = 'GOOD' AND v."sequence" <= ${maxSequence}
      LIMIT 2
    `);
    if (rows.length !== 1) return null;
    const value = rows[0]!.images;
    if (!Array.isArray(value) || value.length > 500
      || value.some((url) => typeof url !== "string" || url.length > 2048)) throw invalid();
    try { return (value as string[]).map(canonicalizeMediaSourceUrl); } catch { throw invalid(); }
  }
  return {
    async captureInventory(scope: MediaSnapshotFactScope, pin: InventorySnapshotMediaPin): Promise<void> {
      if (failed || finished) throw new Error("SNAPSHOT_INPUT_MEDIA_CAPTURE_CLOSED");
      failed = true;
      if (!Number.isSafeInteger(pin.factRevisionSequence) || pin.factRevisionSequence <= 0
        || pin.factRevisionSequence > pin.approvedHeadSequence) throw invalid();
      const where = { organizationId: scope.organizationId, projectId: scope.projectId, sourceId: pin.sourceId };
      const [identity, head, fact, source] = await Promise.all([
        transaction.inventoryIdentity.count({ where: { ...where, uid: pin.inventoryUid, externalOfferId: pin.externalOfferId,
          normalizedHash: pin.normalizedHash, status: "ACTIVE" } }),
        transaction.sourceRevision.count({ where: { ...where, id: pin.approvedHeadId, status: "GOOD", sequence: pin.approvedHeadSequence } }),
        transaction.sourceRevision.count({ where: { ...where, id: pin.factRevisionId, status: "GOOD", sequence: pin.factRevisionSequence } }),
        transaction.source.count({ where: { organizationId: scope.organizationId, projectId: scope.projectId,
          id: pin.sourceId, lastGoodRevisionId: pin.approvedHeadId } }),
      ]);
      if (identity !== 1 || head !== 1 || fact !== 1 || source !== 1) throw invalid();
      const orderedImages = await images(scope, pin, pin.factRevisionId, pin.factRevisionSequence, pin.normalizedHash);
      if (!orderedImages) throw invalid();
      const relations = await transaction.mediaSource.findMany({ where: { ...where, entityType: "INVENTORY",
        entityUid: pin.inventoryUid, kind: "LISTING_IMAGE", canonicalSourceUrl: { in: [...new Set(orderedImages)] } },
        orderBy: { id: "asc" }, take: 501, select: { id: true, sourceRevisionId: true, canonicalSourceUrl: true,
          status: true, mirroredAt: true, updatedAt: true, asset: { select: assetSelect } } });
      if (relations.length > 500) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
      const eligible = new Map<string, CanonicalJsonValue>();
      for (const relation of relations) {
        const asset = relation.asset;
        if (!relation.mirroredAt || !eligibleAsset(scope, asset)) continue;
        const membership = relation.sourceRevisionId === pin.factRevisionId ? orderedImages
          : await images(scope, pin, relation.sourceRevisionId, pin.factRevisionSequence, null);
        if (!membership?.includes(relation.canonicalSourceUrl)) continue;
        eligible.set(relation.canonicalSourceUrl, json({ sourceId: pin.sourceId, inventoryUid: pin.inventoryUid,
          factRevisionId: pin.factRevisionId, approvedHeadId: pin.approvedHeadId, recordHash: pin.normalizedHash,
          relationId: relation.id, relationRevisionId: relation.sourceRevisionId, relationUpdatedAt: relation.updatedAt,
          mirrorStatus: relation.status, mirroredAt: relation.mirroredAt,
          asset: assetFact(asset) }));
      }
      for (let position = 0; position < orderedImages.length; position++) {
        const candidate = eligible.get(orderedImages[position]!);
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
          append({ ...candidate, kind: "LISTING_IMAGE", position });
        } else {
          append({ inventoryUid: pin.inventoryUid, factRevisionId: pin.factRevisionId,
            kind: "LISTING_IMAGE", position, omission: "MEDIA_MIRROR_UNAVAILABLE" });
        }
      }
      failed = false;
    },
    async captureAgents(scope: MediaSnapshotFactScope): Promise<void> {
      if (failed || finished) throw new Error("SNAPSHOT_INPUT_MEDIA_CAPTURE_CLOSED");
      failed = true;
      let cursor: string | undefined;
      const where = { organizationId: scope.organizationId, projectId: scope.projectId };
      for (;;) {
        const agents = await transaction.agent.findMany({ where: { ...where, status: "ACTIVE", showOnSite: true,
          consentConfirmedAt: { not: null }, ...(cursor ? { uid: { gt: cursor } } : {}) },
          orderBy: { uid: "asc" }, take: 200,
          select: { uid: true, version: true, photoMediaId: true, feedPhotoMediaId: true } });
        if (!agents.length) break;
        const ids = [...new Set(agents.flatMap((agent) => [agent.photoMediaId, agent.feedPhotoMediaId])
          .filter((id): id is string => id !== null))];
        const assets = ids.length ? await transaction.mediaAsset.findMany({ where: { ...where, id: { in: ids } },
          take: 401, select: assetSelect }) : [];
        if (assets.length > 400) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
        const byId = new Map(assets.map((asset) => [asset.id, asset]));
        for (const agent of agents) {
          for (const slot of ["photoMediaId", "feedPhotoMediaId"] as const) {
            const id = agent[slot];
            if (!id) continue;
            const asset = byId.get(id) ?? null;
            append(json({ kind: "AGENT_PHOTO", agentUid: agent.uid, agentVersion: agent.version, slot,
              ...(eligibleAsset(scope, asset) ? { asset: assetFact(asset), provenance: "ASSIGNED_ASSET_ONLY" }
                : { omission: "MEDIA_ASSET_UNAVAILABLE" }) }));
          }
        }
        cursor = agents[agents.length - 1]!.uid;
      }
      failed = false;
    },
    async captureShared(scope: MediaSnapshotFactScope, developmentUids: readonly string[]): Promise<void> {
      if (failed || finished) throw new Error("SNAPSHOT_INPUT_MEDIA_CAPTURE_CLOSED");
      failed = true;
      if (developmentUids.length > 5000) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
      const candidates = [...new Set(developmentUids)].sort();
      const where = { organizationId: scope.organizationId, projectId: scope.projectId };
      let cursor = "";
      for (;;) {
        const observations = await transaction.sharedMediaAsset.findMany({ where: { ...where,
          developmentUid: { in: candidates }, id: { gt: cursor } }, orderBy: { id: "asc" }, take: 200,
          select: { id: true, sourceId: true, developmentUid: true, buildingUid: true, kind: true, position: true,
            canonicalSourceUrl: true, rightsBasis: true, attribution: true, observedAt: true, updatedAt: true } });
        if (!observations.length) break;
        const associations = observations.map((row) => ({ sourceId: row.sourceId, kind: row.kind,
          entityType: row.buildingUid ? "BUILDING" : "DEVELOPMENT", entityUid: row.buildingUid ?? row.developmentUid,
          canonicalSourceUrl: canonicalizeMediaSourceUrl(row.canonicalSourceUrl) }));
        const relations = await transaction.mediaSource.findMany({ where: { ...where, OR: associations },
          orderBy: { id: "asc" }, take: 201, select: { id: true, sourceId: true, kind: true, entityType: true,
            entityUid: true, canonicalSourceUrl: true, sourceRevisionId: true, status: true, mirroredAt: true,
            updatedAt: true, asset: { select: assetSelect } } });
        if (relations.length > 200) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
        const key = (row: { sourceId: string; kind: string; entityType: string; entityUid: string; canonicalSourceUrl: string }) =>
          JSON.stringify([row.sourceId, row.kind, row.entityType, row.entityUid, row.canonicalSourceUrl]);
        const byAssociation = new Map(relations.map((row) => [key(row), row]));
        for (let index = 0; index < observations.length; index++) {
          const observation = observations[index]!;
          const relation = byAssociation.get(key(associations[index]!));
          const asset = relation?.asset ?? null;
          const rightsEligible = observation.rightsBasis !== "LICENSED" || Boolean(observation.attribution?.trim());
          append(json({ kind: observation.kind, sharedMediaId: observation.id, sourceId: observation.sourceId,
            developmentUid: observation.developmentUid, buildingUid: observation.buildingUid, position: observation.position,
            observationUpdatedAt: observation.updatedAt, observedAt: observation.observedAt,
            ...(relation?.mirroredAt && rightsEligible && eligibleAsset(scope, asset) ? {
              provenance: "SHARED_OBSERVATION_MIRROR", relationId: relation.id,
              relationRevisionId: relation.sourceRevisionId, relationUpdatedAt: relation.updatedAt,
              mirrorStatus: relation.status, mirroredAt: relation.mirroredAt, asset: assetFact(asset),
            } : { omission: "MEDIA_MIRROR_UNAVAILABLE" }) }));
        }
        cursor = observations[observations.length - 1]!.id;
      }
      failed = false;
    },
    finishCapture(): void {
      if (failed || finished) throw new Error("SNAPSHOT_INPUT_MEDIA_CAPTURE_CLOSED");
      failed = true;
      flush();
      if (!emitted) sink("media", []);
      finished = true;
    },
  };
}
