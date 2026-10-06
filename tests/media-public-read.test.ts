import { describe, expect, it, vi } from "vitest";
import { createInventoryPublicMediaReadService } from "../src/modules/media-assets/application/media-public-read-service.ts";
import { calculateObjectSha256, createMediaKey, type ObjectStorageGetResult } from "../src/platform/storage/object-storage.ts";
import { createProjectJobPrincipal } from "../src/platform/authorization/principal-factories.ts";

const body = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
const ref = calculateObjectSha256(body);
const input = { organizationId: "org", projectId: "project", sourceId: "source", sourceRevisionId: "revision",
  inventoryUid: "inventory", expectedRecordHash: "a".repeat(64), ref, position: 0 };
const principal = createProjectJobPrincipal({ organizationId: input.organizationId, projectId: input.projectId, jobName: "synthetic" });
function fixture() {
  const object: ObjectStorageGetResult = { key: createMediaKey(ref), sha256: ref, body, contentType: "image/png",
    contentLength: body.length, etag: null, lastModifiedAt: new Date(0) };
  const projectMedia = vi.fn(async () => ({ media: [{ ref, position: 0, kind: "IMAGE" as const }], warnings: [] }));
  const storage = { put: vi.fn(), get: vi.fn(), head: vi.fn(), presignGet: vi.fn(), getBounded: vi.fn(async () => object) };
  return { storage, projectMedia, object, read: createInventoryPublicMediaReadService({ storage, projectMedia }) };
}
describe("authorized public mirrored media read", () => {
  it("checks persisted membership twice and returns no private object fields", async () => {
    const f = fixture(); const controller = new AbortController();
    const result = await f.read(principal, input, { signal: controller.signal });
    expect(Object.keys(result).sort()).toEqual(["body", "contentType", "ref"]); expect(result.body).toEqual(body);
    expect(f.projectMedia).toHaveBeenCalledTimes(2); expect(f.projectMedia).toHaveBeenCalledWith(principal,
      { organizationId: "org", projectId: "project", sourceId: "source", sourceRevisionId: "revision", inventoryUid: "inventory", expectedRecordHash: input.expectedRecordHash });
    expect(f.storage.getBounded).toHaveBeenCalledWith({ key: createMediaKey(ref), maxBytes: 20 * 1024 * 1024, signal: controller.signal });
    expect(f.storage.get).not.toHaveBeenCalled();
  });
  it("denies missing or wrong-position membership before object I/O", async () => {
    const f = fixture(); await expect(f.read(principal, { ...input, position: 1 })).rejects.toThrow("MEDIA_PUBLIC_OBJECT_NOT_FOUND");
    expect(f.storage.getBounded).not.toHaveBeenCalled();
  });
  it("fails closed without bounded capability rather than using legacy GET", async () => {
    const f = fixture(); const { getBounded: _unused, ...storage } = f.storage; void _unused;
    await expect(createInventoryPublicMediaReadService({ storage, projectMedia: f.projectMedia })(principal, input)).rejects.toThrow("MEDIA_BOUNDED_STORAGE_REQUIRED");
    expect(storage.get).not.toHaveBeenCalled();
  });
  it.each([
    { key: createMediaKey("b".repeat(64)) }, { sha256: "b".repeat(64) }, { contentLength: 1 },
    { contentType: "image/jpeg" }, { contentType: "text/html" }, { body: new Uint8Array(body.length) },
  ])("rejects corrupt body or metadata %j", async (patch) => {
    const f = fixture(); f.storage.getBounded.mockResolvedValue({ ...f.object, ...patch });
    await expect(f.read(principal, input)).rejects.toThrow("MEDIA_PUBLIC_OBJECT_UNAVAILABLE");
    expect(f.projectMedia).toHaveBeenCalledOnce();
  });
  it("denies membership withdrawn while reading", async () => {
    const f = fixture(); f.projectMedia.mockResolvedValueOnce({ media: [{ ref, position: 0, kind: "IMAGE" }], warnings: [] })
      .mockResolvedValueOnce({ media: [], warnings: [] });
    await expect(f.read(principal, input)).rejects.toThrow("MEDIA_PUBLIC_OBJECT_STALE");
  });
  it("redacts storage errors", async () => {
    const f = fixture(); f.storage.getBounded.mockRejectedValue(new Error("private synthetic URL"));
    await expect(f.read(principal, input)).rejects.toThrow(/^MEDIA_PUBLIC_OBJECT_UNAVAILABLE$/);
  });
});
