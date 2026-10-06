import "server-only";

import { createHash } from "node:crypto";
import { addAbortSignal, Readable } from "node:stream";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  assertImmutableObjectStoragePut,
  calculateObjectSha256,
  getObjectStorageKeySha256,
  MAX_STREAMING_OBJECT_BYTES,
  type ObjectStorage,
  type ObjectStorageGetResult,
  type ObjectStorageKey,
  type ObjectStorageObject,
  type ObjectStoragePresignGetInput,
  type ObjectStoragePresignedUrl,
  type ObjectStoragePutInput,
  type ObjectStorageStreamingPutInput,
  type StreamingObjectStorage,
  type BoundedObjectStorage,
  type ObjectStorageBoundedGetInput,
} from "./object-storage.ts";

const TIMEWEB_S3_BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const MAX_PRESIGN_TTL_SECONDS = 300;

export interface S3StaticCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface TimewebS3ObjectStorageOptions {
  bucket: string;
  endpoint: string;
  region: string;
  credentials: S3StaticCredentials;
}

export interface S3ObjectStorageOptions {
  bucket: string;
  client: S3Client;
}

function requireNonBlank(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function parseTimewebEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("Timeweb S3 endpoint is invalid");
  }

  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
    throw new Error("Timeweb S3 endpoint must be an HTTPS origin without credentials or path");
  }

  return endpoint;
}

function assertBucketName(value: string): string {
  const bucket = requireNonBlank(value, "Timeweb S3 bucket");
  if (!TIMEWEB_S3_BUCKET_PATTERN.test(bucket)) {
    throw new Error("Timeweb S3 bucket name is invalid");
  }
  return bucket;
}

function isMissingObjectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "NoSuchKey" || candidate.name === "NotFound" || candidate.$metadata?.httpStatusCode === 404;
}

