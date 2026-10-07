import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import { createMediaKey } from "../src/platform/storage/object-storage.ts";
import { prepareSnapshotPublicationMediaPins, selectSnapshotPublicationMediaAnchors,
  PUBLICATION_MEDIA_TRIM_CHARACTERS } from "../src/modules/media-assets/application/snapshot-publication-media-anchors.ts";
import type { CapturedMediaCandidate } from "../src/modules/media-assets/server.ts";

function inventory(position = 0) {
  const uid = createUlid(); const asset = { id: "asset", sha256: "a".repeat(64), storageKey: createMediaKey("a".repeat(64)),
    contentType: "image/jpeg", byteSize: 100, rightsBasis: "OWNED", hasLicense: false };
  const { id: _id, ...publicAsset } = asset; void _id;
  const candidate: CapturedMediaCandidate = { entityType: "INVENTORY", entityUid: uid, position, asset: publicAsset };
  return { candidate, captured: { kind: "LISTING_IMAGE", inventoryUid: uid, sourceId: "source", relationId: "relation",
    relationRevisionId: "historical-revision", relationCanonicalUrlHash: "b".repeat(64), mirrorStatus: "MIRRORED",
    mirroredAt: "2026-10-07T01:02:03.789Z", relationUpdatedAt: "2026-10-07T01:02:03.789Z", asset,
    privateFilename: "synthetic-private", sourceUrl: "https://private.example.invalid/image" } };
}
function published(row: ReturnType<typeof inventory>) {
  return { entityType: row.candidate.entityType, entityUid: row.candidate.entityUid,
    media: { kind: "IMAGE" as const, position: row.candidate.position, ref: row.captured.asset.sha256 } };
}
describe("value-free HEAD-selected publication media anchors", () => {
  it("copies provenance before IO and publishes only verified owner/position/ref pins", () => {
    const row = inventory(); const pins = prepareSnapshotPublicationMediaPins({ candidates: [row], sharedFacts: [] });
    row.captured.asset.byteSize = 999;
    const anchors = selectSnapshotPublicationMediaAnchors("project", pins, [published(row)]);
    expect(anchors.attachments[0]!.asset.byteSize).toBe(100);
    expect(JSON.stringify(anchors)).not.toMatch(/https:|private|Filename|sourceUrl|license":|attribution":|UpdatedAt|mirroredAt/u);
    expect(selectSnapshotPublicationMediaAnchors("project", pins, []).attachments).toEqual([]);
  });
  it("preserves repeated immutable producer positions sharing one relation and asset", () => {
    const first = inventory(); const last = { ...first, candidate: { ...first.candidate, position: 2 } };
    const pins = prepareSnapshotPublicationMediaPins({ candidates: [first, last], sharedFacts: [] });
    expect(selectSnapshotPublicationMediaAnchors("project", pins, [published(first), published(last)]).attachments.map((row) => row.position)).toEqual([0, 2]);
    expect(pins.map((row) => row.relation!.id)).toEqual(["relation", "relation"]);
  });
  it.each(["missing-hash", "invalid-hash", "candidate-drift", "asset-conflict", "relation-conflict"])("rejects %s before IO", (mode) => {
    const row = inventory(); const candidates = [row];
    if (mode === "missing-hash") Reflect.deleteProperty(row.captured, "relationCanonicalUrlHash");
    if (mode === "invalid-hash") row.captured.relationCanonicalUrlHash = "invalid";
    if (mode === "candidate-drift") row.captured.asset.byteSize = 999;
    if (mode === "asset-conflict") {
      const other = inventory(1); other.captured.asset.sha256 = "c".repeat(64); other.captured.asset.storageKey = createMediaKey("c".repeat(64));
      const { id: _id, ...asset } = other.captured.asset; void _id; other.candidate.asset = asset; candidates.push(other);
    }
    if (mode === "relation-conflict") candidates.push({ ...row, candidate: { ...row.candidate, position: 1 },
      captured: { ...row.captured, relationRevisionId: "different-revision" } });
    expect(() => prepareSnapshotPublicationMediaPins({ candidates, sharedFacts: [] })).toThrow("SNAPSHOT_PUBLICATION_MEDIA_ANCHORS_INVALID");
  });
  it("does not anchor unsupported, omitted or invalid assets", () => {
    const row = inventory(); row.candidate.warning = "MEDIA_MIRROR_UNAVAILABLE";
    const invalid = inventory(); invalid.candidate.asset = null;
    expect(prepareSnapshotPublicationMediaPins({ candidates: [row, invalid], sharedFacts: [] })).toEqual([]);
  });
  it("rejects verified references missing an exact prepared pin and duplicate public identities", () => {
    const row = inventory(); const pins = prepareSnapshotPublicationMediaPins({ candidates: [row], sharedFacts: [] });
    expect(() => selectSnapshotPublicationMediaAnchors("project", [], [published(row)])).toThrow("SNAPSHOT_PUBLICATION_MEDIA_ANCHORS_INVALID");
    expect(() => selectSnapshotPublicationMediaAnchors("project", pins, [published(row), published(row)])).toThrow("SNAPSHOT_PUBLICATION_MEDIA_ANCHORS_INVALID");
  });
  it("uses the same complete ECMAScript whitespace set for metadata-only license markers", () => {
    expect(PUBLICATION_MEDIA_TRIM_CHARACTERS.trim()).toBe("");
    for (const char of PUBLICATION_MEDIA_TRIM_CHARACTERS) expect(char.trim()).toBe("");
    expect("\u0085".trim()).toBe("\u0085"); expect(PUBLICATION_MEDIA_TRIM_CHARACTERS).not.toContain("\u0085");
  });
  it("pins shared ownership and captured rights metadata without license/attribution values", () => {
    const base = inventory(); const developmentUid = createUlid(); const buildingUid = createUlid();
    const row = { candidate: { ...base.candidate, entityType: "BUILDING" as const, entityUid: buildingUid },
      captured: { ...base.captured, kind: "DEVELOPMENT_IMAGE", sharedMediaId: "observation", developmentUid, buildingUid } };
    const observation = { id: "observation", sourceId: "source", developmentUid, buildingUid, kind: "DEVELOPMENT_IMAGE", position: 0,
      canonicalUrlHash: "c".repeat(64), rightsBasis: "LICENSED", hasLicense: false, hasAttribution: true,
      attribution: "synthetic-private", license: "synthetic-private", externalId: "synthetic-private" };
    const pins = prepareSnapshotPublicationMediaPins({ candidates: [row], sharedFacts: [observation] });
    expect(pins[0]!.observation).toMatchObject({ rightsBasis: "LICENSED", hasAttribution: true, hasLicense: false });
    expect(JSON.stringify(pins)).not.toContain("synthetic-private");
    observation.hasAttribution = false;
    expect(() => prepareSnapshotPublicationMediaPins({ candidates: [row], sharedFacts: [observation] })).toThrow("SNAPSHOT_PUBLICATION_MEDIA_ANCHORS_INVALID");
    row.candidate.warning = "MEDIA_MIRROR_UNAVAILABLE";
    expect(prepareSnapshotPublicationMediaPins({ candidates: [row], sharedFacts: [observation] })).toEqual([]);
  });
});
