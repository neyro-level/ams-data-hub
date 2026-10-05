import { describe, expect, it } from "vitest";
import { extractVladisAgentEvidence, parseYrl2010 } from "../src/modules/ingestion-core/index.ts";
import {
  ambiguousPhoneNames,
  normalizeAgentEvidence,
  normalizeAgentFullName,
} from "../src/modules/project-state/index.ts";

const NAMESPACE = "http://webmaster.yandex.ru/schemas/feed/realty/2010-06";

describe("agent extraction and matching primitives", () => {
  it("extracts bounded sales-agent evidence from YRL", async () => {
    const xml = `<?xml version="1.0"?><realty-feed xmlns="${NAMESPACE}"><offer internal-id="offer-1"><sales-agent><name> Агент   Тестовый </name><phone>+7 959 000-00-01</phone><category>agency</category><photo>https://media.example.invalid/a.jpg</photo></sales-agent></offer></realty-feed>`;
    const offers = [];
    for await (const offer of parseYrl2010([xml], { expectedNamespace: NAMESPACE })) offers.push(offer);
    expect(extractVladisAgentEvidence(offers[0]!)).toEqual({
      fullNameRaw: "Агент Тестовый",
      phoneRaw: "+7 959 000-00-01",
      photoSourceUrl: "https://media.example.invalid/a.jpg",
      categoryRaw: "agency",
      offerExternalId: "offer-1",
    });
  });

  it("normalizes identity and detects one-phone/two-name ambiguity", () => {
    const first = normalizeAgentEvidence({ sourceId: "source", fullNameRaw: "Анна Агент", phoneRaw: "+7 959 000-00-01", offerExternalIds: ["one"] });
    const repeated = normalizeAgentEvidence({ sourceId: "source", fullNameRaw: "  АННА  Агент ", phoneRaw: "+79590000001", offerExternalIds: ["two"] });
    const collision = normalizeAgentEvidence({ sourceId: "source", fullNameRaw: "Борис Агент", phoneRaw: "+79590000001", offerExternalIds: ["three"] });
    expect(first.evidenceKey).toBe(repeated.evidenceKey);
    expect(normalizeAgentFullName("  АННА  Агент ")).toBe("анна агент");
    expect(ambiguousPhoneNames([first, repeated])).toEqual(new Set());
    expect(ambiguousPhoneNames([first, collision])).toEqual(new Set(["+79590000001"]));
  });
});
