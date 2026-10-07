import { createUlid, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";
import { createCapturedMediaVerifier } from "../src/modules/media-assets/server.ts";
import { createSnapshotMediaProjectionServer } from "../src/modules/snapshot-delivery/server.ts";
import { prepareSnapshotMediaCandidates, projectSnapshotMedia, SNAPSHOT_INPUT_PART_KINDS, SnapshotInputPartsBuilder,
  snapshotBuildInputDigest, snapshotInputHash, type SnapshotBuildInputReceipt, type SnapshotInputPartKind } from "../src/modules/snapshot-delivery/index.ts";

const scope = { organizationId: "synthetic-org", projectId: "synthetic-project" }; const uid = createUlid();
const asset = { id: "private-asset", sha256: "a".repeat(64), storageKey: `media/${"a".repeat(64)}`, byteSize: 10,
  contentType: "image/png", rightsBasis: "OWNED", hasLicense: false };
const head = () => vi.fn(async (key: string) => ({ key, sha256: asset.sha256, contentLength: 10, contentType: "image/png", etag: null, lastModifiedAt: new Date(0) }));
function receipt(data: Partial<Record<SnapshotInputPartKind, CanonicalJsonValue[]>>): SnapshotBuildInputReceipt {
  const builder = new SnapshotInputPartsBuilder(); for (const kind of SNAPSHOT_INPUT_PART_KINDS) builder.add(kind, data[kind] ?? []);
  const parts = builder.finish(); const value = { id: "synthetic", ...scope, idempotencyKeyHash: "a".repeat(64), requestHash: "b".repeat(64),
    inputSchemaVersion: 1, projectorVersion: "db-v1", schemaMinor: 0, publishSequence: 1, projectStateRevision: 1,
    capturedAt: new Date("2026-10-07T00:00:00.000Z"), parts, catalogRevision: snapshotInputHash(parts.filter((part) => part.kind === "catalog")
      .map(({ partIndex, payloadHash }) => ({ partIndex, payloadHash }))), inputHash: "" };
  value.inputHash = snapshotBuildInputDigest(value); return value;
}
const pin = { uid, status: "ACTIVE", sourceId: "private-source", normalizedHash: "b".repeat(64), factRevisionId: "historical-good", approvedHeadId: "captured-head" };
const media = { kind: "LISTING_IMAGE", inventoryUid: uid, sourceId: pin.sourceId, recordHash: pin.normalizedHash,
  factRevisionId: pin.factRevisionId, approvedHeadId: pin.approvedHeadId, relationRevisionId: pin.factRevisionId,
  relationCanonicalUrlHash: "c".repeat(64),
  relationId: "private-relation", mirroredAt: "2026-10-07T00:00:00.000Z", mirrorStatus: "MIRRORED", position: 0, asset };
describe("captured snapshot media", () => {
  it("verifies repeated positions with one HEAD and emits only strict opaque attachments and owner refs", async () => {
    const storage = { head: head() }; const project = createSnapshotMediaProjectionServer({ ...scope, storage });
    const input = receipt({ inventory: [pin], media: [media, { ...media, position: 2 }] }); const before = structuredClone(input);
    const result = await project(input); expect(storage.head).toHaveBeenCalledOnce(); expect(input).toEqual(before);
    expect(result.dataset.records.map((record) => record.key)).toEqual([`INVENTORY/${uid}/0`, `INVENTORY/${uid}/2`]);
    expect(result.inventoryMedia.get(uid)).toEqual([{ ref: asset.sha256, kind: "IMAGE", position: 0 }, { ref: asset.sha256, kind: "IMAGE", position: 2 }]);
    expect(result.dataset.records[0]!.references).toEqual([{ kind: "inventory", key: uid }]);
    expect(JSON.stringify(result.dataset)).not.toMatch(/private|storageKey|sourceId|relationId|assetId/u);
    expect(await project(input)).toEqual(result); expect(storage.head).toHaveBeenCalledTimes(2); // cache is build-local
  });
  it("rejects scope, receipt tamper and wrong inventory pins before HEAD", async () => {
    const storage = { head: head() }; const project = createSnapshotMediaProjectionServer({ ...scope, storage });
    await expect(project({ ...receipt({}), projectId: "foreign" })).rejects.toThrow("SCOPE_INVALID");
    await expect(project({ ...receipt({}), inputHash: "c".repeat(64) })).rejects.toThrow("INPUT_INVALID");
    await expect(project(receipt({ inventory: [pin], media: [{ ...media, recordHash: "c".repeat(64) }] }))).rejects.toThrow("PIN_INVALID");
    expect(storage.head).not.toHaveBeenCalled();
  });
  it("fails closed on older media receipts lacking a strong relation hash before HEAD, without rewriting the receipt", async () => {
    const storage = { head: head() }; const project = createSnapshotMediaProjectionServer({ ...scope, storage });
    const { relationCanonicalUrlHash: _hash, ...legacy } = media; void _hash;
    const input = receipt({ inventory: [pin], media: [legacy] }); const before = structuredClone(input);
    await expect(project(input)).rejects.toThrow("SNAPSHOT_PUBLICATION_MEDIA_ANCHORS_INVALID");
    expect(input).toEqual(before); expect(storage.head).not.toHaveBeenCalled();
  });
  it.each(["key", "sha256", "contentType", "contentLength"])("omits HEAD mismatch %s without raw diagnostics", async (field) => {
    const storage = { head: vi.fn(async () => ({ key: asset.storageKey, sha256: asset.sha256, contentLength: 10,
      contentType: "image/png", etag: null, lastModifiedAt: new Date(0), [field]: field === "contentLength" ? 20 : "private-mismatch" })) };
    const result = await createSnapshotMediaProjectionServer({ ...scope, storage })(receipt({ inventory: [pin], media: [media] }));
    expect(result.dataset.records).toEqual([]); expect(result.diagnostics[0]!.code).toBe("MEDIA_OBJECT_UNAVAILABLE");
    expect(JSON.stringify(result.diagnostics)).not.toContain("private");
  });
  it("keeps warnings finite for missing mirror, invalid rights and thrown storage errors", async () => {
    const storage = { head: vi.fn(async () => { throw new Error("https://private.invalid/?token=private"); }) };
    const project = createSnapshotMediaProjectionServer({ ...scope, storage });
    const result = await project(receipt({ inventory: [pin], media: [media, { kind: "LISTING_IMAGE", inventoryUid: uid,
      factRevisionId: pin.factRevisionId, position: 1, omission: "MEDIA_MIRROR_UNAVAILABLE" },
      { ...media, position: 2, asset: { ...asset, rightsBasis: "LICENSED", hasLicense: false } }] }));
    expect(result.dataset.records).toEqual([]); expect(result.diagnostics.map((item) => item.code)).toEqual([
      "MEDIA_OBJECT_UNAVAILABLE", "MEDIA_MIRROR_UNAVAILABLE", "MEDIA_ASSET_INVALID"]);
    expect(storage.head).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain("private");
  });
  it("omits malformed digest/key/size/type as finite invalid-asset warnings before HEAD", async () => {
    const storage = { head: head() }; const project = createSnapshotMediaProjectionServer({ ...scope, storage });
    for (const patch of [{ sha256: "private-invalid" }, { storageKey: "private/key" }, { byteSize: -1 }, { contentType: "text/html" }]) {
      const result = await project(receipt({ inventory: [pin], media: [{ ...media, asset: { ...asset, ...patch } }] }));
      expect(result.diagnostics[0]!.code).toBe("MEDIA_ASSET_INVALID"); expect(result.dataset.records).toEqual([]);
    }
    expect(storage.head).not.toHaveBeenCalled();
  });
  it("never projects an explicitly omitted candidate even if a caller also supplies an asset", async () => {
    const storage = { head: head() }; const verify = createCapturedMediaVerifier({ ...scope, storage });
    const prepared = prepareSnapshotMediaCandidates(receipt({ inventory: [pin], media: [media] }))[0]!;
    const result = await verify(scope, [{ ...prepared, warning: "MEDIA_KIND_UNSUPPORTED" }]);
    expect(result.attachments).toEqual([]); expect(storage.head).not.toHaveBeenCalled();
    expect(result.diagnostics[0]!.code).toBe("MEDIA_KIND_UNSUPPORTED");
  });
  it("rejects conflicting metadata for the same object before HEAD, omits ambiguous owner positions", async () => {
    const storage = { head: head() }; const verify = createCapturedMediaVerifier({ ...scope, storage });
    const candidate = { entityType: "INVENTORY" as const, entityUid: uid, position: 0, asset: { ...asset, id: undefined } };
    const prepared = prepareSnapshotMediaCandidates(receipt({ inventory: [pin], media: [media] }))[0]!;
    await expect(verify(scope, [prepared, { ...prepared, position: 1, asset: { ...(prepared.asset as object), byteSize: 20 } }])).rejects.toThrow("ASSET_CONFLICT");
    expect(storage.head).not.toHaveBeenCalled();
    expect((await verify(scope, [prepared, prepared])).diagnostics.every((item) => item.code === "MEDIA_RELATION_AMBIGUOUS")).toBe(true);
    expect((await verify(scope, [candidate])).attachments).toEqual([]); // strict asset keys
  });
  it("uses captured consent and manual-slot priority, never fabricating GOOD feed-photo provenance", async () => {
    const agent = { uid, status: "ACTIVE", showOnSite: true, consentConfirmedAt: "2026-10-07T00:00:00.000Z", version: 2,
      photoMediaId: asset.id, feedPhotoMediaId: "private-feed" };
    const assigned = { kind: "AGENT_PHOTO", agentUid: uid, agentVersion: 2, slot: "photoMediaId", asset, provenance: "ASSIGNED_ASSET_ONLY" };
    const storage = { head: head() }; const project = createSnapshotMediaProjectionServer({ ...scope, storage });
    const result = await project(receipt({ agents: [agent], media: [assigned, { ...assigned, slot: "feedPhotoMediaId", asset: { ...asset, id: "private-feed" } }] }));
    expect(result.agentMedia.get(uid)).toEqual([{ ref: asset.sha256, kind: "IMAGE", position: 0 }]);
    const missing = { head: vi.fn(async () => null) };
    const omitted = await createSnapshotMediaProjectionServer({ ...scope, storage: missing })(receipt({ agents: [agent],
      media: [assigned, { ...assigned, slot: "feedPhotoMediaId", asset: { ...asset, id: "private-feed" } }] }));
    expect(omitted.agentMedia.size).toBe(0); expect(missing.head).toHaveBeenCalledOnce();
    expect((await project(receipt({ agents: [{ ...agent, consentConfirmedAt: null }], media: [assigned] }))).dataset.records).toEqual([]);
    await expect(project(receipt({ agents: [agent], media: [{ ...assigned, provenance: "GOOD" }] }))).rejects.toThrow("PIN_INVALID");
  });
  it("retains shared building association without requiring invented GOOD and omits unsupported kinds", async () => {
    const development = createUlid(); const building = createUlid();
    const shared = { kind: "DEVELOPMENT_IMAGE", sharedMediaId: "private-observation", sourceId: pin.sourceId, developmentUid: development,
      buildingUid: building, position: 0, asset, mirrorStatus: "MIRRORED", mirroredAt: media.mirroredAt, relationId: "private-relation",
      relationRevisionId: "manual-approved-observation", relationCanonicalUrlHash: "c".repeat(64), provenance: "SHARED_OBSERVATION_MIRROR" };
    const input = receipt({ catalog: [{ entityType: "development", uid: development }, { entityType: "building", uid: building, developmentUid: development }], media: [shared],
      "shared-media": [{ id: shared.sharedMediaId, sourceId: shared.sourceId, developmentUid: development, buildingUid: building,
        kind: "DEVELOPMENT_IMAGE", position: 0, canonicalUrlHash: "c".repeat(64), rightsBasis: "OWNED", hasLicense: false, hasAttribution: false }] });
    const project = createSnapshotMediaProjectionServer({ ...scope, storage: { head: head() } });
    expect((await project(input)).dataset.records[0]!.key).toBe(`BUILDING/${building}/0`);
    expect((await project(receipt({ catalog: input.parts.find((part) => part.kind === "catalog")!.payload,
      media: [{ ...shared, kind: "OTHER" }] }))).diagnostics[0]!.code).toBe("MEDIA_KIND_UNSUPPORTED");
  });
  it("rejects duplicate public attachments and illegal agent positions", () => {
    const attachment = { entityType: "AGENT" as const, entityUid: uid, media: { ref: asset.sha256, kind: "IMAGE" as const, position: 0 } };
    expect(() => projectSnapshotMedia([attachment, attachment])).toThrow("RECORD_DUPLICATE");
    expect(() => projectSnapshotMedia([{ ...attachment, media: { ...attachment.media, position: 1 } }])).toThrow();
  });
  it("performs sequential HEAD and owns immutable candidate metadata during IO", async () => {
    const first = prepareSnapshotMediaCandidates(receipt({ inventory: [pin], media: [media] }))[0]!;
    const secondAsset: Record<string, unknown> = { ...(first.asset as Record<string, unknown>), sha256: "c".repeat(64), storageKey: `media/${"c".repeat(64)}` };
    const candidates = [first, { ...first, position: 1, asset: secondAsset }]; let concurrent = 0;
    const storage = { head: vi.fn(async (key: string) => {
      concurrent++; expect(concurrent).toBe(1); secondAsset.byteSize = 999;
      await Promise.resolve(); concurrent--;
      return { key, sha256: key.slice(6), contentLength: 10, contentType: "image/png", etag: null, lastModifiedAt: new Date(0) };
    }) };
    expect((await createCapturedMediaVerifier({ ...scope, storage })(scope, candidates)).attachments).toHaveLength(2);
    expect(storage.head).toHaveBeenCalledTimes(2);
  });
});