function requireNumber(value: number | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Timeweb S3 response is missing a valid ${label}`);
  }
  return value;
}

function requireDate(value: Date | undefined): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Timeweb S3 response is missing a valid last-modified timestamp");
  }
  return value;
}

function toStoredObject(input: {
  key: ObjectStorageKey;
  contentType: string | undefined;
  contentLength: number | undefined;
  sha256: string;
  etag: string | undefined;
  lastModifiedAt: Date | undefined;
}): ObjectStorageObject {
  return {
    key: input.key,
    contentType: input.contentType?.trim() || "application/octet-stream",
    contentLength: requireNumber(input.contentLength, "content length"),
    sha256: input.sha256,
    etag: input.etag ?? null,
    lastModifiedAt: requireDate(input.lastModifiedAt),
  };
}

/**
 * S3-compatible adapter for one already-authorized private Timeweb bucket.
 * It never creates, lists, deletes, or makes a bucket/object public.
 */
export class S3ObjectStorage implements ObjectStorage, StreamingObjectStorage, BoundedObjectStorage {
  private readonly bucket: string;
  private readonly client: S3Client;

  public constructor(options: S3ObjectStorageOptions) {
    this.bucket = assertBucketName(options.bucket);
    this.client = options.client;
  }

  public async put(input: ObjectStoragePutInput): Promise<ObjectStorageObject> {
    assertImmutableObjectStoragePut(input);
    const writtenAt = new Date();
    const response = await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }));

    return {
      key: input.key,
      contentType: input.contentType,
      contentLength: input.body.byteLength,
      sha256: input.sha256,
      etag: response.ETag ?? null,
      lastModifiedAt: writtenAt,
    };
  }

  public async get(key: ObjectStorageKey): Promise<ObjectStorageGetResult | null> {
    const expectedSha256 = getObjectStorageKeySha256(key);
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!response.Body) throw new Error("Timeweb S3 response is missing an object body");
      const body = await response.Body.transformToByteArray();
      const actualSha256 = calculateObjectSha256(body);
      if (actualSha256 !== expectedSha256) {
        throw new Error("Timeweb S3 object body does not match its immutable SHA-256 key");
      }
      return {
        ...toStoredObject({
          key,
          contentType: response.ContentType,
          contentLength: response.ContentLength,
          sha256: expectedSha256,
          etag: response.ETag,
          lastModifiedAt: response.LastModified,
        }),
        body,
      };
    } catch (error) {
      if (isMissingObjectError(error)) return null;
      throw error;
    }
  }

  public async getBounded(input: ObjectStorageBoundedGetInput): Promise<ObjectStorageGetResult | null> {
    const sha256 = getObjectStorageKeySha256(input.key);
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > MAX_STREAMING_OBJECT_BYTES) {
      throw new Error("OBJECT_STORAGE_READ_LIMIT_INVALID");
    }
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
    let body: (AsyncIterable<Uint8Array> & { destroy?(): unknown }) | undefined;
    const known = new Set(["OBJECT_STORAGE_READ_ABORTED", "OBJECT_STORAGE_READ_TOO_LARGE", "OBJECT_STORAGE_READ_METADATA_INVALID",
      "OBJECT_STORAGE_READ_LENGTH_MISMATCH", "OBJECT_STORAGE_READ_HASH_MISMATCH", "OBJECT_STORAGE_READ_STREAM_UNSUPPORTED"]);
    try {
      if (signal.aborted) throw new Error("OBJECT_STORAGE_READ_ABORTED");
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: input.key }), { abortSignal: signal });
      body = response.Body as typeof body;
      const declared = response.ContentLength;
      if (!Number.isSafeInteger(declared) || declared === undefined || declared < 0) throw new Error("OBJECT_STORAGE_READ_METADATA_INVALID");
      if (declared > input.maxBytes) throw new Error("OBJECT_STORAGE_READ_TOO_LARGE");
      if (!body || typeof body[Symbol.asyncIterator] !== "function" || typeof body.destroy !== "function") {
        throw new Error("OBJECT_STORAGE_READ_STREAM_UNSUPPORTED");
      }
      const iterator = body[Symbol.asyncIterator]();
      const output = Buffer.alloc(declared);
      const hash = createHash("sha256");
      let bytes = 0;
      while (true) {
        // Each iteration removes its abort listener; no shared unresolved race or per-chunk buffers.
        const next = await new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
          const onAbort = () => { signal.removeEventListener("abort", onAbort); reject(new Error("OBJECT_STORAGE_READ_ABORTED")); };
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) { onAbort(); return; }
          Promise.resolve().then(() => iterator.next()).then(
            (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
            (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); },
          );
        });
        if (next.done) break;
        if (!(next.value instanceof Uint8Array)) throw new Error("OBJECT_STORAGE_READ_STREAM_UNSUPPORTED");
        bytes += next.value.byteLength;
        if (bytes > input.maxBytes) throw new Error("OBJECT_STORAGE_READ_TOO_LARGE");
        if (bytes > declared) throw new Error("OBJECT_STORAGE_READ_LENGTH_MISMATCH");
        output.set(next.value, bytes - next.value.byteLength);
        hash.update(next.value);
      }
      if (bytes !== declared) throw new Error("OBJECT_STORAGE_READ_LENGTH_MISMATCH");
      if (hash.digest("hex") !== sha256) throw new Error("OBJECT_STORAGE_READ_HASH_MISMATCH");
      return { ...toStoredObject({ key: input.key, contentType: response.ContentType, contentLength: declared,
        sha256, etag: response.ETag, lastModifiedAt: response.LastModified }), body: output };
    } catch (error) {
      if (isMissingObjectError(error)) return null;
      if (error instanceof Error && known.has(error.message)) throw new Error(error.message);
      throw new Error("OBJECT_STORAGE_READ_FAILED");
    } finally {
      try { body?.destroy?.(); } catch { throw new Error("OBJECT_STORAGE_READ_FAILED"); }
    }
  }

  public async putStream(input: ObjectStorageStreamingPutInput): Promise<ObjectStorageObject> {
    if (!Number.isSafeInteger(input.contentLength) || input.contentLength < 0 || input.contentLength > MAX_STREAMING_OBJECT_BYTES
      || !input.contentType.trim() || getObjectStorageKeySha256(input.key) !== input.sha256) {
      throw new Error("OBJECT_STORAGE_STREAM_INPUT_INVALID");
    }
    const signal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000);
    // Validate content before any remote write; a declared key/head is not proof.
    const verifyBody = async function* () {
      const reader = addAbortSignal(signal, Readable.from(input.openBody(), { objectMode: false, highWaterMark: 64 * 1024 }));
      const hash = createHash("sha256");
      let bytes = 0;
      try {
        for await (const chunk of reader) {
          const value = chunk as Uint8Array;
          bytes += value.byteLength;
          if (bytes > input.contentLength) throw new Error("OBJECT_STORAGE_STREAM_LENGTH_MISMATCH");
          hash.update(value);
          yield value;
        }
        if (bytes !== input.contentLength || hash.digest("hex") !== input.sha256) {
          throw new Error("OBJECT_STORAGE_STREAM_INTEGRITY_MISMATCH");
        }
      } finally {
        reader.destroy();
      }
    };
    for await (const chunk of verifyBody()) void chunk;
    let uploadComplete = false;
    const upload = addAbortSignal(signal, Readable.from((async function* () {
      yield* verifyBody();
      uploadComplete = true;
    })(), { objectMode: false, highWaterMark: 64 * 1024 }));
    try {
      const result = await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: upload,
        ContentLength: input.contentLength,
        ContentType: input.contentType,
        ChecksumSHA256: Buffer.from(input.sha256, "hex").toString("base64"),
      }), { abortSignal: signal });
      if (!uploadComplete) throw new Error("OBJECT_STORAGE_STREAM_NOT_CONSUMED");
      return { key: input.key, contentType: input.contentType, contentLength: input.contentLength, sha256: input.sha256, etag: result.ETag ?? null, lastModifiedAt: new Date() };
    } finally {
      upload.destroy();
    }
  }

  public async head(key: ObjectStorageKey): Promise<ObjectStorageObject | null> {
    const sha256 = getObjectStorageKeySha256(key);
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return toStoredObject({
        key,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        sha256,
        etag: response.ETag,
        lastModifiedAt: response.LastModified,
      });
    } catch (error) {
      if (isMissingObjectError(error)) return null;
      throw error;
    }
  }

  public async presignGet(input: ObjectStoragePresignGetInput): Promise<ObjectStoragePresignedUrl> {
    if (!Number.isInteger(input.expiresInSeconds) || input.expiresInSeconds < 1 || input.expiresInSeconds > MAX_PRESIGN_TTL_SECONDS) {
      throw new Error(`Timeweb S3 presign TTL must be between 1 and ${MAX_PRESIGN_TTL_SECONDS} seconds`);
    }
    getObjectStorageKeySha256(input.key);

    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: input.key }),
      { expiresIn: input.expiresInSeconds },
    );
    return {
      url: new URL(url),
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000),
    };
  }
}

/**
 * Builds a path-style client for Timeweb's S3-compatible endpoint. Credentials
 * are supplied by the server-only secret resolver; this module does not read,
 * log, serialize, or expose them.
 */
export function createTimewebS3ObjectStorage(options: TimewebS3ObjectStorageOptions): S3ObjectStorage {
  const endpoint = parseTimewebEndpoint(options.endpoint);
  const region = requireNonBlank(options.region, "Timeweb S3 region");
  const accessKeyId = requireNonBlank(options.credentials.accessKeyId, "Timeweb S3 access key id");
  const secretAccessKey = requireNonBlank(options.credentials.secretAccessKey, "Timeweb S3 secret access key");

  return new S3ObjectStorage({
    bucket: options.bucket,
    client: new S3Client({
      endpoint: endpoint.origin,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
        ...(options.credentials.sessionToken ? { sessionToken: options.credentials.sessionToken } : {}),
      },
      forcePathStyle: true,
    }),
  });
}
