import "server-only";
import { ulidSchema } from "@ams-data-hub/data-contracts";
import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { normalizedContentHash } from "../application/import-pipeline.ts";
import { normalizeSnapshotPublicAddress } from "../domain/snapshot-public-address.ts";
import type { SourceSnapshotFactScope } from "./source-snapshot-facts.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.string().min(1).max(128);
const pinSchema = z.object({ uid: ulidSchema, sourceId: id, externalOfferId: z.string().min(1).max(240),
  normalizedHash: hash, factRevisionId: id, factRevisionSequence: z.number().int().positive(),
  factProfileKey: id, factProfileVersion: id }).strict();
export type SnapshotGoodFactPin = z.infer<typeof pinSchema>;
const draftSchema = z.object({ sourceFormat: z.enum(["YRL_2010", "DOMCLICK_YRL", "AVITO_V3", "CIAN_V2"]),
  propertyType: z.enum(["APARTMENT", "ROOM", "HOUSE", "HOUSE_PART", "LAND", "COTTAGE", "TOWNHOUSE", "GARAGE_BOX", "NEW_BUILD_UNIT", "COMMERCIAL", "OTHER"]),
  transactionType: z.enum(["SALE", "RENT_LONG", "RENT_SHORT", "UNKNOWN"]),
  title: z.string().max(500).optional(), description: z.string().max(100_000).optional(),
  address: z.string().max(2000).optional(), price: z.number().finite().nonnegative().optional(),
  currency: z.string().max(100).optional(), areaM2: z.number().finite().nonnegative().optional(),
  latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() });

/** Internal normalized candidates, NOT a public DTO. Address and coordinates
 * still require the captured location policy before public projection. Raw
 * address is excluded; addressPublic has passed the unit-redaction boundary. */
export interface SnapshotGoodNormalizedFact {
  inventoryUid: string;
  sourceId: string;
  externalOfferId: string;
  normalizedHash: string;
  factProfileIdentity: string;
  draft: Omit<z.infer<typeof draftSchema>, "address">;
  addressPublic?: string;
  fieldValues: Readonly<Record<string, readonly (string | number)[]>>;
}
export interface SnapshotCapturedFactProfile {
  identity: string;
  caseSensitiveTags: boolean;
  fieldMappings: readonly { sourcePath: string; targetField: string }[];
}
const publicTargets = new Set(["dealKind", "isImageOrderChangeAllowed",
  "facts.roomsType", "facts.windowView", "facts.balconyText", "facts.bathroomType", "facts.renovation",
  "facts.buildingYear", "facts.ceilingHeightM", "facts.heatingSupply", "facts.roomFurniture",
  "facts.parkingType", "facts.lotType", "facts.videoReviewAvailable", "facts.onlineShowAvailable", "facts.disableFlatPlanGuess"]);
const mappedPaths = new Set(["deal-status", "is-image-order-change-allowed", "rooms-type", "window-view", "balcony",
  "bathroom-unit", "renovation", "built-year", "ceiling-height", "heating-supply", "room-furniture", "parking-type",
  "lot-type", "video-review", "online-show", "disable-flat-plan-guess"]);
