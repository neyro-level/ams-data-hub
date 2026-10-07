import { ulidSchema, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { catalogCitySchema, catalogDistrictSchema, catalogRegionSchema } from "@ams-data-hub/realty-contracts";
import { z } from "zod";
import { constructionStatusSchema, sharedCatalogLifecycleSchema } from "../../shared-catalog/index.ts";
import type { SnapshotDatasetInput, SnapshotDatasetKind, SnapshotRecordReference } from "../contracts.ts";
import { assertSnapshotPrivacySafe } from "../domain/privacy-scanner.ts";
import { snapshotInputHash, type SnapshotBuildInputReceipt } from "./snapshot-build-input.ts";
import { validateSnapshotInput } from "./snapshot-input-validation.ts";
import type { SnapshotCatalogSelection } from "./snapshot-catalog-selection.ts";

const name = z.string().trim().min(1).max(160);
const catalogName = z.string().trim().min(1).max(200);
const aliases = z.array(catalogName).max(50);
const decimal = z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/u);
const lifecycle = sharedCatalogLifecycleSchema;
export const snapshotGeoPublicSchema = z.discriminatedUnion("entityType", [
  catalogRegionSchema.extend({ entityType: z.literal("region") }).strict(),
  catalogCitySchema.extend({ entityType: z.literal("city") }).strict(),
  catalogDistrictSchema.extend({ entityType: z.literal("district") }).strict(),
]);
export const snapshotDeveloperPublicSchema = z.object({ uid: ulidSchema, name: catalogName, lifecycle, aliases }).strict();
export const snapshotDevelopmentPublicSchema = z.object({ uid: ulidSchema, name: catalogName, developerUid: ulidSchema,
  cityUid: ulidSchema, districtUid: ulidSchema.nullable(), lifecycle, aliases,
  addressLine: z.string().max(500).nullable(),
  latitude: z.string().regex(/^-?\d{1,3}(?:\.\d{1,7})?$/u).refine((value) => Math.abs(Number(value)) <= 90).nullable(),
  longitude: z.string().regex(/^-?\d{1,3}(?:\.\d{1,7})?$/u).refine((value) => Math.abs(Number(value)) <= 180).nullable(),
}).strict();
export const snapshotBuildingPublicSchema = z.object({ uid: ulidSchema, developmentUid: ulidSchema, label: name,
  floors: z.number().int().positive().max(200).nullable(),
  commissioningYear: z.number().int().min(2000).max(2200).nullable(),
  commissioningQuarter: z.number().int().min(1).max(4).nullable(), constructionStatus: constructionStatusSchema,
  material: z.string().max(120).nullable(), housingClass: z.string().max(80).nullable(), lifecycle, aliases: z.array(name).max(50) }).strict();
export const snapshotPricePublicSchema = z.object({ developmentUid: ulidSchema, buildingUid: ulidSchema.nullable(),
  observedAt: z.iso.datetime({ offset: true }), amount: decimal, currency: z.string().regex(/^[A-Z]{3}$/u),
  basis: z.enum(["TOTAL", "PER_SQUARE_METER"]), areaM2: decimal.nullable(), roomCount: z.number().int().nonnegative().nullable() }).strict();

function object(value: CanonicalJsonValue): Record<string, CanonicalJsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SNAPSHOT_CATALOG_FACT_INVALID");
  return value;
}
function publicAliases(value: CanonicalJsonValue | undefined): string[] {
  if (!Array.isArray(value)) throw new Error("SNAPSHOT_CATALOG_FACT_INVALID");
  return aliases.parse(value.map((item) => object(item).value));
}

