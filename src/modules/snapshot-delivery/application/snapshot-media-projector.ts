import { ulidSchema, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { mediaPublicV1Schema, type MediaPublicV1 } from "@ams-data-hub/realty-contracts";
import { z } from "zod";
import { agentStatusSchema, isAgentPubliclyPublishable } from "../../project-state/index.ts";
import type { CapturedMediaCandidate, VerifiedCapturedMediaAttachment } from "../../media-assets/server.ts";
import type { SnapshotDatasetInput } from "../contracts.ts";
import { assertSnapshotPrivacySafe } from "../domain/privacy-scanner.ts";
import type { SnapshotBuildInputReceipt, SnapshotInputPartKind } from "./snapshot-build-input.ts";
import { validateSnapshotInput } from "./snapshot-input-validation.ts";
import type { SnapshotCatalogSelection } from "./snapshot-catalog-selection.ts";

const owner = z.enum(["INVENTORY", "AGENT", "DEVELOPMENT", "BUILDING"]);
export const snapshotMediaPublicSchema = z.object({ entityType: owner, entityUid: ulidSchema, media: mediaPublicV1Schema }).strict()
  .refine((value) => value.entityType !== "AGENT" || value.media.position === 0);
function object(value: CanonicalJsonValue | undefined): Record<string, CanonicalJsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SNAPSHOT_MEDIA_FACT_INVALID");
  return value;
}

/** Receipt-only provenance admission. This is not authorization of arbitrary request JSON. */
export function prepareSnapshotMediaCandidates(input: SnapshotBuildInputReceipt, selection?: SnapshotCatalogSelection): CapturedMediaCandidate[] {
  const parts = validateSnapshotInput(input);
  const rows = (kind: SnapshotInputPartKind) => parts.filter((part) => part.kind === kind).flatMap((part) => part.payload).map(object);
  const index = (values: Record<string, CanonicalJsonValue>[], key: string) => {
    const entries = new Map<string, Record<string, CanonicalJsonValue>>();
    for (const value of values) { const uid = ulidSchema.parse(value[key]);
      if (entries.has(uid)) throw new Error("SNAPSHOT_MEDIA_PIN_INVALID"); entries.set(uid, value); }
    return entries;
  };
  const inventory = index(rows("inventory"), "uid"); const agents = index(rows("agents"), "uid");
  const catalog = index(rows("catalog"), "uid");
  const agentSlots = new Map<string, Map<string, Record<string, CanonicalJsonValue>>>();
  const candidates: CapturedMediaCandidate[] = [];
  const add = (entityType: CapturedMediaCandidate["entityType"], uid: unknown, position: unknown, row: Record<string, CanonicalJsonValue>, unsupported = false) => {
    const asset = unsupported || row.asset === undefined ? null : object(row.asset);
    candidates.push({ entityType, entityUid: ulidSchema.parse(uid), position: z.number().int().min(0).max(10_000).parse(position),
      asset: asset ? { sha256: asset.sha256, storageKey: asset.storageKey, byteSize: asset.byteSize,
        contentType: asset.contentType, rightsBasis: asset.rightsBasis, hasLicense: asset.hasLicense } : null,
      ...(unsupported ? { warning: "MEDIA_KIND_UNSUPPORTED" as const } : row.omission ? { warning: z.enum(["MEDIA_MIRROR_UNAVAILABLE", "MEDIA_ASSET_UNAVAILABLE"]).parse(row.omission) }
        : row.mirrorStatus === "WARNING" ? { warning: "MEDIA_MIRROR_WARNING" as const } : {}) });
  };
  for (const row of rows("media")) {
    if (selection && row.sharedMediaId !== undefined && (!selection.developmentUids.has(ulidSchema.parse(row.developmentUid))
      || (row.buildingUid !== null && !selection.buildingUids.has(ulidSchema.parse(row.buildingUid))))) continue;
    if (row.asset !== undefined && row.omission !== undefined) throw new Error("SNAPSHOT_MEDIA_PIN_INVALID");
    if (row.asset !== undefined && (row.kind === "LISTING_IMAGE" || row.sharedMediaId !== undefined)) {
      z.enum(["MIRRORED", "WARNING"]).parse(row.mirrorStatus);
      z.iso.datetime({ offset: true }).parse(row.mirroredAt);
    }
    if (row.kind === "LISTING_IMAGE" && row.sharedMediaId === undefined) {
      const uid = ulidSchema.parse(row.inventoryUid); const pin = inventory.get(uid);
      if (!pin || pin.status !== "ACTIVE" || pin.factRevisionId !== row.factRevisionId) throw new Error("SNAPSHOT_MEDIA_PIN_INVALID");
      if (row.asset !== undefined && (pin.sourceId !== row.sourceId || pin.normalizedHash !== row.recordHash
        || pin.approvedHeadId !== row.approvedHeadId || !row.mirroredAt || !row.relationRevisionId)) throw new Error("SNAPSHOT_MEDIA_PIN_INVALID");
      add("INVENTORY", uid, row.position, row);
    } else if (row.kind === "AGENT_PHOTO" && row.sharedMediaId === undefined) {
      const uid = ulidSchema.parse(row.agentUid); const agent = agents.get(uid);
      if (!agent || !isAgentPubliclyPublishable({ status: agentStatusSchema.parse(agent.status),
        showOnSite: z.boolean().parse(agent.showOnSite), consentConfirmedAt: agent.consentConfirmedAt === null ? null
          : new Date(z.iso.datetime({ offset: true }).parse(agent.consentConfirmedAt)) })) continue;
      const slot = z.enum(["photoMediaId", "feedPhotoMediaId"]).parse(row.slot);
      if (agent.version !== row.agentVersion || !agent[slot] || (row.asset !== undefined
        && (row.provenance !== "ASSIGNED_ASSET_ONLY" || object(row.asset).id !== agent[slot]))) throw new Error("SNAPSHOT_MEDIA_PIN_INVALID");
      const slots = agentSlots.get(uid) ?? new Map<string, Record<string, CanonicalJsonValue>>();
      if (slots.has(slot)) throw new Error("SNAPSHOT_MEDIA_PIN_INVALID"); slots.set(slot, row); agentSlots.set(uid, slots);
    } else if (row.sharedMediaId !== undefined) {
      const development = catalog.get(ulidSchema.parse(row.developmentUid));
      if (development?.entityType !== "development") throw new Error("SNAPSHOT_MEDIA_PIN_INVALID");
      const building = row.buildingUid === null ? null : catalog.get(ulidSchema.parse(row.buildingUid));
      if (row.buildingUid !== null && (building?.entityType !== "building" || building.developmentUid !== row.developmentUid)) throw new Error("SNAPSHOT_MEDIA_PIN_INVALID");
      if (row.asset !== undefined && (row.provenance !== "SHARED_OBSERVATION_MIRROR" || !row.mirroredAt || !row.relationId)) throw new Error("SNAPSHOT_MEDIA_PIN_INVALID");
      add(building ? "BUILDING" : "DEVELOPMENT", row.buildingUid ?? row.developmentUid, row.position, row, row.kind !== "DEVELOPMENT_IMAGE");
    } else throw new Error("SNAPSHOT_MEDIA_KIND_UNSUPPORTED");
  }
  for (const [uid, slots] of agentSlots) {
    const agent = agents.get(uid)!;
    const slot = agent.photoMediaId ? "photoMediaId" : "feedPhotoMediaId";
    const selected = slots.get(slot);
    if (!selected) throw new Error("SNAPSHOT_MEDIA_PIN_INVALID");
    add("AGENT", uid, 0, selected);
  }
  return candidates;
}

