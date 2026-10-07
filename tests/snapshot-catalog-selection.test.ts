import { createUlid, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";
import { createSnapshotMediaProjectionServer } from "../src/modules/snapshot-delivery/server.ts";
import { selectSnapshotCatalog, projectSnapshotCatalog, projectSnapshotProjectState, SNAPSHOT_INPUT_PART_KINDS,
  SnapshotInputPartsBuilder, snapshotBuildInputDigest, snapshotInputHash, type SnapshotBuildInputReceipt,
  type SnapshotInputPartKind } from "../src/modules/snapshot-delivery/index.ts";

const uid = () => createUlid();
function fixture() {
  const region = uid(); const city = uid(); const outsideCity = uid(); const developer = uid();
  const development = uid(); const excluded = uid(); const outside = uid(); const building = uid(); const inactiveBuilding = uid();
  const base = { name: "Synthetic public name", normalizedName: "synthetic", lifecycle: "ACTIVE", aliases: [], version: 1, mergedIntoUid: null };
  const dev = (key: string, cityUid = city) => ({ ...base, entityType: "development", uid: key, developerUid: developer, cityUid,
    districtUid: null, addressLine: null, latitude: null, longitude: null });
  const block = (key: string) => ({ ...base, entityType: "building", uid: key, developmentUid: development, label: "Synthetic block",
    floors: 2, commissioningYear: null, commissioningQuarter: null, constructionStatus: "PLANNED", material: null, housingClass: null });
  const catalog: Record<string, unknown>[] = [{ ...base, entityType: "region", uid: region, code: "RU-MOW" },
    { ...base, entityType: "city", uid: city, regionUid: region }, { ...base, entityType: "city", uid: outsideCity, regionUid: region },
    { ...base, entityType: "developer", uid: developer }, dev(development), dev(excluded), dev(outside, outsideCity),
    block(building), { ...block(inactiveBuilding), lifecycle: "INACTIVE" }];
  const subscription = { mode: "ALL_SHARED", version: 1, cityUids: [city], selections: [
    { developmentUid: excluded, decision: "EXCLUDE" }, { developmentUid: outside, decision: "INCLUDE" }] };
  const price = (id: string, developmentUid: string, buildingUid: string | null = null) => ({ id, developmentUid, buildingUid,
    observedAt: "2026-10-07T00:00:00.000Z", amount: "10.00", currency: "RUB", basis: "TOTAL", areaM2: null, roomCount: null });
  const data: Partial<Record<SnapshotInputPartKind, unknown[]>> = { project: [{ id: "synthetic-project" }], subscription: [subscription], catalog,
    "listing-links": [{ inventoryUid: uid(), developmentUid: excluded, status: "CONFIRMED" }],
    prices: [price("selected", development, building), price("excluded", excluded), price("outside", outside), price("inactive-block", development, inactiveBuilding)] };
  return { region, city, outsideCity, developer, development, excluded, outside, building, inactiveBuilding, catalog, subscription, data };
}
function receipt(data: Partial<Record<SnapshotInputPartKind, unknown[]>>): SnapshotBuildInputReceipt {
  const builder = new SnapshotInputPartsBuilder();
  for (const kind of SNAPSHOT_INPUT_PART_KINDS) builder.add(kind, JSON.parse(JSON.stringify(data[kind] ?? [])) as CanonicalJsonValue[]);
  const parts = builder.finish(); const input = { id: "synthetic", organizationId: "synthetic-org", projectId: "synthetic-project",
    idempotencyKeyHash: "a".repeat(64), requestHash: "b".repeat(64), inputSchemaVersion: 1, projectorVersion: "db-v1", schemaMinor: 0,
    publishSequence: 1, projectStateRevision: 1, capturedAt: new Date("2026-10-07T00:00:00.000Z"), parts, inputHash: "",
    catalogRevision: snapshotInputHash(parts.filter((part) => part.kind === "catalog").map(({ partIndex, payloadHash }) => ({ partIndex, payloadHash }))) };
  input.inputHash = snapshotBuildInputDigest(input); return input;
}
describe("captured shared catalog cohort", () => {
  it("honors city anchors and EXCLUDE despite confirmed linkage; ALL_SHARED INCLUDE does not extend cities", () => {
    const data = fixture(); const input = receipt(data.data); const before = structuredClone(input); const selection = selectSnapshotCatalog(input);
    expect([...selection.developmentUids]).toEqual([data.development]); expect([...selection.buildingUids]).toEqual([data.building]);
    const projected = projectSnapshotCatalog(input, selection);
    expect(projected.map((dataset) => dataset.records.length)).toEqual([2, 1, 1, 1, 1]);
    expect(projected[4]!.records[0]!.value).toMatchObject({ developmentUid: data.development, buildingUid: data.building });
    expect(input).toEqual(before); expect(projectSnapshotCatalog(input, selectSnapshotCatalog(input))).toEqual(projected);
  });
  it("CURATED uses explicit INCLUDE even outside cities, never linked implicit inclusion", () => {
    const data = fixture(); data.subscription.mode = "CURATED";
    const input = receipt(data.data); const selection = selectSnapshotCatalog(input);
    expect([...selection.developmentUids]).toEqual([data.outside]); expect(selection.includes("city", data.city)).toBe(true);
    expect(selection.includes("city", data.outsideCity)).toBe(true);
    expect(projectSnapshotCatalog(input, selection).map((dataset) => dataset.records.length)).toEqual([3, 1, 1, 0, 1]);
  });
  it.each(["development", "developer", "building"])("omits inactive or merged %s and dependent observations", (type) => {
    for (const field of ["lifecycle", "mergedIntoUid"]) {
      const data = fixture(); const row = data.catalog.find((value) => value.entityType === type && value.uid === data[type as "development" | "developer" | "building"])!;
      row[field] = field === "lifecycle" ? "INACTIVE" : uid();
      const input = receipt(data.data); const selection = selectSnapshotCatalog(input); const projected = projectSnapshotCatalog(input, selection);
      expect(projected[3]!.records).toHaveLength(0); expect(projected[4]!.records).toHaveLength(0);
      if (type !== "building") expect(projected[2]!.records).toHaveLength(0);
    }
  });
  it("prunes catalog editorial while keeping persistent URL/redirect/lifecycle sections", () => {
    const data = fixture(); data.data.editorial = [{ entityType: "DEVELOPMENT", entityUid: data.excluded,
      shortDescription: "Excluded public copy", description: null, faq: [], mediaOrder: [], mediaOrderPolicyVersion: null }];
    const input = receipt(data.data); const projected = projectSnapshotProjectState(input, new Map(), selectSnapshotCatalog(input));
    expect(projected.find((dataset) => dataset.kind === "editorial")!.records).toEqual([]);
    expect(projected.map((dataset) => dataset.kind)).toEqual(["agents", "project/contacts", "editorial", "urls", "redirects", "lifecycle"]);
  });
  it("filters excluded shared owners before HEAD without touching inventory or modifying receipt", async () => {
    const data = fixture(); const asset = { sha256: "a".repeat(64), storageKey: `media/${"a".repeat(64)}`, contentType: "image/png", byteSize: 1, rightsBasis: "OWNED", hasLicense: false };
    const shared = (developmentUid: string) => ({ sharedMediaId: `private-${developmentUid}`, developmentUid, buildingUid: null,
      kind: "DEVELOPMENT_IMAGE", position: 0, provenance: "SHARED_OBSERVATION_MIRROR", relationId: "private-relation",
      mirrorStatus: "MIRRORED", mirroredAt: "2026-10-07T00:00:00.000Z", asset });
    data.data.media = [shared(data.excluded), shared(data.outside)];
    const input = receipt(data.data); const head = vi.fn(); const project = createSnapshotMediaProjectionServer({ organizationId: input.organizationId, projectId: input.projectId, storage: { head } });
    expect((await project(input, selectSnapshotCatalog(input))).dataset.records).toEqual([]); expect(head).not.toHaveBeenCalled();
  });
  it("rejects missing/duplicate subscription or captured identity and missing selected dependency", () => {
    const data = fixture();
    expect(() => selectSnapshotCatalog(receipt({ ...data.data, subscription: [] }))).toThrow("SELECTION_INVALID");
    expect(() => selectSnapshotCatalog(receipt({ ...data.data, subscription: [data.subscription, data.subscription] }))).toThrow("SELECTION_INVALID");
    data.subscription.selections.push({ developmentUid: data.excluded, decision: "INCLUDE" });
    expect(() => selectSnapshotCatalog(receipt(data.data))).toThrow("SELECTION_INVALID");
    const missing = fixture(); missing.data.catalog = missing.catalog.filter((row) => row.uid !== missing.developer);
    expect(() => selectSnapshotCatalog(receipt(missing.data))).toThrow("REFERENCE_BROKEN");
  });
  it("does not admit a receipt with a forged digest", () => {
    expect(() => selectSnapshotCatalog({ ...receipt(fixture().data), inputHash: "c".repeat(64) })).toThrow("SNAPSHOT_INPUT_INVALID");
  });
});
