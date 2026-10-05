import { describe, expect, it } from "vitest";
import {
  adapterProfileRegistry,
  canonicalSourceObjectKey,
  findDuplicateExternalIds,
  normalizeMarketplaceRecord,
  parseAvitoV3Feed,
  parseCianV2Feed,
  parseDomclickYrlFeed,
  parseJoyworkYandexFeed,
  type MarketplaceFeedFormat,
  type MarketplaceXmlRecord,
  type YrlRawOffer,
} from "../src/modules/ingestion-core/index.ts";

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of source) result.push(item);
  return result;
}

const namespace = "http://webmaster.yandex.ru/schemas/feed/realty/2010-06";
const yrl = `<?xml version="1.0" encoding="UTF-8"?><realty-feed xmlns="${namespace}"><offer internal-id="same-1"><type>продажа</type><category>квартира</category><description>Синтетическое объявление</description><location><address>Тестовый город, улица Макетная, 1</address><latitude>47.2</latitude><longitude>39.7</longitude></location><price><value>1000000</value><currency>RUR</currency></price><area><value>42.5</value><unit>кв. м</unit></area><sales-agent><phone>+7 900 000-00-01</phone></sales-agent><picture>https://media.example.invalid/yrl-1.jpg</picture></offer></realty-feed>`;
const avito = `<?xml version="1.0" encoding="UTF-8"?><Ads formatVersion="3" target="Avito.ru"><Ad><Id>same-1</Id><Category>Квартиры</Category><OperationType>Продам</OperationType><Title>Тестовая квартира</Title><Description>Синтетическое объявление</Description><Address>Тестовый город, улица Макетная, 1</Address><Price>1000000</Price><Square>42.5</Square><ContactPhone>+7 900 000-00-01</ContactPhone><Images><Image url="https://media.example.invalid/avito-1.jpg"/></Images></Ad></Ads>`;
const cian = `<?xml version="1.0" encoding="UTF-8"?><feed><feed_version>2</feed_version><object><Category>flatSale</Category><ExternalId>same-1</ExternalId><Title>Тестовая квартира</Title><Description>Синтетическое объявление</Description><Address>Тестовый город, улица Макетная, 1</Address><Coordinates><Lat>47.2</Lat><Lng>39.7</Lng></Coordinates><Phones><PhoneSchema><CountryCode>+7</CountryCode><Number>9000000001</Number></PhoneSchema></Phones><TotalArea>42.5</TotalArea><Photos><PhotoSchema><FullUrl>https://media.example.invalid/cian-1.jpg</FullUrl></PhotoSchema></Photos><BargainTerms><Price>1000000</Price><Currency>rur</Currency></BargainTerms></object></feed>`;

