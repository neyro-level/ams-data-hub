import { describe, expect, it } from "vitest";
import {
  ProjectSnapshotStorage,
  assertImmutableObjectStoragePut,
  calculateObjectSha256,
  createBackupKey,
  createExportKey,
  createMediaKey,
  createProjectSnapshotKey,
  createSourceArtifactKey,
  type ObjectStorage,
  type ObjectStorageGetResult,
  type ObjectStorageObject,
  type ObjectStoragePresignGetInput,
  type ObjectStoragePresignedUrl,
  type ObjectStoragePutInput,
} from "../src/platform/storage/object-storage.ts";

const body = new TextEncoder().encode("AMS Data Hub immutable object");
const sha256 = calculateObjectSha256(body);

class MemoryObjectStorage implements ObjectStorage {
  private readonly entries = new Map<string, ObjectStorageGetResult>();

  public async put(input: ObjectStoragePutInput): Promise<ObjectStorageObject> {
    assertImmutableObjectStoragePut(input);
    const entry: ObjectStorageGetResult = {
      key: input.key,
      body: input.body,
      contentType: input.contentType,
      contentLength: input.body.byteLength,
      sha256: input.sha256,
      etag: null,
      lastModifiedAt: new Date("2026-10-03T00:00:00.000Z"),
    };
    this.entries.set(input.key, entry);
    return entry;
  }

  public async get(key: string): Promise<ObjectStorageGetResult | null> {
    return this.entries.get(key) ?? null;
  }

  public async head(key: string): Promise<ObjectStorageObject | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    return {
      key: entry.key,
      contentType: entry.contentType,
      contentLength: entry.contentLength,
      sha256: entry.sha256,
      etag: entry.etag,
      lastModifiedAt: entry.lastModifiedAt,
    };
  }

  public async presignGet(input: ObjectStoragePresignGetInput): Promise<ObjectStoragePresignedUrl> {
    return {
      url: new URL(`https://storage.example.test/${input.key}`),
      expiresAt: new Date("2026-10-03T00:05:00.000Z"),
    };
  }
}

describe("ObjectStorage immutable keys", () => {
  it("creates the approved key prefixes and content-addressed immutable keys", () => {
    expect(createSourceArtifactKey(sha256)).toBe(`source-artifacts/${sha256}`);
    expect(createProjectSnapshotKey("project_A", sha256)).toBe(`snapshots/project_A/${sha256}`);
    expect(createMediaKey(sha256)).toBe(`media/${sha256}`);
    expect(createExportKey(sha256)).toBe(`exports/${sha256}`);
    expect(createBackupKey(sha256)).toBe(`backups/${sha256}`);
  });

  it("rejects a declared digest that differs from the object body or key", () => {
    expect(() => assertImmutableObjectStoragePut({
      key: createMediaKey(sha256),
      body,
      contentType: "text/plain",
      sha256: "0".repeat(64),
    })).toThrow("body does not match");

    expect(() => assertImmutableObjectStoragePut({
      key: createMediaKey(sha256),
      body,
      contentType: "text/plain",
      sha256,
    })).not.toThrow();
  });
});

describe("ProjectSnapshotStorage", () => {
  it("denies project A before it can read, inspect, or presign project B's snapshot key", async () => {
    const storage = new MemoryObjectStorage();
    const projectA = new ProjectSnapshotStorage("project_A", storage);
    const projectB = new ProjectSnapshotStorage("project_B", storage);
    const projectBKey = createProjectSnapshotKey("project_B", sha256);

    await projectB.put({ body, contentType: "application/json", sha256 });

    expect(() => projectA.get(projectBKey)).toThrow("denied access outside the project scope");
    expect(() => projectA.head(projectBKey)).toThrow("denied access outside the project scope");
    expect(() => projectA.presignGet({ key: projectBKey, expiresInSeconds: 60 })).toThrow("denied access outside the project scope");
    await expect(projectB.get(projectBKey)).resolves.toMatchObject({ key: projectBKey, sha256 });
  });
});
