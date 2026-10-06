import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { expect, it, vi } from "vitest";
import { S3ObjectStorage } from "../src/platform/storage/timeweb-s3-object-storage.ts";
import { createSourceArtifactKey, type ObjectStorageStreamingPutInput } from "../src/platform/storage/object-storage.ts";

const bytes = new TextEncoder().encode("synthetic streaming artifact");
const sha256 = createHash("sha256").update(bytes).digest("hex");
function input(): ObjectStorageStreamingPutInput {
  return { key: createSourceArtifactKey(sha256), sha256, contentLength: bytes.byteLength, contentType: "application/xml", openBody: () => (async function* () { yield bytes.subarray(0, 7); yield bytes.subarray(7); })() };
}
function client() { return new S3Client({ region: "synthetic", credentials: { accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret" } }); }

it("verifies a fresh bounded pass before uploading a new stream with length and SHA checksum", async () => {
  const sdk = client();
  const send = vi.spyOn(sdk, "send").mockImplementation(async (command) => {
    const put = command as PutObjectCommand;
    expect(put.input.Body).toBeInstanceOf(Readable);
    expect(put.input.ContentLength).toBe(bytes.byteLength);
    expect(put.input.ChecksumSHA256).toBe(Buffer.from(sha256, "hex").toString("base64"));
    let byteCount = 0;
    for await (const chunk of put.input.Body as Readable) byteCount += (chunk as Uint8Array).byteLength;
    expect(byteCount).toBe(bytes.byteLength);
    return { ETag: "synthetic-etag" } as never;
  });
  const storage = new S3ObjectStorage({ bucket: "synthetic-raw-bucket", client: sdk });
  const value = input();
  const open = vi.fn(value.openBody);
  await expect(storage.putStream({ ...value, openBody: open })).resolves.toMatchObject({ sha256, contentLength: bytes.byteLength, etag: "synthetic-etag" });
  expect(open).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenCalledTimes(1);
});

it.each(["hash", "length", "key", "oversized"])("rejects invalid %s before any S3 write", async (failure) => {
  const sdk = client();
  const send = vi.spyOn(sdk, "send");
  const storage = new S3ObjectStorage({ bucket: "synthetic-raw-bucket", client: sdk });
  const value = input();
  if (failure === "hash") { value.sha256 = "0".repeat(64); value.key = createSourceArtifactKey(value.sha256); }
  if (failure === "length") value.contentLength++;
  if (failure === "key") value.key = createSourceArtifactKey("0".repeat(64));
  if (failure === "oversized") value.contentLength = 257 * 1024 * 1024;
  await expect(storage.putStream(value)).rejects.toBeInstanceOf(Error);
  expect(send).not.toHaveBeenCalled();
});
