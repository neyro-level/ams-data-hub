import { publicUrlIdSchema, ulidSchema } from "@ams-data-hub/data-contracts";
import { z } from "zod";
import { normalizeProfileToken } from "../../ingestion-core/index.ts";
import type { SnapshotGoodFactPin } from "../../ingestion-core/server.ts";
import type { SnapshotBuildInputReceipt } from "./snapshot-build-input.ts";
import { prepareSnapshotFactProfiles } from "./snapshot-fact-profiles.ts";
import type { SnapshotInventoryProfile, SnapshotInventoryProjectionInput } from "./snapshot-inventory-projector.ts";
import { validateSnapshotInput } from "./snapshot-input-validation.ts";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.iso.datetime({ offset: true });
const property = z.enum(["APARTMENT", "ROOM", "HOUSE", "HOUSE_PART", "LAND", "COTTAGE", "TOWNHOUSE", "GARAGE_BOX", "NEW_BUILD_UNIT", "COMMERCIAL", "OTHER"]);
const mapping = z.object({ sourcePath: z.string().regex(/^[\w@/-]{1,240}$/u), targetField: z.string().max(128), sparse: z.boolean() }).strict();
const token = z.string().trim().min(1).max(240);
const period = z.object({ source: token, target: z.enum(["DAY", "MONTH", "YEAR"]) }).strict();
const deal = z.object({ source: token, target: z.enum(["SECONDARY_SALE", "PRIMARY_SALE", "ASSIGNMENT", "UNKNOWN"]) }).strict();
const units = z.object({ source: token, canonicalUnit: z.enum(["M2", "METER"]), multiplier: z.number().finite().positive() }).strict();
const configuration = z.object({ fieldMappings: z.array(mapping).max(200), unitAliases: z.array(units).max(200),
  pricePeriodAliases: z.array(period).max(200), dealStatusAliases: z.array(deal).max(200),
  locationPolicy: z.object({ exactEnabled: z.literal(false), defaultByPropertyType: z.record(property, z.literal("STREET")),
    districtOverrideAllowedFor: z.array(property).max(11) }).strict() });
const profile = z.object({ identity: z.string().max(257), configuration: configuration.nullable(),
  formatContract: z.object({ family: z.enum(["YRL_2010", "AVITO_V3", "CIAN_V2"]) }).nullable() });
const inventory = z.object({ uid: ulidSchema, sourceId: id, externalOfferId: z.string().min(1).max(240), status: z.literal("ACTIVE"),
  normalizedHash: hash, sourceHash: hash, factProfileIdentity: z.string().min(1).max(257), factProfileKey: id,
  factProfileVersion: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/u), factRevisionId: id, factRevisionSequence: z.number().int().positive(),
  firstSeenAt: date, lastSeenAt: date, sourceCreatedAt: date.nullable(), sourceUpdatedAt: date.nullable(), createdAt: date, updatedAt: date });
const url = z.object({ factType: z.literal("entry"), entityType: z.literal("INVENTORY"), entityUid: ulidSchema,
  reservation: z.object({ publicUrlId: publicUrlIdSchema }) });
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SNAPSHOT_INVENTORY_INPUT_INVALID");
  return value as Record<string, unknown>;
}
export interface SnapshotInventoryCapturedInput {
  pin: SnapshotGoodFactPin;
  identity: SnapshotInventoryProjectionInput["identity"];
  profile: SnapshotInventoryProfile;
  url: SnapshotInventoryProjectionInput["url"];
}

/** Preflight private pins and finite projection settings before external object IO. */
export function prepareSnapshotInventoryInput(input: SnapshotBuildInputReceipt) {
  const parts = validateSnapshotInput(input);
  const factProfiles = prepareSnapshotFactProfiles(input);
  const profiles = new Map<string, SnapshotInventoryProfile>();
  const urls = new Map<string, SnapshotInventoryProjectionInput["url"]>();
  for (const part of parts) for (const raw of part.payload) {
    if (part.kind === "sources") {
      const value = object(raw);
      if (value.entityType !== "profile" || typeof value.identity !== "string" || !factProfiles.has(value.identity)) continue;
      const parsed = profile.safeParse(value);
      if (!parsed.success || profiles.has(value.identity)) throw new Error("SNAPSHOT_GOOD_PROFILE_INVALID");
      const row = parsed.data;
      for (const aliases of [row.configuration?.unitAliases, row.configuration?.pricePeriodAliases, row.configuration?.dealStatusAliases]) {
        if (aliases && new Set(aliases.map((alias) => normalizeProfileToken(alias.source))).size !== aliases.length) {
          throw new Error("SNAPSHOT_GOOD_PROFILE_INVALID");
        }
      }
      profiles.set(row.identity, row);
    } else if (part.kind === "urls") {
      const value = object(raw);
      if (value.factType !== "entry" || value.entityType !== "INVENTORY") continue;
      const parsed = url.safeParse(value);
      if (!parsed.success || urls.has(parsed.data.entityUid)) throw new Error("SNAPSHOT_INVENTORY_URL_INVALID");
      const association = { entityType: parsed.data.entityType, entityUid: parsed.data.entityUid,
        publicUrlId: parsed.data.reservation.publicUrlId };
      urls.set(association.entityUid, association);
    }
  }
  const rows: SnapshotInventoryCapturedInput[] = []; const seen = new Set<string>();
  for (const part of parts) if (part.kind === "inventory") for (const raw of part.payload) {
    const value = object(raw);
    if (value.status === "INACTIVE") continue;
    if (value.status !== "ACTIVE") throw new Error("SNAPSHOT_INVENTORY_INPUT_INVALID");
    const parsed = inventory.safeParse(value);
    if (!parsed.success) throw new Error("SNAPSHOT_INVENTORY_INPUT_INVALID");
    const row = parsed.data; const projectionProfile = profiles.get(row.factProfileIdentity); const association = urls.get(row.uid);
    if (seen.has(row.uid) || row.factProfileIdentity !== `${row.factProfileKey}@${row.factProfileVersion}` || !projectionProfile) {
      throw new Error("SNAPSHOT_INVENTORY_PIN_INVALID");
    }
    if (!association) throw new Error("SNAPSHOT_INVENTORY_URL_INVALID");
    seen.add(row.uid);
    const { factProfileKey, factProfileVersion, factRevisionId, factRevisionSequence, ...identity } = row;
    rows.push({ identity, profile: projectionProfile, url: association, pin: { uid: row.uid, sourceId: row.sourceId,
      externalOfferId: row.externalOfferId, normalizedHash: row.normalizedHash,
      factProfileKey, factProfileVersion, factRevisionId, factRevisionSequence } });
  }
  return { rows, factProfiles };
}
