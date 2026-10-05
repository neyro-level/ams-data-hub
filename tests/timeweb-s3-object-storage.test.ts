import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { describe, expect, it, vi } from "vitest";

import {
  S3ObjectStorage,
  createTimewebS3ObjectStorage,
} from "../src/platform/storage/timeweb-s3-object-storage.ts";
import { calculateObjectSha256, createProjectSnapshotKey } from "../src/platform/storage/object-storage.ts";

vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));

const body = new TextEncoder().encode("safe fixture only");
const sha256 = calculateObjectSha256(body);
const key = createProjectSnapshotKey("project_A", sha256);

function createClient() {
  return new S3Client({
    endpoint: "https://s3.twcstorage.ru",
    region: "ru-1",
    credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
    forcePathStyle: true,
  });
}

describe("Timeweb S3 object storage", () => {
  it("uses path-style immutable put requests without any bucket-management operation", async () => {
    const client = createClient();
    const send = vi.spyOn(client, "send").mockResolvedValue({ ETag: "fixture-etag" } as never);
    const storage = new S3ObjectStorage({ bucket: "data-hub-project-a", client });

    await expect(storage.put({ key, body, contentType: "application/json", sha256 })).resolves.toMatchObject({
      key,
      sha256,
      etag: "fixture-etag",
    });

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: "data-hub-project-a",
      Key: key,
      ContentType: "application/json",
    });
  });

  it("returns null only for an S3 missing-object response", async () => {
    const client = createClient();
    const send = vi.spyOn(client, "send").mockRejectedValue({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    const storage = new S3ObjectStorage({ bucket: "data-hub-project-a", client });

    await expect(storage.get(key)).resolves.toBeNull();
    await expect(storage.head(key)).resolves.toBeNull();
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("reads only an object whose body matches the immutable key digest", async () => {
    const client = createClient();
    vi.spyOn(client, "send").mockResolvedValue({
      Body: { transformToByteArray: vi.fn().mockResolvedValue(body) },
      ContentType: "application/json",
      ContentLength: body.byteLength,
      LastModified: new Date("2026-10-03T00:00:00.000Z"),
      ETag: "fixture-etag",
    } as never);
    const storage = new S3ObjectStorage({ bucket: "data-hub-project-a", client });

    await expect(storage.get(key)).resolves.toMatchObject({ key, body, sha256 });
  });

  it("rejects an unapproved key before sending an S3 request", async () => {
    const client = createClient();
    const send = vi.spyOn(client, "send");
    const storage = new S3ObjectStorage({ bucket: "data-hub-project-a", client });

    await expect(storage.get("untrusted/key")).rejects.toThrow("approved immutable namespace");
    expect(send).not.toHaveBeenCalled();
  });

  it("issues only a short-lived exact-key presigned URL", async () => {
    vi.mocked(getSignedUrl).mockResolvedValue(`https://s3.twcstorage.ru/data-hub-project-a/${key}?signed=fixture`);
    const storage = new S3ObjectStorage({ bucket: "data-hub-project-a", client: createClient() });

    await expect(storage.presignGet({ key, expiresInSeconds: 300 })).resolves.toMatchObject({
      url: expect.any(URL),
    });
    await expect(storage.presignGet({ key, expiresInSeconds: 301 })).rejects.toThrow("between 1 and 300");
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.any(S3Client),
      expect.objectContaining({ input: expect.objectContaining({ Bucket: "data-hub-project-a", Key: key }) }),
      { expiresIn: 300 },
    );
  });

  it("fails closed before creating an S3 client from an unsafe endpoint or incomplete credentials", () => {
    const base = {
      bucket: "data-hub-project-a",
      endpoint: "https://s3.twcstorage.ru",
      region: "ru-1",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
    };

    expect(() => createTimewebS3ObjectStorage({ ...base, endpoint: "http://s3.twcstorage.ru" })).toThrow("HTTPS origin");
    expect(() => createTimewebS3ObjectStorage({ ...base, credentials: { accessKeyId: "", secretAccessKey: "test-secret-key" } })).toThrow("access key id");
    expect(() => createTimewebS3ObjectStorage(base)).not.toThrow();
  });
});
