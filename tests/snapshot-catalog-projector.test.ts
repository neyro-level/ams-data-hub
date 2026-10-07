import { createUlid, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import {
  projectSnapshotCatalog, SNAPSHOT_INPUT_PART_KINDS, SnapshotInputPartsBuilder,
  snapshotBuildInputDigest, snapshotInputHash, snapshotPricePublicSchema,
  type SnapshotBuildInputReceipt,
} from "../src/modules/snapshot-delivery/index.ts";

function input(catalog: CanonicalJsonValue[] = [], prices: CanonicalJsonValue[] = []): SnapshotBuildInputReceipt {
  const builder = new SnapshotInputPartsBuilder();
  for (const kind of SNAPSHOT_INPUT_PART_KINDS) builder.add(kind, kind === "catalog" ? catalog : kind === "prices" ? prices : []);
  const parts = builder.finish();
  const receipt = { id: "synthetic", organizationId: "synthetic-org", projectId: "synthetic-project",
    idempotencyKeyHash: "a".repeat(64), requestHash: "b".repeat(64), inputSchemaVersion: 1,
    projectorVersion: "db-v1", schemaMinor: 0, publishSequence: 1, projectStateRevision: 1,
    capturedAt: new Date("2026-10-07T00:00:00.000Z"), parts,
    catalogRevision: snapshotInputHash(parts.filter((part) => part.kind === "catalog")
      .map(({ partIndex, payloadHash }) => ({ partIndex, payloadHash }))), inputHash: "" };
  receipt.inputHash = snapshotBuildInputDigest(receipt);
  return receipt;
}
function fixture() {
  const [region, city, district, developer, development, building] = Array.from({ length: 6 }, () => createUlid()) as [string, string, string, string, string, string];
  const base = { name: "Synthetic", normalizedName: "synthetic", lifecycle: "ACTIVE", aliases: [], version: 1 };
  const catalog = [
    { ...base, entityType: "building", uid: building, developmentUid: development, label: "One", floors: 10,
      commissioningYear: 2027, commissioningQuarter: 2, constructionStatus: "UNDER_CONSTRUCTION", material: null, housingClass: null },
    { ...base, entityType: "development", uid: development, developerUid: developer, cityUid: city, districtUid: district,
      addressLine: "Synthetic public street", latitude: "55.123456", longitude: "37.123456", mergedIntoUid: null },
    { ...base, entityType: "developer", uid: developer, aliases: [{ value: "Public alias", normalizedValue: "public alias" }] },
    { ...base, entityType: "district", uid: district, cityUid: city },
    { ...base, entityType: "city", uid: city, regionUid: region },
    { ...base, entityType: "region", uid: region, code: "RU-MOW" },
  ];
  const price = { id: "synthetic-observation", sourceId: "private-source", externalId: "private-offer",
    developmentUid: development, buildingUid: building, amount: "9999999999999999.99", currency: "RUB",
    observedAt: "2026-10-07T00:00:00.000Z", basis: "TOTAL", areaM2: "40.01", roomCount: 0 };
  return { catalog, price, building, development, region };
}

describe("captured catalog public projectors", () => {
  it("projects five strict datasets with complete references and exact decimals", () => {
    const data = fixture();
    const receipt = input(data.catalog, [data.price]);
    const before = structuredClone(receipt);
    const datasets = projectSnapshotCatalog(receipt);
    expect(datasets.map((dataset) => dataset.kind)).toEqual(["geo", "developers", "developments", "buildings", "prices"]);
    expect(datasets.map((dataset) => dataset.records.length)).toEqual([3, 1, 1, 1, 1]);
    expect(datasets[4]!.records[0]!.value).toMatchObject({ amount: "9999999999999999.99", areaM2: "40.01", roomCount: 0 });
    expect(datasets[3]!.records[0]!.references).toEqual([{ kind: "developments", key: data.development }]);
    const serialized = JSON.stringify(datasets);
    for (const field of ["private-source", "private-offer", "sourceId", "externalId", "mergedIntoUid", "synthetic-observation"]) {
      expect(serialized).not.toContain(field);
    }
    expect(receipt).toEqual(before);
    expect(projectSnapshotCatalog(receipt)).toEqual(datasets);
  });
  it("emits explicit empty datasets without pretending to project the other eight", () => {
    expect(projectSnapshotCatalog(input())).toEqual(["geo", "developers", "developments", "buildings", "prices"]
      .map((kind) => ({ kind, records: [] })));
  });
  it("has stable ordering independent of captured catalog row order", () => {
    const data = fixture();
    expect(projectSnapshotCatalog(input(data.catalog, [data.price])))
      .toEqual(projectSnapshotCatalog(input([...data.catalog].reverse(), [data.price])));
  });
  it("rejects missing closure references, duplicate identities and unknown fact types", () => {
    const data = fixture();
    expect(() => projectSnapshotCatalog(input(data.catalog.filter((row) => row.uid !== data.region))))
      .toThrow("SNAPSHOT_REFERENCE_BROKEN");
    expect(() => projectSnapshotCatalog(input([...data.catalog, data.catalog[0]!]))).toThrow("SNAPSHOT_RECORD_DUPLICATE");
    expect(() => projectSnapshotCatalog(input([{ uid: createUlid(), entityType: "unknown" }]))).toThrow("SNAPSHOT_CATALOG_FACT_INVALID");
  });
  it("rejects tampered hashes, header, ordering, part indices and incomplete inputs", () => {
    const valid = input();
    for (const mutate of [
      (value: SnapshotBuildInputReceipt) => { value.inputHash = "f".repeat(64); },
      (value: SnapshotBuildInputReceipt) => { value.catalogRevision = "f".repeat(64); },
      (value: SnapshotBuildInputReceipt) => { value.parts[0]!.payload.push({ secret: "synthetic" }); },
      (value: SnapshotBuildInputReceipt) => { value.parts.reverse(); },
      (value: SnapshotBuildInputReceipt) => { value.parts[0]!.partIndex = 3; },
      (value: SnapshotBuildInputReceipt) => { value.publishSequence = 0; },
      (value: SnapshotBuildInputReceipt) => { value.parts.pop(); },
    ]) {
      const copy = structuredClone(valid); mutate(copy);
      expect(() => projectSnapshotCatalog(copy)).toThrow();
    }
  });
  it("does not spread private fields from a valid captured record", () => {
    const data = fixture();
    const catalog = data.catalog.map((row) => ({ ...row, privateMetadata: "private-marker", rawRecord: "private-marker" }));
    expect(JSON.stringify(projectSnapshotCatalog(input(catalog, [data.price])))).not.toContain("private-marker");
  });
  it("validates public rows rather than accepting HTML, malformed decimals or unchecked metadata", () => {
    const data = fixture(); data.catalog[1]!.name = "<script>synthetic</script>";
    expect(() => projectSnapshotCatalog(input(data.catalog))).toThrow("SNAPSHOT_PRIVACY_RAW_HTML");
    expect(snapshotPricePublicSchema.safeParse({ ...data.price, amount: "1e10" }).success).toBe(false);
    expect(snapshotPricePublicSchema.safeParse({ ...data.price, amount: 1 }).success).toBe(false);
  });
  it("rejects cross-parent and wrong-kind reference targets even when their UIDs exist", () => {
    const data = fixture();
    const wrongCity = data.catalog.map((row) => row.entityType === "development" ? { ...row, cityUid: data.region } : row);
    expect(() => projectSnapshotCatalog(input(wrongCity))).toThrow("SNAPSHOT_REFERENCE_BROKEN");
    const wrongDistrict = data.catalog.map((row) => row.entityType === "development" ? { ...row, districtUid: data.region } : row);
    expect(() => projectSnapshotCatalog(input(wrongDistrict))).toThrow("SNAPSHOT_REFERENCE_BROKEN");
    const otherDevelopmentUid = createUlid();
    const otherDevelopment = { ...data.catalog[1]!, uid: otherDevelopmentUid };
    expect(() => projectSnapshotCatalog(input([...data.catalog, otherDevelopment], [{ ...data.price, developmentUid: otherDevelopmentUid }])))
      .toThrow("SNAPSHOT_REFERENCE_BROKEN");
  });
  it("preserves seven-place shared catalog coordinates and PER_SQUARE_METER prices", () => {
    const data = fixture();
    const catalog = data.catalog.map((row) => row.entityType === "development" ? { ...row, latitude: "55.1234567" } : row);
    const datasets = projectSnapshotCatalog(input(catalog, [{ ...data.price, basis: "PER_SQUARE_METER" }]));
    expect(datasets[2]!.records[0]!.value).toMatchObject({ latitude: "55.1234567" });
    expect(datasets[4]!.records[0]!.value).toMatchObject({ basis: "PER_SQUARE_METER" });
  });
  it("accepts persisted developer/development names and aliases up to 200 characters", () => {
    const data = fixture();
    const catalog = data.catalog.map((row) => row.entityType === "development" || row.entityType === "developer"
      ? { ...row, name: "n".repeat(200), aliases: [{ value: "a".repeat(200), normalizedValue: "a".repeat(200) }] } : row);
    const datasets = projectSnapshotCatalog(input(catalog));
    expect(datasets[1]!.records[0]!.value).toMatchObject({ name: "n".repeat(200), aliases: ["a".repeat(200)] });
    expect(datasets[2]!.records[0]!.value).toMatchObject({ name: "n".repeat(200), aliases: ["a".repeat(200)] });
  });
});
