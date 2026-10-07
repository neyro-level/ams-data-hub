import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";
import { createSnapshotGoodFactResolver, normalizedContentHash, type SnapshotGoodFactPin } from "../src/modules/ingestion-core/server.ts";
import type { DatabaseTransaction } from "../src/platform/database/transaction.ts";

const scope = { organizationId: "synthetic-org", projectId: "synthetic-project" };
const node = (text: string | number) => ({ text, attributes: {}, children: {} });
function fixture() {
  const draft = { sourceFormat: "YRL_2010", externalId: "private-external", propertyType: "APARTMENT", transactionType: "SALE",
    title: "Synthetic public title", contactPhones: ["private-phone"], imageUrls: ["https://private.invalid/image"],
    provenance: { private: ["private-data"] } };
  const fields = { ...node(""), children: { "|rooms": [node(3)], "|rooms-type": [node("separate")], "|sales-agent": [node("private-phone")] } };
  const pin: SnapshotGoodFactPin = { uid: createUlid(), sourceId: "source", externalOfferId: draft.externalId,
    normalizedHash: normalizedContentHash({ draft: { ...draft, provenance: undefined }, fields }),
    factRevisionId: "historical-good", factRevisionSequence: 1, factProfileKey: "captured", factProfileVersion: "1" };
  const profiles = new Map([["captured@1", { identity: "captured@1", caseSensitiveTags: true,
    fieldMappings: [{ sourcePath: "rooms-type", targetField: "facts.roomsType" },
      { sourcePath: "location/apartment", targetField: "address.apartmentNumberPrivate" }] }]]);
  const row = { index: 0, found: true, oversized: false, draft, fields };
  const query = vi.fn().mockResolvedValue([row]);
  const tx = { $queryRaw: query } as unknown as DatabaseTransaction;
  return { draft, fields, pin, profiles, row, query, resolve: createSnapshotGoodFactResolver(tx) };
}
describe("exact GOOD normalized fact resolver", () => {
  it("allowlists normalized candidates and fields, preserving no raw/producer/private identifiers", async () => {
    const data = fixture(); const before = structuredClone(data.row);
    const facts = await data.resolve(scope, [data.pin], data.profiles);
    expect(facts).toEqual([{ inventoryUid: data.pin.uid, draft: { sourceFormat: "YRL_2010", propertyType: "APARTMENT",
      transactionType: "SALE", title: "Synthetic public title" }, fieldValues: { rooms: [3], "rooms-type": ["separate"] } }]);
    expect(JSON.stringify(facts)).not.toMatch(/private|externalId|contactPhones|imageUrls|provenance/u);
    expect(data.row).toEqual(before);
  });
  it("rejects missing, mismatched, duplicate and unpinned-profile facts", async () => {
    const data = fixture();
    data.query.mockResolvedValueOnce([]);
    await expect(data.resolve(scope, [data.pin], data.profiles)).rejects.toThrow("SNAPSHOT_GOOD_FACT_MISSING");
    await expect(data.resolve(scope, [{ ...data.pin, normalizedHash: "a".repeat(64) }], data.profiles)).rejects.toThrow("SNAPSHOT_GOOD_FACT_HASH_MISMATCH");
    await expect(data.resolve(scope, [data.pin, data.pin], data.profiles)).rejects.toThrow("SNAPSHOT_GOOD_FACT_DUPLICATE");
    await expect(data.resolve(scope, [data.pin], new Map())).rejects.toThrow("SNAPSHOT_GOOD_PROFILE_INVALID");
    data.profiles.get("captured@1")!.fieldMappings.push({ sourcePath: "sales-agent", targetField: "facts.roomsType" });
    await expect(data.resolve(scope, [data.pin], data.profiles)).rejects.toThrow("SNAPSHOT_GOOD_PROFILE_INVALID");
  });
  it("splits SQL-byte-guarded pages and rejects even a single oversized leaf", async () => {
    const data = fixture();
    data.query.mockResolvedValueOnce([{ ...data.row, oversized: true, draft: null, fields: null },
      { ...data.row, index: 1, oversized: true, draft: null, fields: null }]);
    const other = { ...data.pin, uid: createUlid() };
    expect(await data.resolve(scope, [data.pin, other], data.profiles)).toHaveLength(2);
    expect(data.query).toHaveBeenCalledTimes(3);
    data.query.mockResolvedValueOnce([{ ...data.row, oversized: true, draft: null, fields: null }]);
    await expect(data.resolve(scope, [data.pin], data.profiles)).rejects.toThrow("SNAPSHOT_GOOD_FACT_LIMIT_EXCEEDED");
  });
  it("performs no SQL for an empty page and rejects more than 200 pins", async () => {
    const data = fixture();
    expect(await data.resolve(scope, [], data.profiles)).toEqual([]);
    expect(data.query).not.toHaveBeenCalled();
    await expect(data.resolve(scope, Array.from({ length: 201 }, () => data.pin), data.profiles)).rejects.toThrow();
    expect(data.query).not.toHaveBeenCalled();
  });
  it("redacts the address using private captured fields without returning either raw component", async () => {
    const data = fixture();
    const draft = { ...data.draft, address: "Synthetic City, house 9, 42" };
    const fields = { ...data.fields, children: { ...data.fields.children,
      "|location": [{ ...node(""), children: { "|apartment": [node("42")] } }] } };
    data.query.mockResolvedValue([{ ...data.row, draft, fields }]);
    const pin = { ...data.pin, normalizedHash: normalizedContentHash({ draft: { ...draft, provenance: undefined }, fields }) };
    const facts = await data.resolve(scope, [pin], data.profiles);
    expect(facts[0]!.addressPublic).toBe("Synthetic City, house 9");
    expect(facts[0]!.draft).not.toHaveProperty("address");
    expect(facts[0]!.fieldValues).not.toHaveProperty("location/apartment");
    const ambiguous = { ...draft, address: "Synthetic City Test Street 9 42" };
    data.query.mockResolvedValue([{ ...data.row, draft: ambiguous, fields }]);
    await expect(data.resolve(scope, [{ ...pin, normalizedHash: normalizedContentHash({ draft: { ...ambiguous, provenance: undefined }, fields }) }], data.profiles))
      .rejects.toThrow("SNAPSHOT_PUBLIC_ADDRESS_INVALID");
  });
});