/** Candidate closure projection only. Subscription policy filtering is a separate step. */
export function projectSnapshotCatalog(input: SnapshotBuildInputReceipt, selection?: SnapshotCatalogSelection): SnapshotDatasetInput[] {
  const parts = validateSnapshotInput(input);
  const kinds = ["geo", "developers", "developments", "buildings", "prices"] as const;
  const datasets: SnapshotDatasetInput[] = kinds.map((kind) => ({ kind, records: [] }));
  const byKind = new Map(datasets.map((dataset) => [dataset.kind, dataset]));
  const buffers = new Map(kinds.map((kind) => [kind, [] as SnapshotDatasetInput["records"][number][]]));
  const index = new Set<string>();
  const values = new Map<string, Record<string, CanonicalJsonValue>>();
  function add(kind: SnapshotDatasetKind, key: string, value: unknown, references: SnapshotRecordReference[] = []) {
    const identity = `${kind}\0${key}`;
    if (index.has(identity)) throw new Error("SNAPSHOT_RECORD_DUPLICATE");
    const encoded = value as CanonicalJsonValue;
    assertSnapshotPrivacySafe(encoded);
    const records = buffers.get(kind as typeof kinds[number]);
    if (!records) throw new Error("SNAPSHOT_CATALOG_FACT_INVALID");
    records.push({ key, value: encoded, references });
    byKind.get(kind)!.records = records;
    index.add(identity);
    values.set(identity, object(encoded));
  }
  for (const part of parts) if (part.kind === "catalog") for (const item of part.payload) {
    const row = object(item);
    const key = ulidSchema.parse(row.uid);
    const type = row.entityType;
    if (selection && (typeof type !== "string" || !selection.includes(type, key))) continue;
    if (type === "region" || type === "city" || type === "district") {
      const base = { entityType: type, uid: key, name: row.name, normalizedName: row.normalizedName,
        lifecycle: row.lifecycle, aliases: row.aliases };
      const value = type === "region" ? { ...base, code: row.code }
        : type === "city" ? { ...base, regionUid: row.regionUid } : { ...base, cityUid: row.cityUid };
      const parsed = snapshotGeoPublicSchema.parse(value);
      add("geo", key, parsed, parsed.entityType === "region" ? [] : [{ kind: "geo",
        key: parsed.entityType === "city" ? parsed.regionUid : parsed.cityUid }]);
    } else if (type === "developer") {
      add("developers", key, snapshotDeveloperPublicSchema.parse({ uid: key, name: row.name,
        lifecycle: row.lifecycle, aliases: publicAliases(row.aliases) }));
    } else if (type === "development") {
      const value = snapshotDevelopmentPublicSchema.parse({ uid: key, name: row.name, developerUid: row.developerUid,
        cityUid: row.cityUid, districtUid: row.districtUid, lifecycle: row.lifecycle, aliases: publicAliases(row.aliases),
        addressLine: row.addressLine, latitude: row.latitude, longitude: row.longitude });
      add("developments", key, value, [{ kind: "developers", key: value.developerUid }, { kind: "geo", key: value.cityUid },
        ...(value.districtUid ? [{ kind: "geo" as const, key: value.districtUid }] : [])]);
    } else if (type === "building") {
      const value = snapshotBuildingPublicSchema.parse({ uid: key, developmentUid: row.developmentUid,
        label: row.label, floors: row.floors, commissioningYear: row.commissioningYear,
        commissioningQuarter: row.commissioningQuarter, constructionStatus: row.constructionStatus,
        material: row.material, housingClass: row.housingClass, lifecycle: row.lifecycle, aliases: publicAliases(row.aliases) });
      add("buildings", key, value, [{ kind: "developments", key: value.developmentUid }]);
    } else throw new Error("SNAPSHOT_CATALOG_FACT_INVALID");
  }
  for (const part of parts) if (part.kind === "prices") for (const item of part.payload) {
    const row = object(item);
    if (selection && (!selection.developmentUids.has(ulidSchema.parse(row.developmentUid))
      || (row.buildingUid !== null && !selection.buildingUids.has(ulidSchema.parse(row.buildingUid))))) continue;
    const value = snapshotPricePublicSchema.parse({ developmentUid: row.developmentUid, buildingUid: row.buildingUid,
      observedAt: row.observedAt, amount: row.amount, currency: row.currency, basis: row.basis,
      areaM2: row.areaM2, roomCount: row.roomCount });
    if (typeof row.id !== "string" || !row.id) throw new Error("SNAPSHOT_CATALOG_FACT_INVALID");
    add("prices", snapshotInputHash({ observationId: row.id }), value,
      [{ kind: "developments", key: value.developmentUid },
        ...(value.buildingUid ? [{ kind: "buildings" as const, key: value.buildingUid }] : [])]);
  }
  for (const dataset of datasets) for (const record of dataset.records) for (const reference of record.references ?? []) {
    if (!index.has(`${reference.kind}\0${reference.key}`)) throw new Error("SNAPSHOT_REFERENCE_BROKEN");
  }
  const invalid = () => { throw new Error("SNAPSHOT_REFERENCE_BROKEN"); };
  for (const row of buffers.get("geo")!) {
    const value = object(row.value);
    if (value.entityType === "city" && values.get(`geo\0${value.regionUid}`)?.entityType !== "region") invalid();
    if (value.entityType === "district" && values.get(`geo\0${value.cityUid}`)?.entityType !== "city") invalid();
  }
  for (const row of buffers.get("developments")!) {
    const value = object(row.value);
    if (values.get(`geo\0${value.cityUid}`)?.entityType !== "city") invalid();
    if (value.districtUid !== null) {
      const district = values.get(`geo\0${value.districtUid}`);
      if (district?.entityType !== "district" || district.cityUid !== value.cityUid) invalid();
    }
  }
  for (const row of buffers.get("prices")!) {
    const value = object(row.value);
    if (value.buildingUid !== null
      && values.get(`buildings\0${value.buildingUid}`)?.developmentUid !== value.developmentUid) invalid();
  }
  return datasets.map((dataset) => ({ ...dataset, records: [...dataset.records].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) }));
}
