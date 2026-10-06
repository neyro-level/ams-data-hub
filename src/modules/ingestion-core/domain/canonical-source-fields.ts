import type { YrlRawElement } from "./yrl-2010-parser.ts";
import { normalizeDescription } from "./canonical-inventory.ts";

type FieldValue = string | number;
export interface CanonicalSourceFields {
  text: FieldValue;
  attributes: Record<string, string>;
  children: Record<string, CanonicalSourceFields[]>;
}
const numericFields = new Set([
  "price", "square", "totalarea", "rooms", "floor", "floors-total", "built-year", "ceiling-height",
  "latitude", "longitude", "lat", "lng", "value",
]);

/** Bounded per-record canonical field state. Namespace prefixes, unrelated
 * element/attribute ordering and numeric presentation are not semantic changes.
 * Repeated-field order (notably images) and private/source facts are preserved. */
export function canonicalSourceFields(element: YrlRawElement, caseSensitive = true): CanonicalSourceFields {
  const token = (value: string) => caseSensitive ? value : value.toLocaleLowerCase("en-US");
  const text = element.text.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const normalizedName = element.localName.toLocaleLowerCase("en-US");
  const numeric = numericFields.has(normalizedName) && /^[-+]?\d+(?:[.,]\d+)?$/u.test(text)
    ? Number(text.replace(",", ".")) : undefined;
  const attributes: Record<string, string> = {};
  for (const attribute of element.attributes) {
    if (attribute.namespaceUri === "http://www.w3.org/2000/xmlns/" || attribute.name === "xmlns") continue;
    attributes[`${attribute.namespaceUri}|${token(attribute.localName)}`] = attribute.value.normalize("NFKC").trim();
  }
  const children: Record<string, CanonicalSourceFields[]> = {};
  for (const child of element.children) {
    const key = `${child.namespaceUri}|${token(child.localName)}`;
    (children[key] ??= []).push(canonicalSourceFields(child, caseSensitive));
  }
  return { text: normalizedName === "description" ? normalizeDescription(text).descriptionHtmlSafe
    : numeric !== undefined && Number.isFinite(numeric) ? numeric : text, attributes, children };
}
