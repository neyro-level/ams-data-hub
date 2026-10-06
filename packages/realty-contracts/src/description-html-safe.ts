import { z } from "zod";

export const DESCRIPTION_HTML_SAFE_TAGS = Object.freeze(["p", "br", "ul", "ol", "li", "strong", "em"] as const);
const pairedTags = new Set<string>(DESCRIPTION_HTML_SAFE_TAGS.filter((tag) => tag !== "br"));

/** Validate the sanitizer's portable output grammar. This never repairs input,
 * decodes entities or acts as a second sanitizer. Raw markup must be sanitized
 * by ingestion before it can acquire this contract type. */
export function isDescriptionHtmlSafe(value: string): boolean {
  if (value.length > 100_000) return false;
  const stack: string[] = [];
  let position = 0;
  while (position < value.length) {
    const start = value.indexOf("<", position);
    if (start === -1) break;
    const end = value.indexOf(">", start + 1);
    if (end === -1) return false;
    const token = value.slice(start, end + 1);
    if (token !== "<br />" && token !== "<br>" && token !== "<br/>") {
      const match = /^<(\/?)([a-z]+)>$/u.exec(token);
      if (!match || !pairedTags.has(match[2]!)) return false;
      if (match[1] === "/") {
        if (stack.pop() !== match[2]) return false;
      } else {
        if (stack.length >= 64) return false;
        stack.push(match[2]!);
      }
    }
    position = end + 1;
  }
  return stack.length === 0;
}

export const descriptionHtmlSafeSchema = z.string().max(100_000)
  .refine(isDescriptionHtmlSafe, "DESCRIPTION_HTML_SAFE_CONTRACT_INVALID")
  .brand<"DescriptionHtmlSafe">();
export type DescriptionHtmlSafe = z.infer<typeof descriptionHtmlSafeSchema>;
