import { describe, expect, it, vi } from "vitest";
import type { CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { createMediaSnapshotFactReader, type InventorySnapshotMediaPin } from "../src/modules/media-assets/server.ts";
import type { DatabaseTransaction } from "../src/platform/database/transaction.ts";

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
