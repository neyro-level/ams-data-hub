import { ulidSchema } from "@ams-data-hub/data-contracts";
import { z } from "zod";
import { sharedCatalogLifecycleSchema } from "../../shared-catalog/index.ts";
import type { SnapshotBuildInputReceipt } from "./snapshot-build-input.ts";
import { validateSnapshotInput } from "./snapshot-input-validation.ts";

const subscriptionSchema = z.object({ mode: z.enum(["ALL_SHARED", "CURATED"]), version: z.number().int().positive(),
  cityUids: z.array(ulidSchema).max(100), selections: z.array(z.object({ developmentUid: ulidSchema,
    decision: z.enum(["INCLUDE", "EXCLUDE"]) }).strict()).max(500) }).strict();
const typeSchema = z.enum(["region", "city", "district", "developer", "development", "building"]);
type CatalogType = z.infer<typeof typeSchema>;
const base = { uid: ulidSchema, lifecycle: sharedCatalogLifecycleSchema, mergedIntoUid: ulidSchema.nullable() };
const developerSchema = z.object(base);
const developmentSchema = z.object({ ...base, developerUid: ulidSchema, cityUid: ulidSchema, districtUid: ulidSchema.nullable() });
const buildingSchema = z.object({ ...base, developmentUid: ulidSchema });
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SNAPSHOT_CATALOG_SELECTION_INVALID");
  return value as Record<string, unknown>;
}
export interface SnapshotCatalogSelection {
  readonly developmentUids: ReadonlySet<string>;
  readonly buildingUids: ReadonlySet<string>;
  includes(type: string, uid: string): boolean;
}

/** Captured candidate closure is not publication authority. No new receipt/hash is manufactured. */
export function selectSnapshotCatalog(input: SnapshotBuildInputReceipt): SnapshotCatalogSelection {
  const parts = validateSnapshotInput(input);
  const subscriptions = parts.filter((part) => part.kind === "subscription").flatMap((part) => part.payload);
  if (subscriptions.length !== 1) throw new Error("SNAPSHOT_CATALOG_SELECTION_INVALID");
  const parsed = subscriptionSchema.safeParse(subscriptions[0]);
  if (!parsed.success) throw new Error("SNAPSHOT_CATALOG_SELECTION_INVALID");
  const subscription = parsed.data;
  const cities = new Set(subscription.cityUids);
  const decisions = new Map(subscription.selections.map((row) => [row.developmentUid, row.decision]));
  if (cities.size !== subscription.cityUids.length || decisions.size !== subscription.selections.length) {
    throw new Error("SNAPSHOT_CATALOG_SELECTION_INVALID");
  }
  const index = new Map<CatalogType, Map<string, Record<string, unknown>>>(typeSchema.options.map((type) => [type, new Map()]));
  for (const part of parts) if (part.kind === "catalog") for (const raw of part.payload) {
    const row = object(raw); const type = typeSchema.safeParse(row.entityType); const uid = ulidSchema.safeParse(row.uid);
    if (!type.success || !uid.success || index.get(type.data)!.has(uid.data)) throw new Error("SNAPSHOT_CATALOG_SELECTION_INVALID");
    index.get(type.data)!.set(uid.data, row);
  }
  const selected = new Map<CatalogType, Set<string>>(typeSchema.options.map((type) => [type, new Set()]));
  const requireRow = (type: CatalogType, uid: string) => {
    const row = index.get(type)!.get(uid); if (!row) throw new Error("SNAPSHOT_REFERENCE_BROKEN"); return row;
  };
  const addCity = (uid: string) => {
    const city = requireRow("city", uid); const region = ulidSchema.parse(city.regionUid);
    requireRow("region", region); selected.get("city")!.add(uid); selected.get("region")!.add(region);
  };
  for (const uid of cities) addCity(uid);
  for (const raw of index.get("development")!.values()) {
    const row = developmentSchema.parse(raw);
    const decision = decisions.get(row.uid);
    if (decision === "EXCLUDE" || (subscription.mode === "ALL_SHARED" ? !cities.has(row.cityUid) : decision !== "INCLUDE")) continue;
    const developer = developerSchema.parse(requireRow("developer", row.developerUid));
    if (row.lifecycle !== "ACTIVE" || row.mergedIntoUid !== null || developer.lifecycle !== "ACTIVE" || developer.mergedIntoUid !== null) continue;
    selected.get("development")!.add(row.uid); selected.get("developer")!.add(row.developerUid); addCity(row.cityUid);
    if (row.districtUid) {
      const district = requireRow("district", row.districtUid);
      if (district.cityUid !== row.cityUid) throw new Error("SNAPSHOT_REFERENCE_BROKEN");
      selected.get("district")!.add(row.districtUid);
    }
  }
  if (subscription.mode === "CURATED") for (const [uid, decision] of decisions) if (decision === "INCLUDE") requireRow("development", uid);
  for (const raw of index.get("building")!.values()) {
    const row = buildingSchema.parse(raw);
    if (selected.get("development")!.has(row.developmentUid) && row.lifecycle === "ACTIVE" && row.mergedIntoUid === null) selected.get("building")!.add(row.uid);
  }
  return { developmentUids: selected.get("development")!, buildingUids: selected.get("building")!,
    includes: (type, uid) => selected.get(type as CatalogType)?.has(uid) ?? false };
}