const basePaths = ["rooms", "floor", "floors-total", "living-space/value", "living-space/unit",
  "kitchen-space/value", "kitchen-space/unit", "lot-area/value", "lot-area/unit", "price/@period",
  "Rooms", "Floor", "Floors", "LivingSpace", "KitchenSpace", "LandArea", "LeaseType",
  "FlatRoomsCount", "FloorNumber", "Building/FloorsCount", "LivingArea", "KitchenArea", "RentTerm"];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SNAPSHOT_GOOD_FACT_INVALID");
  return value as Record<string, unknown>;
}
function fieldValues(fields: unknown, path: string, caseSensitive: boolean): (string | number)[] {
  let nodes = [object(fields)];
  const segments = path.split("/");
  for (const segment of segments) {
    const name = caseSensitive ? segment : segment.toLowerCase();
    if (name.startsWith("@")) {
      if (segment !== segments.at(-1)) throw new Error("SNAPSHOT_GOOD_PROFILE_INVALID");
      return nodes.flatMap((node) => Object.entries(object(node.attributes)).filter(([key]) => key.split("|").at(-1) === name.slice(1))
        .map(([, value]) => z.string().max(2000).parse(value)));
    }
    nodes = nodes.flatMap((node) => Object.entries(object(node.children)).filter(([key]) => key.split("|").at(-1) === name)
      .flatMap(([, values]) => z.array(z.unknown()).max(1000).parse(values).map(object)));
    if (nodes.length > 1000) throw new Error("SNAPSHOT_GOOD_FACT_LIMIT_EXCEEDED");
  }
  return nodes.map((node) => z.union([z.string().max(2000), z.number().finite()]).parse(node.text));
}

