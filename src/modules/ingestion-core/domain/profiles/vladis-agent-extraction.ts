import type { YrlRawElement, YrlRawOffer } from "../yrl-2010-parser.ts";

export interface ExtractedAgentEvidence {
  fullNameRaw: string;
  phoneRaw?: string;
  photoSourceUrl?: string;
  categoryRaw?: string;
  offerExternalId: string;
}

function child(element: YrlRawElement, localName: string): YrlRawElement | undefined {
  return element.children.find((candidate) => candidate.localName === localName);
}

function text(element: YrlRawElement | undefined): string | undefined {
  const value = element?.text.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return value || undefined;
}

export function extractVladisAgentEvidence(offer: YrlRawOffer): ExtractedAgentEvidence | null {
  const agent = child(offer.element, "sales-agent");
  const fullNameRaw = text(child(agent ?? offer.element, "name"));
  if (!agent || !fullNameRaw) return null;
  const offerExternalId = offer.element.attributes.find(
    (attribute) => attribute.localName === "internal-id",
  )?.value.trim();
  if (!offerExternalId) throw new Error("YRL_REQUIRED_FIELD_MISSING");
  return {
    fullNameRaw,
    phoneRaw: text(child(agent, "phone")),
    photoSourceUrl: text(child(agent, "photo")),
    categoryRaw: text(child(agent, "category")),
    offerExternalId,
  };
}
