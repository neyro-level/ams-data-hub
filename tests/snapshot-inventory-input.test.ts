import { createUlid, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import { vladisVt24Configuration, joyworkCianProfile } from "../src/modules/ingestion-core/index.ts";
import { prepareSnapshotInventoryInput } from "../src/modules/snapshot-delivery/application/snapshot-inventory-input.ts";
import { SNAPSHOT_INPUT_PART_KINDS, SnapshotInputPartsBuilder, snapshotBuildInputDigest, snapshotInputHash,
  type SnapshotBuildInputReceipt } from "../src/modules/snapshot-delivery/index.ts";

const uid = createUlid(); const date = "2026-10-07T00:00:00.000Z";
function fixture() {
  return { sources: [{ entityType: "profile", identity: "vladis-vt24-v1@1.0.0",
    configuration: structuredClone(vladisVt24Configuration), formatContract: null as unknown }],
  inventory: [{ uid, sourceId: "synthetic-source", externalOfferId: "synthetic-offer", status: "ACTIVE",
    sourceHash: "a".repeat(64), normalizedHash: "b".repeat(64), factProfileIdentity: "vladis-vt24-v1@1.0.0",
    factProfileKey: "vladis-vt24-v1", factProfileVersion: "1.0.0", factRevisionId: "synthetic-good", factRevisionSequence: 1,
    firstSeenAt: date, lastSeenAt: date, sourceCreatedAt: null, sourceUpdatedAt: null, createdAt: date, updatedAt: date }],
  urls: [{ factType: "entry", entityType: "INVENTORY", entityUid: uid, reservation: { publicUrlId: "1234567890123456" } }] };
}
function receipt(data: ReturnType<typeof fixture>): SnapshotBuildInputReceipt {
  const builder = new SnapshotInputPartsBuilder();
  for (const kind of SNAPSHOT_INPUT_PART_KINDS) builder.add(kind, JSON.parse(JSON.stringify(data[kind as keyof typeof data] ?? [])) as CanonicalJsonValue[]);
  const parts = builder.finish(); const value = { id: "synthetic", organizationId: "synthetic-org", projectId: "synthetic-project",
    idempotencyKeyHash: "a".repeat(64), requestHash: "b".repeat(64), inputSchemaVersion: 1, projectorVersion: "db-v1",
    schemaMinor: 0, publishSequence: 1, projectStateRevision: 1, capturedAt: new Date(date), parts, inputHash: "",
    catalogRevision: snapshotInputHash(parts.filter((part) => part.kind === "catalog").map(({ partIndex, payloadHash }) => ({ partIndex, payloadHash }))) };
  value.inputHash = snapshotBuildInputDigest(value); return value;
}
describe("captured inventory preflight", () => {
  it("selects exact GOOD pin, persistent URL and only finite projection settings", () => {
    const input = receipt(fixture()); const before = structuredClone(input); const result = prepareSnapshotInventoryInput(input);
    expect(result.rows[0]).toMatchObject({ pin: { uid, factRevisionId: "synthetic-good", factRevisionSequence: 1 },
      url: { entityType: "INVENTORY", entityUid: uid, publicUrlId: "1234567890123456" } });
    expect(JSON.stringify(result.rows[0]!.profile)).not.toMatch(/sharedOfficePhones|patternSources|safetyPolicy|acceptedNamespaces/u);
    expect(input).toEqual(before);
    (input.parts.find((part) => part.kind === "inventory")!.payload[0] as Record<string, CanonicalJsonValue>).externalOfferId = "changed";
    expect(result.rows[0]!.pin.externalOfferId).toBe("synthetic-offer");
  });
  it("requires a real entry, not a reservation or generated UID fallback", () => {
    const data = fixture(); data.urls = []; expect(() => prepareSnapshotInventoryInput(receipt(data))).toThrow("URL_INVALID");
    const other = fixture(); other.urls[0]!.entityUid = createUlid(); expect(() => prepareSnapshotInventoryInput(receipt(other))).toThrow("URL_INVALID");
  });
  it("rejects mismatched profile pins and duplicate identities or URL associations", () => {
    const mismatch = fixture(); mismatch.inventory[0]!.factProfileVersion = "2.0.0";
    expect(() => prepareSnapshotInventoryInput(receipt(mismatch))).toThrow("PIN_INVALID");
    const duplicate = fixture(); duplicate.inventory.push(duplicate.inventory[0]!);
    expect(() => prepareSnapshotInventoryInput(receipt(duplicate))).toThrow("PIN_INVALID");
    const urls = fixture(); urls.urls.push(urls.urls[0]!);
    expect(() => prepareSnapshotInventoryInput(receipt(urls))).toThrow("URL_INVALID");
  });
  it("rejects ambiguous captured aliases and missing required location configuration", () => {
    const duplicate = fixture(); duplicate.sources[0]!.configuration = { ...duplicate.sources[0]!.configuration, unitAliases: [
      { source: "m2", canonicalUnit: "M2", multiplier: 1 }, { source: " M2 ", canonicalUnit: "M2", multiplier: 100 }] };
    expect(() => prepareSnapshotInventoryInput(receipt(duplicate))).toThrow("PROFILE_INVALID");
    const invalid = fixture(); invalid.sources[0]!.configuration = { ...invalid.sources[0]!.configuration, locationPolicy: undefined } as never;
    expect(() => prepareSnapshotInventoryInput(receipt(invalid))).toThrow("PROFILE_INVALID");
  });
  it("accepts captured format-only CIAN and skips inactive inventory without inventing profile facts", () => {
    const data = fixture(); const identity = `${joyworkCianProfile.key}@${joyworkCianProfile.version}`;
    data.sources[0] = { entityType: "profile", identity, configuration: null as never, formatContract: joyworkCianProfile.formatContract! };
    Object.assign(data.inventory[0]!, { factProfileIdentity: identity, factProfileKey: joyworkCianProfile.key });
    expect(prepareSnapshotInventoryInput(receipt(data)).rows[0]!.profile).toEqual({ identity, configuration: null,
      formatContract: { family: "CIAN_V2" } });
    data.inventory[0]!.status = "INACTIVE"; data.urls = [];
    expect(prepareSnapshotInventoryInput(receipt(data)).rows).toEqual([]);
  });
});
