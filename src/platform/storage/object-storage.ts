import "server-only";

import { createHash } from "node:crypto";

export const OBJECT_STORAGE_PREFIXES = [
  "source-artifacts",
  "snapshots",
  "media",
  "exports",
  "backups",
] as const;

export type ObjectStoragePrefix = (typeof OBJECT_STORAGE_PREFIXES)[number];
export type ObjectStorageKey = string;

export interface ObjectStorageObject {
  key: ObjectStorageKey;
  contentType: string;
  contentLength: number;
  sha256: string;
  etag: string | null;
  lastModifiedAt: Date;
}

export interface ObjectStoragePutInput {
  key: ObjectStorageKey;
  body: Uint8Array;
  contentType: string;
  sha256: string;
  signal?: AbortSignal;
}

export interface ObjectStorageHeadOptions { signal?: AbortSignal }

export interface ObjectStorageGetResult extends ObjectStorageObject {
  body: Uint8Array;
}

export const MAX_STREAMING_OBJECT_BYTES = 256 * 1024 * 1024;

export interface ObjectStorageStreamingPutInput {
  key: ObjectStorageKey;
  contentType: string;
  contentLength: number;
  sha256: string;
  /** A fresh, bounded reader for each verification/upload pass. */
  openBody(): AsyncIterable<Uint8Array>;
  signal?: AbortSignal;
}

/** Separate capability: buffered media/snapshot consumers remain compatible. */
export interface StreamingObjectStorage {
  putStream(input: ObjectStorageStreamingPutInput): Promise<ObjectStorageObject>;
}

export interface ObjectStorageBoundedGetInput {
  key: ObjectStorageKey;
  maxBytes: number;
  signal?: AbortSignal;
}
/** Explicit bounded read capability; consumers must not fall back to get(). */
export interface BoundedObjectStorage {
  getBounded(input: ObjectStorageBoundedGetInput): Promise<ObjectStorageGetResult | null>;
}

export interface ObjectStoragePresignGetInput {
  key: ObjectStorageKey;
  expiresInSeconds: number;
}

export interface ObjectStoragePresignedUrl {
  url: URL;
  expiresAt: Date;
}

/**
 * Server-owned port for S3-compatible adapters. Implementations must not turn
 * a storage key into a public URL; callers receive temporary URLs only through
 * `presignGet` after their own resource authorization has passed.
 */
export interface ObjectStorage {
  put(input: ObjectStoragePutInput): Promise<ObjectStorageObject>;
  get(key: ObjectStorageKey): Promise<ObjectStorageGetResult | null>;
  head(key: ObjectStorageKey, options?: ObjectStorageHeadOptions): Promise<ObjectStorageObject | null>;
  presignGet(input: ObjectStoragePresignGetInput): Promise<ObjectStoragePresignedUrl>;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

function assertSha256(value: string): asserts value is string {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error("Object storage SHA-256 must be a lowercase 64-character hexadecimal digest");
  }
}

function assertSafeSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT_PATTERN.test(value)) {
    throw new Error(`${label} contains an unsafe storage path segment`);
  }
}

function createContentAddressedKey(prefix: Exclude<ObjectStoragePrefix, "snapshots">, sha256: string): ObjectStorageKey {
  assertSha256(sha256);
  return `${prefix}/${sha256}`;
}

export function createSourceArtifactKey(sha256: string): ObjectStorageKey {
  return createContentAddressedKey("source-artifacts", sha256);
}

export function createMediaKey(sha256: string): ObjectStorageKey {
  return createContentAddressedKey("media", sha256);
}

export function createExportKey(sha256: string): ObjectStorageKey {
  return createContentAddressedKey("exports", sha256);
}

export function createBackupKey(sha256: string): ObjectStorageKey {
  return createContentAddressedKey("backups", sha256);
}

export function createProjectSnapshotKey(projectId: string, sha256: string): ObjectStorageKey {
  assertSafeSegment(projectId, "Project id");
  assertSha256(sha256);
  return `snapshots/${projectId}/${sha256}`;
}

export function getProjectIdFromSnapshotKey(key: ObjectStorageKey): string | null {
  const match = /^snapshots\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\/([a-f0-9]{64})$/.exec(key);
  return match?.[1] ?? null;
}

export function getObjectStorageKeySha256(key: ObjectStorageKey): string {
  const parts = key.split("/");
  const [prefix, maybeProjectId, maybeDigest] = parts;
  const isContentAddressed = parts.length === 2 && prefix !== "snapshots" && OBJECT_STORAGE_PREFIXES.includes(prefix as ObjectStoragePrefix);
  const isSnapshot = parts.length === 3 && prefix === "snapshots" && typeof maybeProjectId === "string";
  const digest = isSnapshot ? maybeDigest : maybeProjectId;

  if (!isContentAddressed && !isSnapshot) {
    throw new Error("Object storage key does not use an approved immutable namespace");
  }
  if (isSnapshot) assertSafeSegment(maybeProjectId, "Project id");
  if (!digest) throw new Error("Object storage key is missing its SHA-256 digest");
  assertSha256(digest);
  return digest;
}

export function calculateObjectSha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

export function assertImmutableObjectStoragePut(input: ObjectStoragePutInput): void {
  assertSha256(input.sha256);

  if (calculateObjectSha256(input.body) !== input.sha256) {
    throw new Error("Object storage body does not match the declared SHA-256 digest");
  }

  if (getObjectStorageKeySha256(input.key) !== input.sha256) {
    throw new Error("Object storage key must end with the declared SHA-256 digest");
  }

  if (!input.contentType.trim()) {
    throw new Error("Object storage content type is required");
  }
}

/**
 * Bounds the application-side snapshot path to a single project. This is a
 * second boundary alongside the provider-side per-project bucket credential;
 * it is intentionally not a substitute for that credential restriction.
 */
export class ProjectSnapshotStorage {
  public constructor(
    private readonly projectId: string,
    private readonly storage: ObjectStorage,
  ) {
    assertSafeSegment(projectId, "Project id");
  }

  public put(input: Omit<ObjectStoragePutInput, "key">): Promise<ObjectStorageObject> {
    return this.storage.put({
      ...input,
      key: createProjectSnapshotKey(this.projectId, input.sha256),
    });
  }

  public get(key: ObjectStorageKey): Promise<ObjectStorageGetResult | null> {
    this.assertProjectKey(key);
    return this.storage.get(key);
  }

  public head(key: ObjectStorageKey, options?: ObjectStorageHeadOptions): Promise<ObjectStorageObject | null> {
    this.assertProjectKey(key);
    return options ? this.storage.head(key, options) : this.storage.head(key);
  }

  public presignGet(input: ObjectStoragePresignGetInput): Promise<ObjectStoragePresignedUrl> {
    this.assertProjectKey(input.key);
    return this.storage.presignGet(input);
  }

  private assertProjectKey(key: ObjectStorageKey): void {
    if (getProjectIdFromSnapshotKey(key) !== this.projectId) {
      throw new Error("Project snapshot storage denied access outside the project scope");
    }
  }
}
