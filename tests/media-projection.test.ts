import { describe, expect, it, vi } from "vitest";
import { createInventoryMediaProjectionService } from "../src/modules/media-assets/application/media-projection-service.ts";
import type { InventoryMediaProjectionState } from "../src/modules/media-assets/application/ports/media-projection-repository.ts";
import type { PrincipalContext } from "../src/platform/authorization/principal.ts";
import type { DatabaseTransaction } from "../src/platform/database/transaction.ts";

const input = { organizationId: "org", projectId: "project", sourceId: "source", sourceRevisionId: "revision", inventoryUid: "uid", expectedRecordHash: "a".repeat(64) };
const principal: PrincipalContext = { kind: "project-job", organizationId: "org", projectId: "project", jobName: "snapshot", correlationId: "synthetic" };
const digest = "a".repeat(64);
function fixture(): InventoryMediaProjectionState {
  return { images: [{ sourceUrl: "https://producer.example.invalid/a.png?private=synthetic", position: 0 }], relations: [{
    id: "relation", canonicalSourceUrl: "https://producer.example.invalid/a.png", position: 0, status: "MIRRORED", mirroredAt: new Date(0),
    asset: { id: "asset", organizationId: "org", projectId: "project", sha256: digest, storageKey: `media/${digest}`, contentType: "image/png",
      byteSize: 10, originalFileName: "private.png", rightsBasis: "LICENSED", source: "private-provenance", license: "synthetic" },
  }] };
}
function harness(state: InventoryMediaProjectionState | null = fixture()) {
  let inTransaction = false;
  const load = vi.fn(async () => state);
  const head = vi.fn(async () => {
    expect(inTransaction).toBe(false);
    return { key: `media/${digest}`, sha256: digest, contentLength: 10, contentType: "image/png", etag: null, lastModifiedAt: new Date(0) };
  });
  const project = createInventoryMediaProjectionService({ storage: { head }, createRepository: () => ({ loadInventory: load }),
    runInTransaction: async (_principal, execute) => {
      inTransaction = true;
      try { return await execute({} as DatabaseTransaction); } finally { inTransaction = false; }
    },
  });
  return { project, head, load };
}
describe("scoped inventory media projection", () => {
  it("returns only validated content references and performs HEAD outside transactions", async () => {
    const h = harness();
    expect(await h.project(principal, input)).toEqual({ media: [{ ref: digest, kind: "IMAGE", position: 0 }], warnings: [] });
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(h.head).toHaveBeenCalledOnce();
  });
  it("denies cross-project principal before any database/storage access", async () => {
    const h = harness();
    await expect(h.project({ ...principal, projectId: "other" }, input)).rejects.toThrow("MEDIA_PROJECTION_PROJECT_SCOPE_REQUIRED");
    expect(h.load).not.toHaveBeenCalled(); expect(h.head).not.toHaveBeenCalled();
  });
  it("denies missing/non-GOOD/replaced revision before HEAD", async () => {
    const h = harness(null);
    await expect(h.project(principal, input)).rejects.toThrow("MEDIA_PROJECTION_REVISION_NOT_FOUND");
    expect(h.head).not.toHaveBeenCalled();
  });
  it.each(["project", "key", "license", "unmirrored"])("omits invalid asset %s before HEAD", async (variant) => {
    const state = fixture(); const relation = state.relations[0]!; const asset = relation.asset!;
    if (variant === "project") asset.projectId = "other";
    if (variant === "key") asset.storageKey = "private/key";
    if (variant === "license") asset.license = null;
    if (variant === "unmirrored") relation.mirroredAt = null;
    const h = harness(state);
    expect((await h.project(principal, input)).media).toEqual([]); expect(h.head).not.toHaveBeenCalled();
  });
  it("rejects relations absent from persisted image membership", async () => {
    const state = fixture(); state.relations[0]!.canonicalSourceUrl = "https://producer.example.invalid/removed.png";
    const h = harness(state);
    expect(await h.project(principal, input)).toEqual({ media: [], warnings: ["MEDIA_MIRROR_UNAVAILABLE"] }); expect(h.head).not.toHaveBeenCalled();
  });
  it("retains a valid previous mirror after warning without URL fallback", async () => {
    const state = fixture(); state.relations[0]!.status = "WARNING";
    expect(await harness(state).project(principal, input)).toEqual({ media: [{ ref: digest, kind: "IMAGE", position: 0 }], warnings: ["MEDIA_MIRROR_WARNING"] });
  });
  it("treats a failed first mirror as a non-fatal warning, not corrupt inventory", async () => {
    const state = fixture(); state.relations[0]!.status = "WARNING"; state.relations[0]!.asset = null; state.relations[0]!.mirroredAt = null;
    const h = harness(state);
    expect(await h.project(principal, input)).toEqual({ media: [], warnings: ["MEDIA_MIRROR_WARNING"] }); expect(h.head).not.toHaveBeenCalled();
  });
  it("preserves repeated producer URL positions from persisted facts using one verified object", async () => {
    const state = fixture(); state.images = [...state.images, { ...state.images[0]!, position: 2 }];
    state.relations[0]!.position = 2;
    const h = harness(state);
    expect((await h.project(principal, input)).media).toEqual([{ ref: digest, kind: "IMAGE", position: 0 }, { ref: digest, kind: "IMAGE", position: 2 }]);
    expect(h.head).toHaveBeenCalledOnce();
  });
  it("omits missing storage object with only a value-free warning", async () => {
    const h = harness(); h.head.mockRejectedValue(new Error("https://private.example.invalid/?token=never-return"));
    expect(await h.project(principal, input)).toEqual({ media: [], warnings: ["MEDIA_OBJECT_UNAVAILABLE"] });
  });
  it.each(["digest", "length", "type", "key"])("omits mismatched object %s", async (variant) => {
    const h = harness();
    h.head.mockResolvedValue({ key: variant === "key" ? "private/key" : `media/${digest}`,
      sha256: variant === "digest" ? "b".repeat(64) : digest,
      contentLength: variant === "length" ? 20 : 10, contentType: variant === "type" ? "text/html" : "image/png",
      etag: null, lastModifiedAt: new Date(0) });
    expect(await h.project(principal, input)).toEqual({ media: [], warnings: ["MEDIA_OBJECT_UNAVAILABLE"] });
  });
  it("denies a change of revision or relation while HEAD is in flight", async () => {
    const h = harness(); h.load.mockResolvedValueOnce(fixture()).mockResolvedValueOnce(null);
    await expect(h.project(principal, input)).rejects.toThrow("MEDIA_PROJECTION_STALE");
  });
});
