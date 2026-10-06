import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { S3ObjectStorage } from "../src/platform/storage/timeweb-s3-object-storage.ts";
import { calculateObjectSha256, createMediaKey } from "../src/platform/storage/object-storage.ts";

const bytes = new TextEncoder().encode("synthetic bounded object");
const key = createMediaKey(calculateObjectSha256(bytes));
function fixture(chunks: Uint8Array[] = [bytes], length: number = bytes.length) {
  const client = new S3Client({ region: "ru-1", credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" } });
  const opened = vi.fn(); const destroy = vi.fn(); const transformToByteArray = vi.fn();
  const body = { destroy, transformToByteArray, async *[Symbol.asyncIterator]() { opened(); yield* chunks; } };
  const send = vi.spyOn(client, "send").mockResolvedValue({ Body: body, ContentLength: length,
    ContentType: "application/octet-stream", LastModified: new Date(0) } as never);
  return { storage: new S3ObjectStorage({ bucket: "synthetic", client }), body, send, opened, destroy, transformToByteArray };
}
describe("bounded immutable object GET", () => {
  it("streams and hashes bounded chunks without the SDK whole-body allocator", async () => {
    const f = fixture([bytes.slice(0, 3), bytes.slice(3)]);
    expect((await f.storage.getBounded({ key, maxBytes: bytes.length }))?.body).toEqual(Buffer.from(bytes));
    expect(f.transformToByteArray).not.toHaveBeenCalled(); expect(f.destroy).toHaveBeenCalledOnce();
  });
  it("rejects oversized metadata before opening the body", async () => {
    const f = fixture(); await expect(f.storage.getBounded({ key, maxBytes: 1 })).rejects.toThrow("OBJECT_STORAGE_READ_TOO_LARGE");
    expect(f.opened).not.toHaveBeenCalled(); expect(f.destroy).toHaveBeenCalledOnce();
  });
  it.each([
    [bytes, 1, bytes.length, "LENGTH_MISMATCH"],
    [bytes, 1, 1, "TOO_LARGE"],
    [bytes.slice(1), bytes.length, bytes.length, "LENGTH_MISMATCH"],
    [new Uint8Array(bytes.length), bytes.length, bytes.length, "HASH_MISMATCH"],
    [bytes, -1, bytes.length, "METADATA_INVALID"],
  ])("fails closed on streamed size and digest violations (%s)", async (chunk, length, maxBytes, code) => {
    const f = fixture([chunk as Uint8Array], length as number);
    await expect(f.storage.getBounded({ key, maxBytes: maxBytes as number })).rejects.toThrow(`OBJECT_STORAGE_READ_${code}`);
    expect(f.destroy).toHaveBeenCalledOnce();
  });
  it("aborts a stalled stream and destroys it", async () => {
    const f = fixture(); const controller = new AbortController(); const started = Promise.withResolvers<void>();
    f.body[Symbol.asyncIterator] = async function* () { started.resolve(); await new Promise(() => {}); yield bytes; };
    const read = f.storage.getBounded({ key, maxBytes: bytes.length, signal: controller.signal });
    const rejected = expect(read).rejects.toThrow("OBJECT_STORAGE_READ_ABORTED");
    await started.promise; controller.abort(); await rejected; expect(f.destroy).toHaveBeenCalledOnce();
  });
  it("redacts SDK errors and treats only missing objects as absent", async () => {
    const f = fixture(); f.send.mockRejectedValueOnce(new Error("https://private.invalid?secret=synthetic"));
    await expect(f.storage.getBounded({ key, maxBytes: bytes.length })).rejects.toThrow(/^OBJECT_STORAGE_READ_FAILED$/);
    f.send.mockRejectedValueOnce({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    await expect(f.storage.getBounded({ key, maxBytes: bytes.length })).resolves.toBeNull();
  });
  it("rejects a non-cancellable iterable and handles many tiny chunks", async () => {
    const f = fixture([...bytes].flatMap((byte) => [new Uint8Array(), Uint8Array.of(byte)]));
    expect((await f.storage.getBounded({ key, maxBytes: bytes.length }))?.body).toEqual(Buffer.from(bytes));
    f.send.mockResolvedValueOnce({ Body: { async *[Symbol.asyncIterator]() { yield bytes; } }, ContentLength: bytes.length } as never);
    await expect(f.storage.getBounded({ key, maxBytes: bytes.length })).rejects.toThrow("OBJECT_STORAGE_READ_STREAM_UNSUPPORTED");
  });
});
