import { createUlid, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import { vladisVt24Configuration, joyworkCianProfile } from "../src/modules/ingestion-core/index.ts";
import { prepareSnapshotInventoryInput } from "../src/modules/snapshot-delivery/application/snapshot-inventory-input.ts";
import { SNAPSHOT_INPUT_PART_KINDS, SnapshotInputPartsBuilder, snapshotBuildInputDigest, snapshotInputHash,
  type SnapshotBuildInputReceipt } from "../src/modules/snapshot-delivery/index.ts";

const uid = createUlid(); const date = "2026-10-07T00:00:00.000Z";
const approval = (revisionId = "synthetic-good", sequence = 1) => ({ version: 1, disposition: "SAFE", sourceId: "synthetic-source",
  revisionId, sequence, policyHash: "c".repeat(64), analysisHash: "d".repeat(64),
  baseRevisionId: sequence === 1 ? null : "synthetic-good", previousGoodRecordCount: sequence === 1 ? null : 1 });
function fixture() {
  return { sources: [{ entityType: "profile", identity: "vladis-vt24-v1@1.0.0",
    configuration: structuredClone(vladisVt24Configuration), formatContract: null as unknown }],
  inventory: [{ uid, sourceId: "synthetic-source", externalOfferId: "synthetic-offer", status: "ACTIVE",
    sourceHash: "a".repeat(64), normalizedHash: "b".repeat(64), factProfileIdentity: "vladis-vt24-v1@1.0.0",
    factProfileKey: "vladis-vt24-v1", factProfileVersion: "1.0.0", factRevisionId: "synthetic-good", factRevisionSequence: 1,
    approvedHeadId: "synthetic-good", approvedHeadSequence: 1,
    factApproval: approval(),
    firstSeenAt: date, lastSeenAt: date, sourceCreatedAt: null, sourceUpdatedAt: null, createdAt: date, updatedAt: date }],
  urls: [{ factType: "entry", entityType: "INVENTORY", entityUid: uid, reservation: { publicUrlId: "1234567890123456" } }] };
}
const capturedSource = () => ({ entityType: "source", sourceId: "synthetic-source",
  approvedHead: { id: "synthetic-good", status: "GOOD", sequence: 1, approval: approval() } });
function receipt(data: ReturnType<typeof fixture>, sources: unknown[] = [capturedSource()]): SnapshotBuildInputReceipt {
  const builder = new SnapshotInputPartsBuilder();
  for (const kind of SNAPSHOT_INPUT_PART_KINDS) builder.add(kind, JSON.parse(JSON.stringify([
    ...(data[kind as keyof typeof data] ?? []), ...(kind === "sources" ? sources : []),
  ])) as CanonicalJsonValue[]);
  const parts = builder.finish(); const value = { id: "synthetic", organizationId: "synthetic-org", projectId: "synthetic-project",
    idempotencyKeyHash: "a".repeat(64), requestHash: "b".repeat(64), inputSchemaVersion: 1, projectorVersion: "db-v1",
    schemaMinor: 0, publishSequence: 1, projectStateRevision: 1, capturedAt: new Date(date), parts, inputHash: "",
    catalogRevision: snapshotInputHash(parts.filter((part) => part.kind === "catalog").map(({ partIndex, payloadHash }) => ({ partIndex, payloadHash }))) };
  value.inputHash = snapshotBuildInputDigest(value); return value;
}
describe("captured inventory preflight", () => {
  it("requires unique captured sources and exact approved head membership", () => {
    const missing = fixture(); expect(() => prepareSnapshotInventoryInput(receipt(missing, []))).toThrow("SOURCE_COMPOSITION_INVALID");
    expect(() => prepareSnapshotInventoryInput(receipt(fixture(), [capturedSource(), capturedSource()]))).toThrow("SOURCE_COMPOSITION_INVALID");
    expect(() => prepareSnapshotInventoryInput(receipt(fixture(), [{ ...capturedSource(), approvedHead: null }]))).toThrow("SOURCE_COMPOSITION_INVALID");
    for (const patch of [{ approvedHeadId: "foreign-head" }, { approvedHeadSequence: 2 },
      { factRevisionSequence: 2 }, { factRevisionId: "other-at-same-sequence" }]) {
      const data = fixture(); Object.assign(data.inventory[0]!, patch);
      expect(() => prepareSnapshotInventoryInput(receipt(data))).toThrow("SOURCE_COMPOSITION_INVALID");
    }
    const historical = fixture(); const head = capturedSource(); head.approvedHead = { id: "synthetic-new-head", status: "GOOD", sequence: 2,
      approval: approval("synthetic-new-head", 2) };
    Object.assign(historical.inventory[0]!, { approvedHeadId: "synthetic-new-head", approvedHeadSequence: 2 });
    expect(prepareSnapshotInventoryInput(receipt(historical, [head])).rows[0]!.pin.factRevisionId).toBe("synthetic-good");
    historical.inventory[0]!.factRevisionId = "synthetic-new-head";
    expect(() => prepareSnapshotInventoryInput(receipt(historical, [head]))).toThrow("SOURCE_COMPOSITION_INVALID");
  });
  it("requires finite matching head/fact approval and never passes proof fields to identity", () => {
    const data = fixture(); const source = capturedSource(); source.approvedHead.approval.sourceId = "foreign-source";
    expect(() => prepareSnapshotInventoryInput(receipt(data, [source]))).toThrow("SOURCE_COMPOSITION_INVALID");
    data.inventory[0]!.factApproval.analysisHash = "e".repeat(64);
    expect(() => prepareSnapshotInventoryInput(receipt(data))).toThrow("SOURCE_COMPOSITION_INVALID");
    const missing = fixture(); delete (missing.inventory[0] as Record<string, unknown>).factApproval;
    expect(() => prepareSnapshotInventoryInput(receipt(missing))).toThrow("INVENTORY_INPUT_INVALID");
    expect(prepareSnapshotInventoryInput(receipt(fixture())).rows[0]!.identity).not.toHaveProperty("factApproval");
  });
  it("keeps producer-off GOOD and permits an empty source without an approved head", () => {
    const source = { ...capturedSource(), enabled: false };
    expect(prepareSnapshotInventoryInput(receipt(fixture(), [source])).rows).toHaveLength(1);
    const empty = fixture(); empty.inventory = []; empty.urls = [];
    expect(prepareSnapshotInventoryInput(receipt(empty, [{ ...source, approvedHead: null }])).rows).toEqual([]);
  });
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