describe("marketplace XML format adapters", () => {
  it("accepts the four registered Joywork profiles with explicit format contracts", () => {
    for (const selection of [
      ["yrl-realty-2010", "joywork-yandex-realty-v1"],
      ["yrl-realty-2010", "joywork-domclick-v1"],
      ["avito-xml-v3", "joywork-avito-v3"],
      ["cian-xml-v2", "joywork-cian-v2"],
    ] as const) {
      const resolved = adapterProfileRegistry.assertCompatible({ adapterKey: selection[0], adapterVersion: "1.0.0", profileKey: selection[1], profileVersion: "1.0.0", datasetType: "MIXED_REALTY", transportType: "HTTPS_XML" });
      expect(resolved.profile.formatContract?.preserveRawProvenance).toBe(true);
    }
  });

  it("parses Yandex Realty and Domclick as separately identified profiles of the YRL family", async () => {
    const yandex = await collect(parseJoyworkYandexFeed([yrl]));
    const domclick = await collect(parseDomclickYrlFeed([yrl]));
    expect(yandex).toHaveLength(1);
    expect(domclick).toHaveLength(1);
    expect(normalizeMarketplaceRecord(yandex[0]!, "YRL_2010").draft?.externalId).toBe("same-1");
    expect(normalizeMarketplaceRecord(domclick[0]!, "DOMCLICK_YRL").draft?.sourceFormat).toBe("DOMCLICK_YRL");
  });

  it("parses strict Avito v3 and case-insensitive CIAN v2 signatures", async () => {
    expect(await collect(parseAvitoV3Feed([avito]))).toHaveLength(1);
    expect(await collect(parseCianV2Feed([cian]))).toHaveLength(1);
    await expect(collect(parseAvitoV3Feed(["<Ads formatVersion=\"2\" target=\"Avito.ru\"></Ads>"]))).rejects.toMatchObject({ code: "MARKETPLACE_XML_SIGNATURE_INVALID" });
    await expect(collect(parseCianV2Feed(["<feed><feed_version>1</feed_version></feed>"]))).rejects.toMatchObject({ code: "MARKETPLACE_XML_SIGNATURE_INVALID" });
  });

  it("auto-detects the Windows-1251 encoding allowed by CIAN v2", async () => {
    const before = new TextEncoder().encode('<?xml version="1.0" encoding="windows-1251"?><Feed><Feed_Version>2</Feed_Version><Object><Category>flatSale</Category><ExternalId>cp-1</ExternalId><Description>');
    const cyrillic = new Uint8Array([0xd2, 0xe5, 0xf1, 0xf2]);
    const after = new TextEncoder().encode('</Description></Object></Feed>');
    const bytes = new Uint8Array(before.length + cyrillic.length + after.length);
    bytes.set(before); bytes.set(cyrillic, before.length); bytes.set(after, before.length + cyrillic.length);
    const record = (await collect(parseCianV2Feed([bytes])))[0]!;
    expect(normalizeMarketplaceRecord(record, "CIAN_V2").draft?.description).toBe("Тест");
  });

  it("accepts empty live-shape feeds without authorizing destructive reconciliation", async () => {
    expect(await collect(parseAvitoV3Feed(["<Ads formatVersion=\"3\" target=\"Avito.ru\"></Ads>"]))).toEqual([]);
    expect(await collect(parseCianV2Feed(["<feed><feed_version>2</feed_version></feed>"]))).toEqual([]);
    expect(await collect(parseDomclickYrlFeed([`<realty-feed xmlns="${namespace}"><generation-date>2026-10-05T12:00:00+03:00</generation-date></realty-feed>`]))).toEqual([]);
  });

  it("normalizes all formats to the same field vocabulary and preserves format provenance", async () => {
    const records: [MarketplaceXmlRecord | YrlRawOffer, MarketplaceFeedFormat][] = [
      [(await collect(parseJoyworkYandexFeed([yrl])))[0]!, "YRL_2010"],
      [(await collect(parseDomclickYrlFeed([yrl])))[0]!, "DOMCLICK_YRL"],
      [(await collect(parseAvitoV3Feed([avito])))[0]!, "AVITO_V3"],
      [(await collect(parseCianV2Feed([cian])))[0]!, "CIAN_V2"],
    ];
    const results = records.map(([record, format]) => normalizeMarketplaceRecord(record, format));
    expect(results.every((result) => result.issues.length === 0)).toBe(true);
    expect(results.map((result) => result.draft)).toEqual(expect.arrayContaining([
      expect.objectContaining({ externalId: "same-1", propertyType: "APARTMENT", transactionType: "SALE", price: 1000000, areaM2: 42.5 }),
    ]));
    expect(new Set(results.map((result) => result.draft?.sourceFormat))).toEqual(new Set(["YRL_2010", "DOMCLICK_YRL", "AVITO_V3", "CIAN_V2"]));
    expect(results[3]?.draft?.contactPhones).toEqual(["+79000000001"]);
  });

  it("reports unknown semantics and invalid numbers instead of inventing canonical values", async () => {
    const xml = avito.replace("Квартиры", "Неизвестная категория").replace("Продам", "Неизвестная операция").replace("1000000", "не число");
    const record = (await collect(parseAvitoV3Feed([xml])))[0]!;
    const result = normalizeMarketplaceRecord(record, "AVITO_V3");
    expect(result.draft).toMatchObject({ propertyType: "OTHER", transactionType: "UNKNOWN" });
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["UNKNOWN_PROPERTY_TYPE", "UNKNOWN_TRANSACTION_TYPE", "INVALID_NUMBER"]));
  });

  it("detects duplicates inside one source while keeping equal IDs isolated between sources", async () => {
    const record = (await collect(parseAvitoV3Feed([avito])))[0]!;
    const draft = normalizeMarketplaceRecord(record, "AVITO_V3").draft!;
    expect(findDuplicateExternalIds([draft, draft])).toEqual(["same-1"]);
    expect(canonicalSourceObjectKey("source-a", draft.externalId)).not.toBe(canonicalSourceObjectKey("source-b", draft.externalId));
  });

  it.each([
    ["DTD", '<!DOCTYPE Ads [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Ads formatVersion="3" target="Avito.ru">&xxe;</Ads>', "MARKETPLACE_XML_DTD_FORBIDDEN"],
    ["truncated", '<Ads formatVersion="3" target="Avito.ru"><Ad>', "MARKETPLACE_XML_MALFORMED"],
  ])("rejects %s payloads", async (_name, xml, code) => {
    await expect(collect(parseAvitoV3Feed([xml]))).rejects.toMatchObject({ code });
  });
});
