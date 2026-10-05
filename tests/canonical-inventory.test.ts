import { serializePublicDto } from "@ams-data-hub/data-contracts";
import {
  inventoryEntitySchema,
  type InventoryEntity,
} from "@ams-data-hub/realty-contracts";
import { describe, expect, it } from "vitest";
import {
  normalizeArea,
  normalizeCadastralNumber,
  normalizeDescription,
  normalizeHeight,
  normalizePhone,
  normalizeTimestamp,
  sparseValue,
  toPublicInventoryDto,
} from "../src/modules/ingestion-core/domain/canonical-inventory.ts";

const absent = { state: "ABSENT" } as const;
const apartmentFacts = {
  rooms: absent, roomsType: absent, totalAreaM2: absent, livingAreaM2: absent,
  kitchenAreaM2: absent, floor: absent, floorsTotal: absent, ceilingHeightM: absent,
  buildingType: absent, buildingYear: absent, renovation: absent, bathroomType: absent,
  windowView: absent, balconyText: absent, balconies: absent, loggias: absent,
  heatingSupply: absent, roomFurniture: absent, parkingType: absent, isGroundFloor: absent,
  disableFlatPlanGuess: absent, videoReviewAvailable: absent, onlineShowAvailable: absent,
};

function inventoryEntity(): InventoryEntity {
  return inventoryEntitySchema.parse({
    id: "internal-row-id",
    uid: "01J9ZK8G7Q5X6NP3V4A2B1C0DE",
    publicUrlId: "01j9zk8g7q5x6np3",
    organizationId: "org-internal",
    projectId: "project-internal",
    sourceId: "source-internal",
    externalId: "offer-42",
    propertyType: "APARTMENT",
    facts: apartmentFacts,
    transactionType: "SALE",
    dealKind: "RESALE",
    status: "ACTIVE",
    firstSeenAt: "2026-10-04T08:00:00.000Z",
    lastSeenAt: "2026-10-04T09:00:00.000Z",
    title: "Квартира",
    descriptionHtmlSafe: "<p>Описание</p>",
    descriptionText: "Описание",
    sourceObjectCode: "PRIVATE-CODE",
    price: 5_000_000,
    currency: "RUB",
    address: {
      addressPublic: "Ростов-на-Дону, ул. Примерная, 10",
      apartmentNumberPrivate: "42",
      sourceAddressRaw: "Ростов-на-Дону, ул. Примерная, 10, кв. 42",
    },
    geo: { latitude: absent, longitude: absent },
    locationPrecision: "STREET",
    media: [],
    sourceHash: "a".repeat(64),
    normalizedHash: "b".repeat(64),
    createdAt: "2026-10-04T08:00:00.000Z",
    updatedAt: "2026-10-04T09:00:00.000Z",
  });
}

describe("canonical inventory", () => {
  it("keeps every sparse state distinct", () => {
    const number = (value: unknown) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error("NOT_A_NUMBER");
      return parsed;
    };
    expect(sparseValue(undefined, number)).toEqual({ state: "ABSENT" });
    expect(sparseValue(false, number)).toEqual({ state: "EXPLICIT_FALSE" });
    expect(sparseValue("0", number)).toEqual({ state: "EXPLICIT_ZERO" });
    expect(sparseValue("12.5", number)).toEqual({ state: "VALUE", value: 12.5 });
    expect(sparseValue("unknown", number)).toMatchObject({ state: "INVALID", raw: "unknown" });
  });

  it("normalizes units and timestamps while preserving provenance", () => {
    expect(normalizeArea("6,5", "сотка")).toEqual({
      value: 650, unit: "M2", provenance: { rawValue: "6,5", rawUnit: "сотка" },
    });
    expect(normalizeHeight(275, "см").value).toBe(2.75);
    expect(normalizeTimestamp("2026-10-04T12:30:00+03:00")).toEqual({
      valueUtc: "2026-10-04T09:30:00.000Z",
      rawTimestamp: "2026-10-04T12:30:00+03:00",
      rawOffset: "+03:00",
    });
    expect(() => normalizeTimestamp("2026-10-04T12:30:00")).toThrow("TIMESTAMP_OFFSET_REQUIRED");
  });

  it("sanitizes feed HTML with the canonical allowlist", () => {
    expect(normalizeDescription('<p onclick="bad()">Текст <strong>важный</strong><a href="https://bad">link</a><script>alert(1)</script></p>')).toEqual({
      descriptionHtmlSafe: "<p>Текст <strong>важный</strong>link</p>",
      descriptionText: "Текст важныйlink",
    });
  });

  it("normalizes valid phones to E.164 and preserves rejected raw input", () => {
    expect(normalizePhone("+7 959 123-45-67")).toEqual({ rawPhone: "+7 959 123-45-67", phoneNorm: "+79591234567" });
    expect(normalizePhone("не телефон")).toEqual({ rawPhone: "не телефон", warning: "PHONE_NORMALIZATION_FAILED" });
  });

  it("classifies cadastral values without silently correcting them", () => {
    expect(normalizeCadastralNumber(undefined)).toEqual({ cadastralValidationStatus: "ABSENT" });
    expect(normalizeCadastralNumber("61:44:0010203:42").cadastralValidationStatus).toBe("VALID_FORMAT");
    expect(normalizeCadastralNumber("00:00:0000000:0", [/^00:00:/u]).cadastralValidationStatus).toBe("PLACEHOLDER_SUSPECTED");
    expect(normalizeCadastralNumber("invalid").cadastralValidationStatus).toBe("INVALID_FORMAT");
  });

  it("never exposes private address or provenance fields in the public DTO", () => {
    const serialized = serializePublicDto(toPublicInventoryDto(inventoryEntity()));
    expect(serialized).toContain('"addressPublic"');
    for (const forbidden of ["apartmentNumberPrivate", "sourceAddressRaw", "sourceObjectCode", "externalId", "projectId"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("rejects a propertyType and facts mismatch", () => {
    const entity = inventoryEntity();
    expect(() => inventoryEntitySchema.parse({
      ...entity,
      propertyType: "LAND",
      facts: apartmentFacts,
    })).toThrow();
  });
});
