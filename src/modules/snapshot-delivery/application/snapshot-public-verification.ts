import { canonicalJson, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { publicInventoryDtoSchema } from "@ams-data-hub/realty-contracts";
import { createSnapshotVerifier, type SnapshotDatasetKind } from "@ams-data-hub/snapshot-verifier";
import { z } from "zod";
import { projectEditorialPublicDtoSchema } from "../../project-state/index.ts";
import { assertSnapshotPrivacySafe } from "../domain/privacy-scanner.ts";
import { snapshotGeoPublicSchema, snapshotDeveloperPublicSchema, snapshotDevelopmentPublicSchema,
  snapshotBuildingPublicSchema, snapshotPricePublicSchema } from "./snapshot-catalog-projector.ts";
import { snapshotMediaPublicSchema } from "./snapshot-media-projector.ts";
import { snapshotAgentPublicSchema, snapshotContactPublicSchema, snapshotUrlPublicSchema,
  snapshotRedirectPublicSchema, snapshotLifecyclePublicSchema } from "./snapshot-project-state-projector.ts";

const records = <T extends z.ZodType>(schema: T) => z.array(schema).superRefine((values) => {
  // Reuse the BUILD privacy policy, including the dedicated safe-HTML exception.
  for (const value of values) assertSnapshotPrivacySafe(value as CanonicalJsonValue);
});
const schemas = {
  geo: records(snapshotGeoPublicSchema), developers: records(snapshotDeveloperPublicSchema),
  developments: records(snapshotDevelopmentPublicSchema), buildings: records(snapshotBuildingPublicSchema),
  prices: records(snapshotPricePublicSchema), media: records(snapshotMediaPublicSchema),
  inventory: records(publicInventoryDtoSchema), agents: records(snapshotAgentPublicSchema),
  "project/contacts": records(snapshotContactPublicSchema).max(1), editorial: records(projectEditorialPublicDtoSchema),
  urls: records(snapshotUrlPublicSchema), redirects: records(snapshotRedirectPublicSchema), lifecycle: records(snapshotLifecyclePublicSchema),
} as const;
type PublicDatasets = { [K in keyof typeof schemas]: z.output<typeof schemas[K]> };

function unique<T>(values: readonly T[], key: (value: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = key(value);
    if (result.has(id)) throw new Error("SNAPSHOT_RECORD_DUPLICATE");
    result.set(id, value);
  }
  return result;
}

/** Called only after all thirteen strict schemas have accepted their decoded values.
 * Private observation/event/redirect target IDs are not serialized and cannot be inferred. */
function references(datasets: Readonly<Record<SnapshotDatasetKind, readonly unknown[]>>): boolean {
  const d = datasets as PublicDatasets;
  const geo = unique(d.geo, (row) => row.uid);
  const developers = unique(d.developers, (row) => row.uid);
  const developments = unique(d.developments, (row) => row.uid);
  const buildings = unique(d.buildings, (row) => row.uid);
  const inventory = unique(d.inventory, (row) => row.uid);
  const agents = unique(d.agents, (row) => row.uid);
  const entities = { DEVELOPER: developers, DEVELOPMENT: developments, BUILDING: buildings, INVENTORY: inventory, AGENT: agents };
  for (const row of d.geo) {
    if (row.entityType === "city" && geo.get(row.regionUid)?.entityType !== "region") return false;
    if (row.entityType === "district" && geo.get(row.cityUid)?.entityType !== "city") return false;
  }
  for (const row of d.developments) {
    if (!developers.has(row.developerUid) || geo.get(row.cityUid)?.entityType !== "city") return false;
    if (row.districtUid !== null) {
      const district = geo.get(row.districtUid);
      if (district?.entityType !== "district" || district.cityUid !== row.cityUid) return false;
    }
  }
  for (const row of d.buildings) if (!developments.has(row.developmentUid)) return false;
  for (const row of d.prices) {
    if (!developments.has(row.developmentUid)) return false;
    if (row.buildingUid !== null && buildings.get(row.buildingUid)?.developmentUid !== row.developmentUid) return false;
  }
  const reservations = unique(d.urls.filter((row) => row.factType === "reservation"), (row) => row.publicUrlId);
  const entries = unique(d.urls.filter((row) => row.factType === "entry"), (row) => row.publicUrlId);
  unique([...entries.values()], (row) => row.canonicalPath);
  // A reservation retains its original subject across a legitimate relink.
  for (const row of entries.values()) if (!reservations.has(row.publicUrlId)) return false;
  for (const row of d.inventory) {
    const entry = entries.get(row.publicUrlId);
    if (!entry || entry.entityType !== "INVENTORY" || entry.entityUid !== row.uid) return false;
    if (row.agentUid !== undefined && !agents.has(row.agentUid)) return false;
  }
  unique(d.editorial, (row) => `${row.entityType}/${row.entityUid}`);
  for (const row of d.editorial) if (!entities[row.entityType].has(row.entityUid)) return false;
  unique(d.redirects, (row) => row.fromPath);
  unique(d.lifecycle.filter((row) => row.factType === "inventory-state"), (row) => row.inventoryUid);
  unique(d.lifecycle.filter((row) => row.factType === "url-tombstone"), (row) => row.canonicalPath);
  for (const row of d.lifecycle) {
    if (row.factType === "url-tombstone" && !reservations.has(row.publicUrlId)) return false;
    // Inactive identities and historical events need not be in public inventory.
  }
  const media = unique(d.media, (row) => `${row.entityType}/${row.entityUid}/${row.media.position}`);
  for (const row of d.media) if (!entities[row.entityType].has(row.entityUid)) return false;
  const embedded = new Set<string>();
  for (const [type, rows] of [["INVENTORY", d.inventory], ["AGENT", d.agents]] as const) for (const row of rows) {
    for (const item of row.media) {
      const key = `${type}/${row.uid}/${item.position}`;
      if (embedded.has(key)) return false;
      embedded.add(key);
      const attachment = media.get(key);
      if (!attachment || canonicalJson(attachment.media) !== canonicalJson(item)) return false;
    }
  }
  for (const row of d.media) if ((row.entityType === "INVENTORY" || row.entityType === "AGENT")
    && !embedded.has(`${row.entityType}/${row.entityUid}/${row.media.position}`)) return false;
  return true;
}

/** Project-owned policy: no caller-provided schemas, permissive callback or limit widening. */
export const verifySnapshotPublicArtifacts = createSnapshotVerifier({
  datasetSchemas: Object.freeze(schemas), validateReferences: references,
});
