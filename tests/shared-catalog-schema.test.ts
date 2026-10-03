import {
  catalogCitySchema,
  catalogDistrictSchema,
  catalogRegionSchema,
} from "@ams-data-hub/realty-contracts";
import { describe, expect, it } from "vitest";
import { normalizeGeoName } from "../src/modules/shared-catalog/domain/normalize-geo-name.ts";

const regionUid = "01M41T6Q00Y9AEKKB9XDD94GSG";
const cityUid = "01M41T6Q04BADHXSERJHZFXKCH";

describe("shared catalog geo contracts", () => {
  it("normalizes Russian names deterministically", () => {
    expect(normalizeGeoName("  РОСТОВ-НА-ДОНУ   ")).toBe("ростов-на-дону");
    expect(normalizeGeoName("г.\u00a0Севастополь")).toBe("г. севастополь");
    expect(() => normalizeGeoName("   ")).toThrow("cannot be empty");
  });

  it("accepts strict region, city and district transfer contracts", () => {
    expect(catalogRegionSchema.parse({
      uid: regionUid,
      code: "RU-KDA",
      name: "Краснодарский край",
      normalizedName: "краснодарский край",
      lifecycle: "ACTIVE",
      aliases: [{ value: "Кубань", normalizedValue: "кубань" }],
    }).code).toBe("RU-KDA");
    expect(catalogCitySchema.parse({
      uid: cityUid,
      regionUid,
      name: "Краснодар",
      normalizedName: "краснодар",
      lifecycle: "ACTIVE",
      aliases: [],
    }).regionUid).toBe(regionUid);
    expect(catalogDistrictSchema.parse({
      uid: "01M41T6Q06MZSPS0T4TQKDA8QC",
      cityUid,
      name: "Центральный",
      normalizedName: "центральный",
      lifecycle: "ACTIVE",
      aliases: [],
    }).cityUid).toBe(cityUid);
  });

  it("rejects extra fields and malformed identifiers", () => {
    expect(() => catalogRegionSchema.parse({
      uid: "bad",
      code: "KDA",
      name: "Краснодарский край",
      normalizedName: "краснодарский край",
      lifecycle: "ACTIVE",
      aliases: [],
      rawSource: "forbidden",
    })).toThrow();
  });
});
