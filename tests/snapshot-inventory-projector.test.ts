import { describe, expect, it } from "vitest";
import { vladisVt24Configuration, joyworkAvitoProfile, joyworkCianProfile, joyworkYandexRealtyProfile } from "../src/modules/ingestion-core/index.ts";
import { projectSnapshotInventory, type SnapshotInventoryProjectionInput } from "../src/modules/snapshot-delivery/application/snapshot-inventory-projector.ts";
import { composeSnapshot, SNAPSHOT_DATASET_KINDS } from "../src/modules/snapshot-delivery/index.ts";

const uid = "01J9ZK8G7Q5X6NP3V4A2B1C0DE";
const scope = { organizationId: "synthetic-org", projectId: "synthetic-project" };
function input(): SnapshotInventoryProjectionInput {
  return { fact: { inventoryUid: uid, sourceId: "synthetic-source", externalOfferId: "x".repeat(240), normalizedHash: "b".repeat(64),
    factProfileIdentity: "vladis-vt24-v1@1.0.0", draft: { sourceFormat: "YRL_2010", propertyType: "APARTMENT", transactionType: "SALE",
    areaM2: 0, latitude: 55.751234, longitude: 37.612345, description: "<p>Код объекта: PRIVATE-CODE. Текст <strong>важный</strong></p>" },
    addressPublic: "Synthetic City, house 9", fieldValues: { rooms: ["0"], floor: ["bad-private"],
      "living-space/value": ["6,5"], "living-space/unit": ["сотка"], "video-review": ["false"], "built-year": ["2000"] } },
    profile: { identity: "vladis-vt24-v1@1.0.0", configuration: vladisVt24Configuration, formatContract: null },
    identity: { uid, sourceId: "synthetic-source", externalOfferId: "x".repeat(240), sourceHash: "a".repeat(64), normalizedHash: "b".repeat(64),
      factProfileIdentity: "vladis-vt24-v1@1.0.0", status: "ACTIVE", firstSeenAt: "2026-10-07T00:00:00.000Z", lastSeenAt: "2026-10-07T00:00:00.000Z",
      sourceCreatedAt: null, sourceUpdatedAt: null, createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z" },
    url: { entityType: "INVENTORY", entityUid: uid, publicUrlId: "01j9zk8g7q5x6np3" }, media: [] };
}
function project(row = input()) { return projectSnapshotInventory(scope, [row]); }
function publicValue(row = input()) { return project(row).records[0]!.value as Record<string, unknown>; }
describe("captured GOOD inventory projector", () => {
  it("builds real variant sparse facts, redacts invalid raw and internal code, keeps safe HTML and coarsens geo", () => {
    const row = input(); const projected = publicValue(row);
    expect(projected.facts).toMatchObject({ rooms: { state: "EXPLICIT_ZERO" }, totalAreaM2: { state: "EXPLICIT_ZERO" },
      floor: { state: "INVALID", reason: "INVALID_SOURCE_VALUE" }, livingAreaM2: { state: "VALUE", value: 650 },
      videoReviewAvailable: { state: "EXPLICIT_FALSE" }, buildingYear: { state: "VALUE", value: 2000 }, parkingType: { state: "ABSENT" } });
    expect(projected.descriptionHtmlSafe).toBe("<p>Текст <strong>важный</strong></p>");
    expect(projected.geo).not.toEqual({ latitude: { state: "VALUE", value: row.fact.draft.latitude }, longitude: { state: "VALUE", value: row.fact.draft.longitude } });
    expect(JSON.stringify(projected)).not.toMatch(/PRIVATE-CODE|bad-private|externalId|sourceHash|normalizedHash|sourceId/u);
    expect(project().records[0]!.references).toEqual([{ kind: "urls", key: "entry:01j9zk8g7q5x6np3" }]);
    expect(project(row)).toEqual(project(row));
  });
  it.each(["HOUSE", "LAND", "COMMERCIAL", "GARAGE_BOX", "OTHER"] as const)("creates only the %s variant fields", (propertyType) => {
    const row = input(); row.fact.draft.propertyType = propertyType;
    const facts = publicValue(row).facts as Record<string, unknown>;
    expect(facts).not.toHaveProperty("videoReviewAvailable");
    if (propertyType === "LAND") expect(facts.cadastralValidationStatus).toBe("ABSENT");
  });
  it.each([joyworkYandexRealtyProfile, joyworkAvitoProfile, joyworkCianProfile])("supports format-only $key without a live registry", (descriptor) => {
    const row = input(); row.profile = { identity: `${descriptor.key}@${descriptor.version}`, configuration: null, formatContract: descriptor.formatContract! };
    row.identity.factProfileIdentity = row.profile.identity; row.fact.factProfileIdentity = row.profile.identity;
    row.fact.draft.sourceFormat = descriptor.formatContract!.family;
    expect(publicValue(row).locationPrecision).toBe("STREET");
  });
  it("uses captured unit aliases only and never assumes height units", () => {
    const row = input(); row.fact.fieldValues = { "living-space/value": ["6"], "living-space/unit": ["ha"], "ceiling-height": ["275"] };
    expect(publicValue(row).facts).toMatchObject({ livingAreaM2: { state: "INVALID", reason: "INVALID_SOURCE_VALUE" },
      ceilingHeightM: { state: "INVALID", reason: "INVALID_SOURCE_VALUE" } });
  });
  it("preserves normalized numeric zero without coercing whitespace into zero", () => {
    const row = input(); row.fact.fieldValues = { rooms: [" 0 "], floor: [" "] };
    expect(publicValue(row).facts).toMatchObject({ rooms: { state: "EXPLICIT_ZERO" }, floor: { state: "INVALID", reason: "INVALID_SOURCE_VALUE" } });
  });
  it("requires explicit rent period and never guesses currency", () => {
    const row = input(); row.fact.draft.transactionType = "RENT_LONG";
    expect(() => project(row)).toThrow("SNAPSHOT_INVENTORY_RENT_PERIOD_UNKNOWN");
    row.fact.fieldValues = { "price/@period": ["год"] };
    expect(publicValue(row)).toMatchObject({ transactionType: "RENT", rentPeriod: "YEAR" });
    expect(publicValue(row)).not.toHaveProperty("currency");
    row.fact.fieldValues = { "price/@period": ["unknown-private"] };
    expect(() => project(row)).toThrow("SNAPSHOT_INVENTORY_RENT_PERIOD_UNKNOWN");
  });
  it("fails on missing address, mismatched pins/family, duplicate UID and incomplete geo", () => {
    const row = input(); delete row.fact.addressPublic; expect(() => project(row)).toThrow("NOT_READY");
    const mismatch = input(); mismatch.url.entityUid = "01J9ZK8G7Q5X6NP3V4A2B1C0DF"; expect(() => project(mismatch)).toThrow("PIN_INVALID");
    const family = input(); family.fact.draft.sourceFormat = "AVITO_V3"; expect(() => project(family)).toThrow("PROFILE_INVALID");
    expect(() => projectSnapshotInventory(scope, [input(), input()])).toThrow("PIN_INVALID");
    const geo = input(); delete geo.fact.draft.longitude; expect(() => project(geo)).toThrow("COORDINATES_INCOMPLETE");
  });
  it("removes a private-code prefix split across markup while preserving the remaining rich HTML", () => {
    const row = input(); row.fact.draft.description = "<p><strong>Код объекта:</strong> PRIVATE-CODE. Текст</p>";
    expect(publicValue(row).descriptionHtmlSafe).toBe("<p><strong></strong>Текст</p>");
    row.fact.draft.description = "<p><strong>Код&nbsp;объекта:</strong> PRIVATE. Текст <em>важный</em></p>";
    expect(publicValue(row).descriptionHtmlSafe).toBe("<p><strong></strong>Текст <em>важный</em></p>");
    for (const html of ["<p>Код<br>объекта: PRIVATE. Текст</p>", "<p>Код</p><p>объекта: PRIVATE. Текст</p>"]) {
      row.fact.draft.description = html;
      expect(JSON.stringify(publicValue(row))).not.toContain("PRIVATE");
      expect(publicValue(row).descriptionText).toBe("Текст");
    }
    row.fact.draft.description = "<p>Код объекта: PRIVATE-CODE без точки</p>";
    expect(() => project(row)).toThrow("DESCRIPTION_NOT_READY");
  });
  it("publishes only explicit opaque mirrored media and never producer URLs", () => {
    const row = input(); row.media = [{ ref: "c".repeat(64), kind: "IMAGE", position: 0 }];
    expect(publicValue(row).media).toEqual(row.media);
    expect(project(row).records[0]!.references).toContainEqual({ kind: "media", key: `INVENTORY/${uid}/0` });
    expect(() => composeSnapshot({ schemaMinor: 0, projectId: scope.projectId, publishSequence: 1,
      generatedAt: "2026-10-07T00:00:00.000Z", publishedAt: "2026-10-07T00:00:01.000Z", catalogRevision: "synthetic",
      sourceRevisions: ["synthetic-good"], keyId: "synthetic-key", requiresProjectContact: false,
      datasets: SNAPSHOT_DATASET_KINDS.map((kind) => kind === "inventory" ? project(row) : { kind,
        records: kind === "urls" ? [{ key: `entry:${row.url.publicUrlId}`, value: {} }] : [] }),
    })).toThrow("SNAPSHOT_REFERENCE_BROKEN");
  });
  it("rejects mixing a different verified source, external identity, hash or profile", () => {
    for (const key of ["sourceId", "externalOfferId", "normalizedHash", "factProfileIdentity"] as const) {
      const row = input(); row.fact[key] = "different"; expect(() => project(row)).toThrow("PIN_INVALID");
    }
  });
  it("preserves captured deal-kind and explicit false image-order permissions", () => {
    const row = input(); row.fact.fieldValues = { "deal-status": ["assignment"], "is-image-order-change-allowed": ["false"] };
    expect(publicValue(row)).toMatchObject({ dealKind: "ASSIGNMENT", isImageOrderChangeAllowed: false });
  });
});
