import { describe, expect, it } from "vitest";
import {
  adapterProfileRegistry,
  extractSourceObjectCode,
  matchesConfiguredPattern,
  resolveProfileAlias,
  resolveVladisDealKind,
  resolveVladisTransaction,
  vladisVt24Configuration,
} from "../src/modules/ingestion-core/index.ts";

describe("vladis-vt24-v1 profile", () => {
  it("is registered only for the compatible mixed YRL adapter", () => {
    const result = adapterProfileRegistry.assertCompatible({
      adapterKey: "yrl-realty-2010",
      adapterVersion: "1.0.0",
      profileKey: "vladis-vt24-v1",
      profileVersion: "1.0.0",
      datasetType: "MIXED_REALTY",
      transportType: "HTTPS_XML",
    });
    expect(result.profile.configuration).toBe(vladisVt24Configuration);
    expect(() => adapterProfileRegistry.assertCompatible({
      adapterKey: "yrl-realty-2010",
      adapterVersion: "1.0.0",
      profileKey: "vladis-vt24-v1",
      profileVersion: "1.0.0",
      datasetType: "RESALE",
      transportType: "HTTPS_XML",
    })).toThrow("SOURCE_REGISTRY_PROFILE_INCOMPATIBLE");
  });

  it("maps every verified category alias and leaves unknown values unresolved", () => {
    const aliases = vladisVt24Configuration.categoryAliases;
    expect(resolveProfileAlias(aliases, "  КВАРТИРА ")).toBe("APARTMENT");
    expect(resolveProfileAlias(aliases, "комната")).toBe("ROOM");
    expect(resolveProfileAlias(aliases, "house")).toBe("HOUSE");
    expect(resolveProfileAlias(aliases, "часть   дома")).toBe("HOUSE_PART");
    expect(resolveProfileAlias(aliases, "lot")).toBe("LAND");
    expect(resolveProfileAlias(aliases, "дача")).toBe("COTTAGE");
    expect(resolveProfileAlias(aliases, "таунхаус")).toBe("TOWNHOUSE");
    expect(resolveProfileAlias(aliases, "гараж")).toBe("GARAGE_BOX");
    expect(resolveProfileAlias(aliases, "box")).toBe("GARAGE_BOX");
    expect(resolveProfileAlias(aliases, "неизвестно")).toBeUndefined();
  });

  it("keeps transactionType separate from dealKind", () => {
    expect(resolveVladisTransaction("продажа")).toBe("SALE");
    expect(resolveVladisTransaction("аренда", "сутки")).toBe("RENT_SHORT");
    expect(resolveVladisTransaction("аренда", "месяц")).toBe("RENT_LONG");
    expect(resolveVladisTransaction("аренда")).toBe("UNKNOWN");
    expect(resolveVladisDealKind("primary-sale")).toBe("PRIMARY_SALE");
    expect(resolveVladisDealKind(undefined)).toBe("UNKNOWN");
  });

  it("extracts only the exact source object code prefix deterministically", () => {
    expect(extractSourceObjectCode("Код объекта: ABC-42. Описание")).toEqual({
      sourceObjectCode: "ABC-42",
      descriptionForPublicProjection: "Описание",
    });
    expect(extractSourceObjectCode("Текст Код объекта: ABC-42.")).toEqual({
      descriptionForPublicProjection: "Текст Код объекта: ABC-42.",
    });
  });

  it("keeps unresolved calibration inputs explicit and non-mutating", () => {
    expect(vladisVt24Configuration.suspiciousText).toEqual({
      calibrationStatus: "PENDING_RUNS_2_3",
      patternSources: [],
      severity: "WARNING",
      autoEdit: false,
    });
    expect(vladisVt24Configuration.sharedOfficePhones).toEqual({
      calibrationStatus: "PENDING_OQ_04",
      e164Values: [],
      excludeFromAutomaticIdentity: true,
    });
    expect(matchesConfiguredPattern(vladisVt24Configuration.cadastralPlaceholders.patternSources, "00:00:0000000:0"))
      .toBe(true);
  });

  it("never enables exact location and requires an explicit district override", () => {
    const policy = vladisVt24Configuration.locationPolicy;
    expect(policy.exactEnabled).toBe(false);
    expect(new Set(Object.values(policy.defaultByPropertyType))).toEqual(new Set(["STREET"]));
    expect(policy.districtOverrideAllowedFor).toEqual([
      "HOUSE", "HOUSE_PART", "LAND", "COTTAGE", "TOWNHOUSE", "GARAGE_BOX",
    ]);
  });

  it("contains every verified optional field mapping and canonical unit alias", () => {
    const fields = new Set(vladisVt24Configuration.fieldMappings.map((mapping) => mapping.sourcePath));
    for (const field of [
      "deal-status", "rooms-type", "window-view", "balcony", "bathroom-unit", "renovation",
      "built-year", "ceiling-height", "heating-supply", "room-furniture", "parking-type", "lot-type",
      "video-review", "online-show", "disable-flat-plan-guess", "is-image-order-change-allowed",
      "location/apartment",
    ]) expect(fields).toContain(field);
    expect(vladisVt24Configuration.unitAliases).toEqual([
      { source: "кв. м", canonicalUnit: "M2", multiplier: 1 },
      { source: "сотка", canonicalUnit: "M2", multiplier: 100 },
    ]);
  });
});
