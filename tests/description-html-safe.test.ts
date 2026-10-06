import { descriptionHtmlSafeSchema } from "@ams-data-hub/realty-contracts";
import type { CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import { normalizeDescription } from "../src/modules/ingestion-core/domain/canonical-inventory.ts";
import { assertSnapshotPrivacySafe } from "../src/modules/snapshot-delivery/index.ts";

describe("portable sanitized description contract", () => {
  it.each(["", "plain &lt;script&gt; text", "<p>text</p>", "<strong>text</strong>",
    "<ul><li><em>text</em><br /></li></ul>", "<ol><li>one</li><li>two</li></ol>"])(
    "accepts sanitizer output %s without rewriting it", (html) => {
      expect(descriptionHtmlSafeSchema.parse(html)).toBe(html);
      expect(() => assertSnapshotPrivacySafe({ descriptionHtmlSafe: html })).not.toThrow();
    });

  it.each(["<script>alert(1)</script>", '<p onclick="bad()">text</p>', '<a href="https://example.test">text</a>',
    '<p href="x">text</p>', "<img src=x onerror=bad()>", "<p", "<!--x-->", "<p>unclosed", "<p><strong>x</p></strong>"])(
    "rejects unsafe or malformed declared safe markup %s", (html) => {
      expect(descriptionHtmlSafeSchema.safeParse(html).success).toBe(false);
      expect(() => assertSnapshotPrivacySafe({ descriptionHtmlSafe: html })).toThrow("SNAPSHOT_PRIVACY_RAW_HTML");
    });

  it("bounds length and nesting and rejects non-string declared output", () => {
    expect(descriptionHtmlSafeSchema.safeParse("x".repeat(100_001)).success).toBe(false);
    expect(descriptionHtmlSafeSchema.safeParse("<p>".repeat(65) + "x" + "</p>".repeat(65)).success).toBe(false);
    expect(() => assertSnapshotPrivacySafe({ descriptionHtmlSafe: { text: "x" } })).toThrow();
  });

  it("does not grant raw HTML or a renamed field the safe output exception", () => {
    const values: CanonicalJsonValue[] = [{ rawDescriptionHtml: "plain text" }, { rawDescriptionHtml: "<p>x</p>" },
      { description: "<p>x</p>" }, { description_html_safe: "<p>x</p>" }];
    for (const value of values) {
      expect(() => assertSnapshotPrivacySafe(value)).toThrow();
    }
  });

  it("uses ingestion sanitizer before granting the typed output contract", () => {
    const raw = '<p onclick="bad()">text<strong>safe</strong><a href="https://example.test">link</a><script>bad()</script></p>';
    const normalized = normalizeDescription(raw);
    expect(normalized.descriptionHtmlSafe).toBe("<p>text<strong>safe</strong>link</p>");
    expect(normalized.descriptionText).toBe("textsafelink");
    expect(() => assertSnapshotPrivacySafe(normalized)).not.toThrow();
  });
});
