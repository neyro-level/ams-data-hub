import { describe, expect, it } from "vitest";
import { resolveExecutableSourceAdapter } from "../src/modules/ingestion-core/domain/executable-adapter-registry.ts";
import { MAX_SOURCE_INTAKE_LIMITS } from "../src/modules/ingestion-core/domain/source-intake-policy.ts";

const namespace = "http://webmaster.yandex.ru/schemas/feed/realty/2010-06";
const yrl = `<realty-feed xmlns="${namespace}"><offer internal-id="one"><category>квартира</category><type>продажа</type></offer></realty-feed>`;
const avito = '<Ads formatVersion="3" target="Avito.ru"><Ad><Id>one</Id><Category>Квартиры</Category><OperationType>Продам</OperationType></Ad></Ads>';
const cian = '<Feed><Feed_Version>2</Feed_Version><Object><ExternalId>one</ExternalId><Category>flatSale</Category></Object></Feed>';
const selection = (adapterKey: string, profileKey: string) => ({ adapterKey, adapterVersion: "1.0.0", profileKey, profileVersion: "1.0.0", datasetType: "MIXED_REALTY" as const, transportType: "HTTPS_XML" as const });

describe("configuration-only executable source registry", () => {
  it.each([
    ["yrl-realty-2010", "vladis-vt24-v1", yrl, "YRL_2010"],
    ["yrl-realty-2010", "joywork-yandex-realty-v1", yrl, "YRL_2010"],
    ["yrl-realty-2010", "joywork-domclick-v1", yrl, "DOMCLICK_YRL"],
    ["avito-xml-v3", "joywork-avito-v3", avito, "AVITO_V3"],
    ["cian-xml-v2", "joywork-cian-v2", cian, "CIAN_V2"],
  ])("executes %s / %s through the real bounded parser", async (adapter, profile, xml, format) => {
    const runtime = resolveExecutableSourceAdapter(selection(adapter, profile));
    let count = 0;
    for await (const record of runtime.parse([new TextEncoder().encode(xml)], { limits: MAX_SOURCE_INTAKE_LIMITS })) {
      expect(runtime.normalize(record).draft).toMatchObject({ externalId: "one", propertyType: "APARTMENT", transactionType: "SALE", sourceFormat: format });
      count += 1;
    }
    expect(count).toBe(1);
  });

  it("rejects unknown versions and incompatible profile selection before reading input", () => {
    expect(() => resolveExecutableSourceAdapter({ ...selection("yrl-realty-2010", "default-v1"), adapterVersion: "2.0.0" })).toThrow("SOURCE_REGISTRY_ADAPTER_UNKNOWN");
    expect(() => resolveExecutableSourceAdapter(selection("avito-xml-v3", "vladis-vt24-v1"))).toThrow("SOURCE_REGISTRY_PROFILE_INCOMPATIBLE");
    expect(() => resolveExecutableSourceAdapter({ ...selection("yrl-realty-2010", "default-v1"), profileVersion: "unknown" })).toThrow("SOURCE_REGISTRY_PROFILE_UNKNOWN");
  });

  it("applies producer aliases without changing generic YRL parser behavior", async () => {
    const xml = yrl.replace("квартира", "дача");
    const generic = resolveExecutableSourceAdapter(selection("yrl-realty-2010", "default-v1"));
    const configured = resolveExecutableSourceAdapter(selection("yrl-realty-2010", "vladis-vt24-v1"));
    for await (const record of generic.parse([xml], { limits: MAX_SOURCE_INTAKE_LIMITS })) {
      expect(generic.normalize(record).draft?.propertyType).toBe("OTHER");
      expect(configured.normalize(record).draft?.propertyType).toBe("COTTAGE");
      expect(configured.normalize(record).issues).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: "UNKNOWN_PROPERTY_TYPE" })]));
    }
  });
});
