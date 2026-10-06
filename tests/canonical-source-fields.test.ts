import { describe, expect, it } from "vitest";
import { canonicalSourceFields } from "../src/modules/ingestion-core/domain/canonical-source-fields.ts";
import { normalizedContentHash } from "../src/modules/ingestion-core/application/import-pipeline.ts";
import { parseYrl2010 } from "../src/modules/ingestion-core/domain/yrl-2010-parser.ts";

const namespace = "http://webmaster.yandex.ru/schemas/feed/realty/2010-06";
async function hash(offer: string) {
  for await (const record of parseYrl2010([`<realty-feed xmlns="${namespace}">${offer}</realty-feed>`], { expectedNamespace: namespace })) {
    return normalizedContentHash(canonicalSourceFields(record.element));
  }
  throw new Error("SYNTHETIC_NO_RECORD");
}

describe("per-record canonical field hash", () => {
  it("ignores element/attribute ordering and numeric presentation while preserving non-draft facts", async () => {
    const first = await hash('<offer internal-id="one" marker="test"><floor>2</floor><price><value>1000.00</value></price></offer>');
    expect(await hash('<offer marker="test" internal-id="one"><price><value>1000</value></price><floor> 2 </floor></offer>')).toBe(first);
    expect(await hash('<offer internal-id="one" marker="test"><floor>3</floor><price><value>1000</value></price></offer>')).not.toBe(first);
  });
  it("preserves order of repeated media fields and strips active HTML from semantic description", async () => {
    expect(await hash('<offer internal-id="one"><picture>one</picture><picture>two</picture></offer>'))
      .not.toBe(await hash('<offer internal-id="one"><picture>two</picture><picture>one</picture></offer>'));
    expect(await hash('<offer internal-id="one"><description>&lt;p&gt;Text&lt;/p&gt;&lt;script&gt;bad()&lt;/script&gt;</description></offer>'))
      .toBe(await hash('<offer internal-id="one"><description>&lt;p&gt;Text&lt;/p&gt;</description></offer>'));
  });
});
