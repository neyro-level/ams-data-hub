import { ulidSchema } from "@ams-data-hub/data-contracts";
import { z } from "zod";
import { mediaRightsBasisSchema } from "../contracts.ts";
import { capturedMediaAssetSchema } from "./media-object-verification.ts";
import type { CapturedMediaCandidate, VerifiedCapturedMediaAttachment } from "./captured-media-verifier.ts";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const owner = z.enum(["INVENTORY", "AGENT", "DEVELOPMENT", "BUILDING"]);
const asset = capturedMediaAssetSchema.safeExtend({ id }).strict();
const relation = z.object({ id, sourceId: id, sourceRevisionId: z.string().min(1).max(128), entityType: owner,
  entityUid: ulidSchema, kind: z.enum(["LISTING_IMAGE", "DEVELOPMENT_IMAGE"]), assetId: id, canonicalUrlHash: hash }).strict();
const observation = z.object({ id, sourceId: id, developmentUid: ulidSchema, buildingUid: ulidSchema.nullable(),
  kind: z.literal("DEVELOPMENT_IMAGE"), position: z.number().int().min(0).max(10_000), canonicalUrlHash: hash,
  rightsBasis: mediaRightsBasisSchema, hasLicense: z.boolean(), hasAttribution: z.boolean() }).strict();
const attachment = z.object({ entityType: owner, entityUid: ulidSchema, position: z.number().int().min(0).max(10_000),
  asset, relation: relation.nullable(), observation: observation.nullable() }).strict().superRefine((row, ctx) => {
  const invalid = row.entityType === "AGENT" ? row.position !== 0 || row.relation !== null || row.observation !== null
    : !row.relation || row.relation.entityType !== row.entityType || row.relation.entityUid !== row.entityUid || row.relation.assetId !== row.asset.id
      || (row.entityType === "INVENTORY" ? row.relation.kind !== "LISTING_IMAGE" || row.observation !== null
        : !row.observation || row.relation.kind !== "DEVELOPMENT_IMAGE" || row.relation.sourceId !== row.observation.sourceId
          || (row.observation.rightsBasis === "LICENSED" && !row.observation.hasAttribution)
          || row.observation.position !== row.position || (row.observation.buildingUid ?? row.observation.developmentUid) !== row.entityUid
          || (row.entityType === "BUILDING") !== (row.observation.buildingUid !== null));
  if (invalid) ctx.addIssue({ code: "custom", message: "INVALID_PUBLICATION_MEDIA_ASSOCIATION" });
});
export const snapshotPublicationMediaAnchorsSchema = z.object({ projectId: id, attachments: z.array(attachment).max(50_000) }).strict()
  .superRefine((value, ctx) => {
    if (new Set(value.attachments.map((row) => `${row.entityType}/${row.entityUid}/${row.position}`)).size !== value.attachments.length) {
      ctx.addIssue({ code: "custom", message: "DUPLICATE_PUBLICATION_MEDIA_ATTACHMENT" });
    }
  });
export type SnapshotPublicationMediaAnchors = z.infer<typeof snapshotPublicationMediaAnchorsSchema>;
type Pin = SnapshotPublicationMediaAnchors["attachments"][number];
const invalid = (): never => { throw new Error("SNAPSHOT_PUBLICATION_MEDIA_ANCHORS_INVALID"); };
export const publicationMediaMetadataKey = (row: object) => JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));
/** Exactly ECMAScript trim whitespace, used as PostgreSQL btrim's explicit character set. */
export const PUBLICATION_MEDIA_TRIM_CHARACTERS = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

