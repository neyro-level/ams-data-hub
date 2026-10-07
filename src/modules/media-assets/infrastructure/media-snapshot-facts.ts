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
  type ImageRequest = { pin: InventorySnapshotMediaPin; revisionId: string; expectedHash: string | null };
  type UrlBudget = { bytes: number };
  const retainedUrlBytes = (values: readonly (string[] | null)[]) =>
    values.reduce((sum, value) => sum + (value ? canonicalJsonBytes(value).byteLength : 0), 0);
  async function imagePage(scope: MediaSnapshotFactScope, requests: readonly ImageRequest[], budget: UrlBudget): Promise<(string[] | null)[]> {
    if (!requests.length) return [];
    const values = requests.map(({ pin, revisionId, expectedHash }, index) => Prisma.sql`(${index}::int,
      ${pin.sourceId}::text, ${pin.inventoryUid}::text, ${pin.externalOfferId}::text, ${revisionId}::text,
      ${pin.factRevisionSequence}::int, ${expectedHash}::text)`);
    const rows = await transaction.$queryRaw<{ index: number; found: boolean; oversized: boolean; images: unknown }[]>(Prisma.sql`
      WITH requested("index", "sourceId", "uid", "externalId", "revisionId", "maxSequence", "hash") AS (VALUES ${Prisma.join(values)}),
      selected AS (
        SELECT q."index", r."externalId" IS NOT NULL AS found, r.images
        FROM requested q LEFT JOIN LATERAL (
          SELECT r."externalId", r."payload" #> '{draft,imageUrls}' AS images
          FROM "SourceRevisionRecord" r JOIN "SourceRevision" v ON v."id" = r."revisionId"
            AND v."organizationId" = r."organizationId" AND v."projectId" = r."projectId" AND v."sourceId" = r."sourceId"
          WHERE r."organizationId" = ${scope.organizationId} AND r."projectId" = ${scope.projectId}
            AND r."sourceId" = q."sourceId" AND r."revisionId" = q."revisionId"
            AND r."inventoryUid" = q.uid AND r."externalId" = q."externalId"
            AND (q.hash IS NULL OR r."recordHash" = q.hash) AND v."status" = 'GOOD' AND v."sequence" <= q."maxSequence"
          LIMIT 2
        ) r ON true
      )
      SELECT "index", found, SUM(COALESCE(octet_length(images::text), 0)) OVER () > 1048576 AS oversized,
        CASE WHEN SUM(COALESCE(octet_length(images::text), 0)) OVER () <= 1048576 THEN images ELSE NULL END AS images
      FROM selected ORDER BY "index"
    `);
    // SQL returns only small markers when the raw image page is too large.
    // Split before materializing URLs rather than lowering supported per-record capacity.
    if (rows.some((row) => row.oversized)) {
      if (requests.length === 1) throw invalid();
      const middle = Math.floor(requests.length / 2);
      const left = await imagePage(scope, requests.slice(0, middle), budget);
      const right = await imagePage(scope, requests.slice(middle), budget);
      return [...left, ...right];
    }
    return requests.map((_request, index) => {
      const matches = rows.filter((row) => row.index === index);
      if (matches.length !== 1 || !matches[0]!.found) return null;
      const value = matches[0]!.images;
      if (!Array.isArray(value) || value.length > 500
        || value.some((url) => typeof url !== "string" || url.length > 2048)) throw invalid();
      let images: string[];
      try { images = (value as string[]).map(canonicalizeMediaSourceUrl); } catch { throw invalid(); }
      budget.bytes += canonicalJsonBytes(images).byteLength;
      if (budget.bytes > 32 * 1024 * 1024) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
      return images;
    });
  }
  async function captureInventoryPage(scope: MediaSnapshotFactScope, pins: readonly InventorySnapshotMediaPin[]): Promise<void> {
      if (failed || finished) throw new Error("SNAPSHOT_INPUT_MEDIA_CAPTURE_CLOSED");
      failed = true;
      if (pins.length > 200) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
      if (pins.some((pin) => !Number.isSafeInteger(pin.factRevisionSequence) || pin.factRevisionSequence <= 0
        || !Number.isSafeInteger(pin.approvedHeadSequence) || pin.approvedHeadSequence > 2_147_483_647
        || pin.factRevisionSequence > pin.approvedHeadSequence)
        || new Set(pins.map((pin) => pin.inventoryUid)).size !== pins.length) throw invalid();
      if (!pins.length) { failed = false; return; }
      const values = pins.map((pin, index) => Prisma.sql`(${index}::int, ${pin.sourceId}::text,
        ${pin.inventoryUid}::text, ${pin.externalOfferId}::text, ${pin.normalizedHash}::text,
        ${pin.factRevisionId}::text, ${pin.factRevisionSequence}::int, ${pin.approvedHeadId}::text, ${pin.approvedHeadSequence}::int)`);
      const valid = await transaction.$queryRaw<{ index: number }[]>(Prisma.sql`
        WITH requested("index", "sourceId", uid, "externalId", hash, fact, "factSequence", head, "headSequence") AS (VALUES ${Prisma.join(values)})
        SELECT q."index" FROM requested q
        JOIN "InventoryIdentity" i ON i."organizationId" = ${scope.organizationId} AND i."projectId" = ${scope.projectId}
          AND i."sourceId" = q."sourceId" AND i.uid = q.uid AND i."externalOfferId" = q."externalId"
          AND i."normalizedHash" = q.hash AND i.status = 'ACTIVE'
        JOIN "Source" s ON s."organizationId" = i."organizationId" AND s."projectId" = i."projectId"
          AND s.id = q."sourceId" AND s."lastGoodRevisionId" = q.head
        JOIN "SourceRevision" h ON h."organizationId" = i."organizationId" AND h."projectId" = i."projectId"
          AND h."sourceId" = q."sourceId" AND h.id = q.head AND h.status = 'GOOD' AND h.sequence = q."headSequence"
        JOIN "SourceRevision" f ON f."organizationId" = i."organizationId" AND f."projectId" = i."projectId"
          AND f."sourceId" = q."sourceId" AND f.id = q.fact AND f.status = 'GOOD' AND f.sequence = q."factSequence"
      `);
      if (valid.length !== pins.length || new Set(valid.map((row) => row.index)).size !== pins.length) throw invalid();
      const urlBudget: UrlBudget = { bytes: 0 };
      const ordered = await imagePage(scope, pins.map((pin) => ({ pin, revisionId: pin.factRevisionId, expectedHash: pin.normalizedHash })), urlBudget);
      if (ordered.some((images) => images === null)) throw invalid();
      if (ordered.reduce((sum, images) => sum + images!.length, 0) > 50_000) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
      const byUid = new Map(pins.map((pin, index) => [pin.inventoryUid, { pin, images: ordered[index]!, eligible: new Map<string, CanonicalJsonValue>() }]));
      const associations = pins.flatMap((pin, index) => ordered[index]!.length ? [{ sourceId: pin.sourceId,
        entityUid: pin.inventoryUid, canonicalSourceUrl: { in: [...new Set(ordered[index]!)] } }] : []);
      let cursor = "";
      let capturedBytes = 0;
      while (associations.length) {
        const relations = await transaction.mediaSource.findMany({ where: { organizationId: scope.organizationId,
          projectId: scope.projectId, entityType: "INVENTORY", kind: "LISTING_IMAGE", OR: associations, id: { gt: cursor } },
          orderBy: { id: "asc" }, take: 200, select: { id: true, entityUid: true, sourceRevisionId: true, canonicalSourceUrl: true,
            status: true, mirroredAt: true, updatedAt: true, asset: { select: assetSelect } } });
        if (!relations.length) break;
        const older = relations.filter((relation) => relation.sourceRevisionId !== byUid.get(relation.entityUid)!.pin.factRevisionId);
        const oldKey = (relation: typeof relations[number]) => JSON.stringify([relation.entityUid, relation.sourceRevisionId]);
        const oldRequests = new Map(older.map((relation) => [oldKey(relation), { pin: byUid.get(relation.entityUid)!.pin,
          revisionId: relation.sourceRevisionId, expectedHash: null }]));
        const oldImages = await imagePage(scope, [...oldRequests.values()], urlBudget);
        const byOldKey = new Map([...oldRequests.keys()].map((key, index) => [key, oldImages[index]]));
        for (const relation of relations) {
          const { pin, images, eligible } = byUid.get(relation.entityUid)!;
          const asset = relation.asset;
          if (!relation.mirroredAt || !eligibleAsset(scope, asset)) continue;
          const membership = relation.sourceRevisionId === pin.factRevisionId ? images : byOldKey.get(oldKey(relation));
          if (!membership?.includes(relation.canonicalSourceUrl)) continue;
          const candidate = json({ sourceId: pin.sourceId, inventoryUid: pin.inventoryUid,
          factRevisionId: pin.factRevisionId, approvedHeadId: pin.approvedHeadId, recordHash: pin.normalizedHash,
          relationId: relation.id, relationRevisionId: relation.sourceRevisionId, relationUpdatedAt: relation.updatedAt,
          mirrorStatus: relation.status, mirroredAt: relation.mirroredAt,
          asset: assetFact(asset) });
          capturedBytes += canonicalJsonBytes(candidate).byteLength;
          if (capturedBytes > 32 * 1024 * 1024) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
          eligible.set(relation.canonicalSourceUrl, candidate);
        }
        urlBudget.bytes -= retainedUrlBytes(oldImages);
        cursor = relations[relations.length - 1]!.id;
      }
      for (const { pin, images, eligible } of byUid.values()) for (let position = 0; position < images.length; position++) {
        const candidate = eligible.get(images[position]!);
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
          append({ ...candidate, kind: "LISTING_IMAGE", position });
        } else {
          append({ inventoryUid: pin.inventoryUid, factRevisionId: pin.factRevisionId,
            kind: "LISTING_IMAGE", position, omission: "MEDIA_MIRROR_UNAVAILABLE" });
        }
      }
      failed = false;
  }
  return {
    captureInventoryPage,
    async captureInventory(scope: MediaSnapshotFactScope, pin: InventorySnapshotMediaPin): Promise<void> {
      await captureInventoryPage(scope, [pin]);
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