/** Strict public attachment projection; private provenance has already been verified and discarded. */
export function projectSnapshotMedia(attachments: readonly VerifiedCapturedMediaAttachment[]): {
  dataset: SnapshotDatasetInput; inventoryMedia: ReadonlyMap<string, readonly MediaPublicV1[]>; agentMedia: ReadonlyMap<string, readonly MediaPublicV1[]>;
} {
  if (attachments.length > 50_000) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
  const inventoryMedia = new Map<string, MediaPublicV1[]>(); const agentMedia = new Map<string, MediaPublicV1[]>(); const seen = new Set<string>();
  const entityDataset = { INVENTORY: "inventory", AGENT: "agents", DEVELOPMENT: "developments", BUILDING: "buildings" } as const;
  const records = attachments.map((attachment) => {
    const value = snapshotMediaPublicSchema.parse(attachment); const key = `${value.entityType}/${value.entityUid}/${value.media.position}`;
    if (seen.has(key)) throw new Error("SNAPSHOT_RECORD_DUPLICATE"); seen.add(key);
    assertSnapshotPrivacySafe(value as CanonicalJsonValue);
    const map = value.entityType === "AGENT" ? agentMedia : value.entityType === "INVENTORY" ? inventoryMedia : null;
    if (map) { const list = map.get(value.entityUid) ?? []; list.push(value.media); map.set(value.entityUid, list); }
    return { key, value: value as CanonicalJsonValue, references: [{ kind: entityDataset[value.entityType], key: value.entityUid }] };
  });
  for (const map of [inventoryMedia, agentMedia]) for (const list of map.values()) list.sort((a, b) => a.position - b.position);
  return { dataset: { kind: "media", records: records.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) }, inventoryMedia, agentMedia };
}