/** Same server-owned candidate choice as HEAD. Copy metadata before any IO; never copy PII/URLs. */
export function prepareSnapshotPublicationMediaPins(input: { candidates: readonly { candidate: CapturedMediaCandidate; captured: unknown }[];
  sharedFacts: readonly unknown[] }): Pin[] {
  if (input.candidates.length > 50_000 || input.sharedFacts.length > 50_000) invalid();
  const observations = new Map<string, z.infer<typeof observation>>();
  for (const raw of input.sharedFacts) {
    // Non-image observations cannot become public candidates, but retain identity uniqueness.
    const kind = z.object({ id, kind: z.string() }).safeParse(raw); if (!kind.success) invalid();
    if (kind.data!.kind !== "DEVELOPMENT_IMAGE") continue;
    const parsed = observation.strip().safeParse(raw);
    if (!parsed.success || observations.has(parsed.data!.id)) invalid(); observations.set(parsed.data!.id, parsed.data!);
  }
  const pins: Pin[] = []; const assets = new Map<string, string>(); const relations = new Map<string, string>();
  for (const { candidate, captured } of input.candidates) {
    if (candidate.warning && candidate.warning !== "MEDIA_MIRROR_WARNING") continue;
    const publicAsset = capturedMediaAssetSchema.safeParse(candidate.asset); if (!publicAsset.success) continue;
    const raw = z.object({ asset: asset.strip() }).safeParse(captured); if (!raw.success) invalid();
    const { id: _id, ...capturedAsset } = raw.data!.asset; void _id;
    if (publicationMediaMetadataKey(capturedAsset) !== publicationMediaMetadataKey(publicAsset.data)) invalid();
    const identity = { entityType: candidate.entityType, entityUid: candidate.entityUid, position: candidate.position, asset: raw.data!.asset };
    let relationPin: Pin["relation"] = null; let observationPin: Pin["observation"] = null;
    if (candidate.entityType === "AGENT") {
      const row = z.object({ kind: z.literal("AGENT_PHOTO"), agentUid: ulidSchema, provenance: z.literal("ASSIGNED_ASSET_ONLY") }).safeParse(captured);
      if (!row.success || row.data.agentUid !== candidate.entityUid) invalid();
    } else {
      const row = z.object({ sourceId: id, relationId: id, relationRevisionId: z.string().min(1).max(128), relationCanonicalUrlHash: hash,
        mirrorStatus: z.enum(["MIRRORED", "WARNING"]), mirroredAt: z.iso.datetime({ offset: true }),
        kind: z.enum(["LISTING_IMAGE", "DEVELOPMENT_IMAGE"]), sharedMediaId: id.optional() }).safeParse(captured);
      if (!row.success) invalid();
      relationPin = { id: row.data!.relationId, sourceId: row.data!.sourceId, sourceRevisionId: row.data!.relationRevisionId,
        canonicalUrlHash: row.data!.relationCanonicalUrlHash, entityType: candidate.entityType, entityUid: candidate.entityUid,
        kind: row.data!.kind, assetId: raw.data!.asset.id };
      if (row.data!.sharedMediaId) { observationPin = observations.get(row.data!.sharedMediaId) ?? null; if (!observationPin) invalid(); }
    }
    const parsed = attachment.safeParse({ ...identity, relation: relationPin, observation: observationPin }); if (!parsed.success) invalid();
    const pin = parsed.data!; const assetKey = publicationMediaMetadataKey(pin.asset);
    if (assets.has(pin.asset.id) && assets.get(pin.asset.id) !== assetKey) invalid(); assets.set(pin.asset.id, assetKey);
    if (pin.relation) {
      const key = publicationMediaMetadataKey(pin.relation);
      if (relations.has(pin.relation.id) && relations.get(pin.relation.id) !== key) invalid(); relations.set(pin.relation.id, key);
    }
    pins.push(pin);
  }
  return pins;
}
/** Only HEAD-verified attachments get a fresh gate. Ambiguous/omitted positions never publish. */
export function selectSnapshotPublicationMediaAnchors(projectId: string, pins: readonly Pin[], published: readonly VerifiedCapturedMediaAttachment[]): SnapshotPublicationMediaAnchors {
  const byIdentity = new Map<string, Pin[]>();
  for (const pin of pins) { const key = `${pin.entityType}/${pin.entityUid}/${pin.position}/${pin.asset.sha256}`;
    const values = byIdentity.get(key) ?? []; values.push(pin); byIdentity.set(key, values); }
  const selected = published.map((row) => {
    const matches = byIdentity.get(`${row.entityType}/${row.entityUid}/${row.media.position}/${row.media.ref}`);
    if (matches?.length !== 1) invalid(); return matches![0]!;
  });
  const parsed = snapshotPublicationMediaAnchorsSchema.safeParse({ projectId, attachments: selected });
  if (!parsed.success) invalid(); return parsed.data!;
}
