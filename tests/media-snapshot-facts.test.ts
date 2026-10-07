import { describe, expect, it, vi } from "vitest";
import type { CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { createMediaSnapshotFactReader, type InventorySnapshotMediaPin } from "../src/modules/media-assets/server.ts";
import type { DatabaseTransaction } from "../src/platform/database/transaction.ts";
import { createMediaKey } from "../src/platform/storage/object-storage.ts";

const scope = { organizationId: "synthetic-org", projectId: "synthetic-project" };
const pin: InventorySnapshotMediaPin = { sourceId: "synthetic-source", inventoryUid: "synthetic-inventory",
  externalOfferId: "synthetic-offer", normalizedHash: "a".repeat(64), factRevisionId: "synthetic-fact",
  factRevisionSequence: 1, approvedHeadId: "synthetic-head", approvedHeadSequence: 2 };
function database(imageUrls: string[]) {
  return { inventoryIdentity: { count: vi.fn(async () => 1) }, sourceRevision: { count: vi.fn(async () => 1) },
    source: { count: vi.fn(async () => 1) }, $queryRaw: vi.fn(async () => [{ images: imageUrls }]),
    mediaSource: { findMany: vi.fn(async () => []) } } as unknown as DatabaseTransaction;
}

describe("media capture bounded batching (native tests own eligibility proof)", () => {
  it("batches shared associations by observation page, not by asset or development", async () => {
    const observations = Array.from({ length: 201 }, (_, index) => ({ id: `shared-${String(index).padStart(3, "0")}`,
      sourceId: "source", developmentUid: "development", buildingUid: null, kind: "DEVELOPMENT_IMAGE",
      position: index, canonicalSourceUrl: `https://example.invalid/${index}.jpg`, rightsBasis: "OWNED",
      attribution: null, observedAt: new Date(0), updatedAt: new Date(0) }));
    const tx = { sharedMediaAsset: { findMany: vi.fn().mockResolvedValueOnce(observations.slice(0, 200))
      .mockResolvedValueOnce(observations.slice(200)).mockResolvedValueOnce([]) },
      mediaSource: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as DatabaseTransaction;
    const pages: CanonicalJsonValue[][] = [];
    const reader = createMediaSnapshotFactReader(tx, (_kind, rows) => pages.push(rows));
    await reader.captureShared(scope, ["development"]); reader.finishCapture();
    expect(pages.map((page) => page.length)).toEqual([200, 1]);
    expect(tx.mediaSource.findMany).toHaveBeenCalledTimes(2);
    const relationCalls = vi.mocked(tx.mediaSource.findMany).mock.calls;
    expect(relationCalls[0]![0]).toMatchObject({ take: 201, where: { ...scope, OR: expect.any(Array) } });
    expect((relationCalls[0]![0]!.where!.OR as unknown[]).length).toBe(200);
    expect((relationCalls[1]![0]!.where!.OR as unknown[]).length).toBe(1);
    expect(JSON.stringify(pages)).not.toContain("https:");
  });

  it("rejects an oversized shared candidate closure without allowing finalization", async () => {
    const sink = vi.fn();
    const reader = createMediaSnapshotFactReader(database([]), sink);
    await expect(reader.captureShared(scope, Array.from({ length: 5001 }, () => "development")))
      .rejects.toThrow("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
    expect(() => reader.finishCapture()).toThrow("SNAPSHOT_INPUT_MEDIA_CAPTURE_CLOSED");
    expect(sink).not.toHaveBeenCalled();
  });

  it("loads assigned agent assets once per bounded page and preserves ownership slots", async () => {
    const sha256 = "b".repeat(64);
    const tx = { agent: { findMany: vi.fn().mockResolvedValueOnce([
      { uid: "agent-one", version: 3, photoMediaId: "asset-one", feedPhotoMediaId: "asset-one" },
      { uid: "agent-two", version: 1, photoMediaId: "unavailable", feedPhotoMediaId: null },
    ]).mockResolvedValueOnce([]) }, mediaAsset: { findMany: vi.fn().mockResolvedValue([
      { ...scope, id: "asset-one", sha256, storageKey: createMediaKey(sha256), contentType: "image/jpeg",
        byteSize: 100, rightsBasis: "OWNED", license: null },
    ]) } } as unknown as DatabaseTransaction;
    const pages: CanonicalJsonValue[][] = [];
    const reader = createMediaSnapshotFactReader(tx, (_kind, rows) => pages.push(rows));
    await reader.captureAgents(scope);
    reader.finishCapture();
    expect(pages.flat()).toEqual([
      expect.objectContaining({ agentUid: "agent-one", agentVersion: 3, slot: "photoMediaId", asset: expect.any(Object) }),
      expect.objectContaining({ agentUid: "agent-one", slot: "feedPhotoMediaId", asset: expect.any(Object) }),
      { agentUid: "agent-two", agentVersion: 1, kind: "AGENT_PHOTO", slot: "photoMediaId", omission: "MEDIA_ASSET_UNAVAILABLE" },
    ]);
    expect(tx.mediaAsset.findMany).toHaveBeenCalledExactlyOnceWith({ where: { ...scope,
      id: { in: ["asset-one", "unavailable"] } }, take: 401, select: expect.any(Object) });
    expect(tx.agent.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 200,
      where: { ...scope, status: "ACTIVE", showOnSite: true, consentConfirmedAt: { not: null }, uid: { gt: "agent-two" } } }));
  });

  it("does not consume one empty part per image-less inventory", async () => {
    const sink = vi.fn();
    const reader = createMediaSnapshotFactReader(database([]), sink);
    for (let index = 0; index < 4100; index++) await reader.captureInventory(scope, { ...pin, inventoryUid: `synthetic-${index}` });
    expect(sink).not.toHaveBeenCalled();
    reader.finishCapture();
    expect(sink).toHaveBeenCalledExactlyOnceWith("media", []);
    expect(() => reader.finishCapture()).toThrow("SNAPSHOT_INPUT_MEDIA_CAPTURE_CLOSED");
  });

  it("batches repeated producer positions across inventory/page boundaries", async () => {
    const pages: CanonicalJsonValue[][] = [];
    const reader = createMediaSnapshotFactReader(database(Array.from({ length: 500 }, () => "https://example.invalid/a.jpg")),
      (_kind, rows) => pages.push(rows));
    for (let index = 0; index < 5; index++) await reader.captureInventory(scope, { ...pin, inventoryUid: `synthetic-${index}` });
    reader.finishCapture();
    expect(pages).toHaveLength(13);
    expect(pages.every((page) => page.length > 0 && page.length <= 200)).toBe(true);
    const rows = pages.flat();
    expect(rows).toHaveLength(2500);
    for (let index = 0; index < rows.length; index++) expect(rows[index]).toMatchObject({
      inventoryUid: `synthetic-${Math.floor(index / 500)}`, position: index % 500, omission: "MEDIA_MIRROR_UNAVAILABLE" });
  });

  it("does not finalize a partial capture after an eligibility failure", async () => {
    const tx = database([]);
    const sink = vi.fn();
    const reader = createMediaSnapshotFactReader(tx, sink);
    await reader.captureInventory(scope, pin);
    vi.mocked(tx.inventoryIdentity.count).mockResolvedValueOnce(0);
    await expect(reader.captureInventory(scope, pin)).rejects.toThrow("SNAPSHOT_INPUT_MEDIA_PIN_INVALID");
    expect(() => reader.finishCapture()).toThrow("SNAPSHOT_INPUT_MEDIA_CAPTURE_CLOSED");
    expect(sink).not.toHaveBeenCalled();
  });
});