/** Exact immutable GOOD lookup: deliberately no live Source/LastGood/profile registry reads. */
export function createSnapshotGoodFactResolver(transaction: DatabaseTransaction) {
  return async function resolve(scope: SourceSnapshotFactScope, rawPins: readonly SnapshotGoodFactPin[],
    profiles: ReadonlyMap<string, SnapshotCapturedFactProfile>): Promise<SnapshotGoodNormalizedFact[]> {
    const pins = z.array(pinSchema).max(200).parse(rawPins);
    id.parse(scope.organizationId); id.parse(scope.projectId);
    if (profiles.size > 50000) throw new Error("SNAPSHOT_GOOD_PROFILE_INVALID");
    if (new Set(pins.map((pin) => pin.uid)).size !== pins.length) throw new Error("SNAPSHOT_GOOD_FACT_DUPLICATE");
    async function page(batch: SnapshotGoodFactPin[]): Promise<SnapshotGoodNormalizedFact[]> {
      if (!batch.length) return [];
      const values = batch.map((pin, index) => Prisma.sql`(${index}::int, ${pin.sourceId}::text,
        ${pin.uid}::text, ${pin.externalOfferId}::text, ${pin.factRevisionId}::text,
        ${pin.normalizedHash}::text, ${pin.factRevisionSequence}::int,
        ${pin.factProfileKey}::text, ${pin.factProfileVersion}::text)`);
      const rows = await transaction.$queryRaw<{ index: number; found: boolean; oversized: boolean; draft: unknown; fields: unknown }[]>(Prisma.sql`
        WITH requested("index", "sourceId", "uid", "externalId", "revisionId", "hash", "sequence", "profileKey", "profileVersion") AS
          (VALUES ${Prisma.join(values)}), selected AS (
          SELECT q."index", coalesce(r."externalId" IS NOT NULL AND r."payload"->'schemaVersion' = '1'::jsonb
            AND jsonb_typeof(r."payload"->'draft') = 'object'
            AND jsonb_typeof(r."payload"->'fields') = 'object', false) AS found,
            r."payload"->'draft' AS draft, r."payload"->'fields' AS fields,
            coalesce(octet_length((r."payload"->'draft')::text), 0)
              + coalesce(octet_length((r."payload"->'fields')::text), 0) AS bytes
          FROM requested q LEFT JOIN "SourceRevisionRecord" r ON r."organizationId" = ${scope.organizationId}
            AND r."projectId" = ${scope.projectId} AND r."sourceId" = q."sourceId"
            AND r."revisionId" = q."revisionId" AND r."externalId" = q."externalId"
            AND r."inventoryUid" = q."uid" AND r."recordHash" = q."hash"
          LEFT JOIN "SourceRevision" v ON v."id" = r."revisionId" AND v."organizationId" = r."organizationId"
            AND v."projectId" = r."projectId" AND v."sourceId" = r."sourceId"
            AND v."status" = 'GOOD' AND v."sequence" = q."sequence"
            AND v."profileKey" = q."profileKey" AND v."profileVersion" = q."profileVersion"
          WHERE r."externalId" IS NULL OR v."id" IS NOT NULL
        ), bounded AS (SELECT *, coalesce(sum(bytes) OVER (), 0) > 4194304 AS oversized FROM selected)
        SELECT "index", found, oversized, CASE WHEN found AND NOT oversized THEN draft END AS draft,
          CASE WHEN found AND NOT oversized THEN fields END AS fields FROM bounded ORDER BY "index"
      `);
      if (rows.length !== batch.length || rows.some((row) => !row.found)) throw new Error("SNAPSHOT_GOOD_FACT_MISSING");
      if (rows.some((row) => row.oversized)) {
        if (batch.length === 1) throw new Error("SNAPSHOT_GOOD_FACT_LIMIT_EXCEEDED");
        const middle = Math.ceil(batch.length / 2);
        return [...await page(batch.slice(0, middle)), ...await page(batch.slice(middle))];
      }
      return rows.map((row, index) => {
        if (row.index !== index) throw new Error("SNAPSHOT_GOOD_FACT_INVALID");
        const pin = batch[index]!; const draft = object(row.draft); const fields = object(row.fields);
        if (draft.externalId !== pin.externalOfferId || normalizedContentHash({ draft: { ...draft, provenance: undefined }, fields }) !== pin.normalizedHash) {
          throw new Error("SNAPSHOT_GOOD_FACT_HASH_MISMATCH");
        }
        const identity = `${pin.factProfileKey}@${pin.factProfileVersion}`;
        const profile = profiles.get(identity);
        if (!profile || profile.identity !== identity || typeof profile.caseSensitiveTags !== "boolean" || profile.fieldMappings.length > 200) {
          throw new Error("SNAPSHOT_GOOD_PROFILE_INVALID");
        }
        const publicMappings = profile.fieldMappings.filter((mapping) => publicTargets.has(mapping.targetField));
        if (publicMappings.some((mapping) => !mappedPaths.has(mapping.sourcePath))) throw new Error("SNAPSHOT_GOOD_PROFILE_INVALID");
        const paths = new Set([...basePaths, ...publicMappings.map((mapping) => mapping.sourcePath)]);
        const safeFields: Record<string, (string | number)[]> = {};
        for (const path of paths) {
          if (!/^[\w@/-]{1,240}$/u.test(path) || path.split("/").length > 10) throw new Error("SNAPSHOT_GOOD_PROFILE_INVALID");
          const values = fieldValues(fields, path, profile.caseSensitiveTags);
          if (values.length) safeFields[path] = values;
        }
        const { address, ...normalized } = draftSchema.parse(draft);
        const privatePaths = new Set(["location/apartment", "FlatNumber", "ApartmentNumber", "Apartment"]);
        const configuredPrivatePaths = profile.fieldMappings.filter((mapping) => mapping.targetField === "address.apartmentNumberPrivate");
        if (configuredPrivatePaths.some((mapping) => !privatePaths.has(mapping.sourcePath))) throw new Error("SNAPSHOT_GOOD_PROFILE_INVALID");
        const privateValues = [...new Set([...privatePaths].flatMap((path) => fieldValues(fields, path, profile.caseSensitiveTags))
          .map(String).map((value) => value.trim()).filter(Boolean))];
        if (privateValues.length > 1) throw new Error("SNAPSHOT_PUBLIC_ADDRESS_INVALID");
        return { inventoryUid: pin.uid, sourceId: pin.sourceId, externalOfferId: pin.externalOfferId,
          normalizedHash: pin.normalizedHash, factProfileIdentity: identity, draft: normalized, fieldValues: safeFields,
          ...(address === undefined ? {} : { addressPublic: normalizeSnapshotPublicAddress(address, privateValues[0]) }) };
      });
    }
    return page(pins);
  };
}
