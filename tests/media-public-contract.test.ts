import { mediaPublicV1Schema } from "@ams-data-hub/realty-contracts";
import { describe, expect, it } from "vitest";
import { assertSnapshotPrivacySafe } from "../src/modules/snapshot-delivery/index.ts";

const media = { ref: "a".repeat(64), kind: "IMAGE", position: 0 };
describe("MediaPublicV1", () => {
  it("carries content identity and optional bounded public metadata, never a capability", () => {
    expect(mediaPublicV1Schema.parse({ ...media, width: 100, height: 200, alt: "" }))
      .toEqual({ ...media, width: 100, height: 200, alt: "" });
    expect(() => assertSnapshotPrivacySafe({ media: [media] })).not.toThrow();
  });
  it.each(["sourceUrl", "canonicalSourceUrl", "url", "storageRef", "storageKey", "bucket", "credentialRef", "originalFileName"])(
    "rejects extra %s instead of stripping provenance", (field) => {
      expect(mediaPublicV1Schema.safeParse({ ...media, [field]: "private-value" }).success).toBe(false);
    });
  it.each([
    { ref: "media/" + "a".repeat(64) }, { ref: "https://producer.example.test/image.png" },
    { kind: "VIDEO" }, { position: -1 }, { position: 10_001 }, { width: 0 }, { height: 1.5 }, { alt: "x".repeat(501) },
  ])("rejects invalid values %j", (invalid) => {
    expect(mediaPublicV1Schema.safeParse({ ...media, ...invalid }).success).toBe(false);
  });
  it("rejects producer provenance keys anywhere in a public snapshot", () => {
    expect(() => assertSnapshotPrivacySafe({ media: [{ sourceUrl: "https://producer.example.test/image.png" }] })).toThrow();
    expect(() => assertSnapshotPrivacySafe({ nested: { canonicalSourceUrl: "https://producer.example.test/image.png" } })).toThrow();
  });
});
