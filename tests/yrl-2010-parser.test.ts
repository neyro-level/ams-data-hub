import { describe, expect, it } from "vitest";
import { parseYrl2010, type YrlParserOptions, type YrlRawOffer } from "../src/modules/ingestion-core/index.ts";

const encoder = new TextEncoder();

async function collect(source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>, options?: YrlParserOptions) {
  const offers: YrlRawOffer[] = [];
  for await (const offer of parseYrl2010(source, options)) offers.push(offer);
  return offers;
}

async function* bytesInChunks(value: string, chunkSize: number) {
  const bytes = encoder.encode(value);
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    yield bytes.slice(offset, offset + chunkSize);
  }
}

const validFeed = `<?xml version="1.0" encoding="UTF-8"?>
<realty-feed xmlns="urn:yandex:realty">
  <generation-date>2026-10-04T10:00:00Z</generation-date>
  <offer internal-id="synthetic-1" category="квартира">
    <type>продажа</type>
    <description><![CDATA[Тест 🏠 <без HTML-разбора>]]></description>
    <location><locality-name>Тестовый город</locality-name></location>
  </offer>
</realty-feed>`;

describe("YRL 2010 streaming parser", () => {
  it("parses namespaces, split UTF-8, CDATA, nesting and raw attributes", async () => {
    const offers = await collect(bytesInChunks(validFeed, 7), { expectedNamespace: "urn:yandex:realty" });
    expect(offers).toHaveLength(1);
    expect(offers[0]?.element.attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({ localName: "internal-id", value: "synthetic-1" }),
    ]));
    expect(offers[0]?.element.children.find((field) => field.localName === "description")?.text)
      .toBe("Тест 🏠 <без HTML-разбора>");
    expect(offers[0]?.element.children.find((field) => field.localName === "location")?.children[0]?.text)
      .toBe("Тестовый город");
  });

  it("yields a complete offer before consuming the rest of the document", async () => {
    let reads = 0;
    async function* source() {
      reads += 1;
      yield "<realty-feed><offer internal-id=\"one\"><type>sale</type></offer>";
      reads += 1;
      yield "</realty-feed>";
    }

    const parser = parseYrl2010(source());
    const first = await parser.next();
    expect(first.done).toBe(false);
    if (first.done) throw new Error("Expected the first offer before document completion");
    expect(first.value.element.attributes[0]?.value).toBe("one");
    expect(reads).toBe(1);
    await expect(parser.next()).resolves.toMatchObject({ done: true });
    expect(reads).toBe(2);
  });

  it.each([
    ["DTD", '<!DOCTYPE realty-feed SYSTEM "https://example.test/feed.dtd"><realty-feed/>', "YRL_DTD_FORBIDDEN"],
    ["XXE", '<!DOCTYPE realty-feed [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><realty-feed>&xxe;</realty-feed>', "YRL_DTD_FORBIDDEN"],
    ["truncated", "<realty-feed><offer>", "YRL_XML_MALFORMED"],
    ["malformed", "<realty-feed><offer></realty-feed>", "YRL_XML_MALFORMED"],
  ])("rejects %s input", async (_name, xml, code) => {
    await expect(collect([xml])).rejects.toMatchObject({ code });
  });

  it("rejects namespace mismatch", async () => {
    await expect(collect([validFeed], { expectedNamespace: "urn:another:namespace" }))
      .rejects.toMatchObject({ code: "YRL_NAMESPACE_MISMATCH" });
  });

  it("enforces artifact, offer, depth and field limits", async () => {
    await expect(collect([validFeed], { limits: { maxArtifactBytes: 20 } }))
      .rejects.toMatchObject({ code: "YRL_ARTIFACT_TOO_LARGE" });
    await expect(collect(["<realty-feed><offer/><offer/></realty-feed>"], { limits: { maxOffers: 1 } }))
      .rejects.toMatchObject({ code: "YRL_OFFER_LIMIT_EXCEEDED" });
    await expect(collect(["<realty-feed><offer><a><b/></a></offer></realty-feed>"], { limits: { maxDepth: 3 } }))
      .rejects.toMatchObject({ code: "YRL_DEPTH_LIMIT_EXCEEDED" });
    await expect(collect(["<realty-feed><offer><description>too long</description></offer></realty-feed>"], { limits: { maxFieldCharacters: 4 } }))
      .rejects.toMatchObject({ code: "YRL_FIELD_TOO_LONG" });
  });

  it("rejects invalid UTF-8", async () => {
    await expect(collect([new Uint8Array([0xff, 0xfe])]))
      .rejects.toMatchObject({ code: "YRL_UTF8_INVALID" });
  });
});
