import { describe, expect, it } from "vitest";
import { assertManualNewbuildingApply, planNewbuildingImport } from "../src/modules/shared-catalog/index.ts";

const payload = {
  source: { sourceId: "fixture-source", externalId: "development-42", observedAt: "2026-10-05T12:00:00.000Z" },
  target: {
    developmentUid: null,
    developerUid: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    cityUid: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
    districtUid: null,
  },
  development: { name: "ЖК Тестовый", addressLine: "ул. Макетная, 1", latitude: 47.2222, longitude: 39.7111 },
  prices: [{ externalId: "lot-1", amount: 8_500_000, currency: "rub", basis: "TOTAL", areaM2: 48.5, roomCount: 2 }],
  media: [{ externalId: "image-1", sourceUrl: "https://media.example.invalid/development-42/1.webp", position: 0, rightsBasis: "LICENSED", attribution: "Fixture partner", license: null }],
};

const emptyState = {
  developmentUid: null, name: null, addressLine: null, latitude: null, longitude: null,
  knownPriceKeys: new Set<string>(), knownMediaUrls: new Set<string>(),
};

describe("new-building import foundation", () => {
  it("builds a deterministic dry-run without side effects", () => {
    const plan = planNewbuildingImport(payload, emptyState);
    expect(plan.mode).toBe("DRY_RUN");
    expect(plan.developmentChanges.map((change) => change.field)).toEqual(["name", "addressLine", "latitude", "longitude"]);
    expect(plan.newPriceKeys).toEqual(["lot-1\u00002026-10-05T12:00:00.000Z\u0000TOTAL"]);
    expect(plan.newMediaUrls).toEqual(["https://media.example.invalid/development-42/1.webp"]);
    expect(plan.requiresExplicitConfirmation).toBe(true);
  });

  it("deduplicates observations already present in runtime state", () => {
    const plan = planNewbuildingImport(payload, {
      ...emptyState,
      knownPriceKeys: new Set(["lot-1\u00002026-10-05T12:00:00.000Z\u0000TOTAL"]),
      knownMediaUrls: new Set(["https://media.example.invalid/development-42/1.webp"]),
    });
    expect(plan.newPriceKeys).toEqual([]);
    expect(plan.newMediaUrls).toEqual([]);
  });

  it("rejects incomplete geography and licensed media without attribution", () => {
    expect(() => planNewbuildingImport({ ...payload, development: { ...payload.development, longitude: null } }, emptyState)).toThrow();
    expect(() => planNewbuildingImport({ ...payload, media: [{ ...payload.media[0], attribution: null }] }, emptyState)).toThrow();
  });

  it("keeps apply behind explicit manual confirmation", () => {
    const plan = planNewbuildingImport(payload, emptyState, "MANUAL_APPLY");
    expect(() => assertManualNewbuildingApply(plan, false)).toThrow("NEWBUILDING_MANUAL_CONFIRMATION_REQUIRED");
    expect(() => assertManualNewbuildingApply({ ...plan, mode: "DRY_RUN" }, true)).toThrow("NEWBUILDING_MANUAL_CONFIRMATION_REQUIRED");
    expect(() => assertManualNewbuildingApply(plan, true)).not.toThrow();
  });
  it("rejects duplicate observations and credential-bearing media URLs", () => {
    expect(() => planNewbuildingImport({ ...payload, prices: [payload.prices[0], payload.prices[0]] }, emptyState)).toThrow();
    expect(() => planNewbuildingImport({ ...payload, media: [payload.media[0], payload.media[0]] }, emptyState)).toThrow();
    expect(() => planNewbuildingImport({ ...payload, media: [{ ...payload.media[0], sourceUrl: "https://user:secret@example.invalid/x.jpg" }] }, emptyState)).toThrow();
    expect(() => planNewbuildingImport({ ...payload, media: [{ ...payload.media[0], sourceUrl: "https://example.invalid/x.jpg?token=secret" }] }, emptyState)).toThrow();
  });
  it("normalizes observation time before identity comparison", () => {
    const plan = planNewbuildingImport({ ...payload, source: { ...payload.source, observedAt: "2026-10-05T15:00:00+03:00" } }, emptyState);
    expect(plan.sourceIdentity.observedAt).toBe(payload.source.observedAt);
  });
  it("rejects precision that PostgreSQL would silently round", () => {
    expect(() => planNewbuildingImport({ ...payload, development: { ...payload.development, latitude: 47.12345678 } }, emptyState)).toThrow();
    expect(() => planNewbuildingImport({ ...payload, prices: [{ ...payload.prices[0], amount: 100.123 }] }, emptyState)).toThrow();
    expect(() => planNewbuildingImport({ ...payload, prices: [{ ...payload.prices[0], areaM2: 48.123 }] }, emptyState)).toThrow();
  });
});
