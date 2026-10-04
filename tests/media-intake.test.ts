import { describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "../src/platform/authorization/principal.ts";
import type { DatabaseTransaction } from "../src/platform/database/transaction.ts";
import {
  assertImmutableObjectStoragePut,
  type ObjectStorage,
  type ObjectStorageGetResult,
  type ObjectStorageObject,
  type ObjectStoragePresignedUrl,
  type ObjectStoragePutInput,
} from "../src/platform/storage/object-storage.ts";
import { createMediaIntakeService } from "../src/modules/media-assets/application/media-intake-service.ts";
import type { MediaAssetRepository, PersistMediaAssetInput } from "../src/modules/media-assets/application/ports/media-asset-repository.ts";
import { MAX_MEDIA_BYTES, type MediaAssetRecord } from "../src/modules/media-assets/contracts.ts";

const admin: PrincipalContext = { kind: "platform-admin", userId: "admin-1", correlationId: "corr-1" };
const body = new TextEncoder().encode("synthetic-media-fixture");

class MemoryStorage implements ObjectStorage {
  public readonly entries = new Map<string, ObjectStorageObject>();
  public readonly put = vi.fn(async (input: ObjectStoragePutInput) => {
    assertImmutableObjectStoragePut(input);
    const record = { key: input.key, contentType: input.contentType, contentLength: input.body.byteLength, sha256: input.sha256, etag: null, lastModifiedAt: new Date(0) };
    this.entries.set(input.key, record);
    return record;
  });
  public get = vi.fn(async (): Promise<ObjectStorageGetResult | null> => null);
  public head = vi.fn(async (key: string) => this.entries.get(key) ?? null);
  public presignGet = vi.fn(async (): Promise<ObjectStoragePresignedUrl> => ({ url: new URL("https://example.invalid/media"), expiresAt: new Date(0) }));
}

function createHarness() {
  const records = new Map<string, MediaAssetRecord>();
  const storage = new MemoryStorage();
  const repository: MediaAssetRepository = {
    projectExists: vi.fn(async (organizationId, projectId) => organizationId === "org-1" && projectId === "project-1"),
    findByDigest: vi.fn(async (projectId, sha256) => records.get(`${projectId}:${sha256}`) ?? null),
    upsert: vi.fn(async (input: PersistMediaAssetInput) => {
      const key = `${input.projectId}:${input.sha256}`;
      const record = records.get(key) ?? { id: "media-1", ...input, license: input.license ?? null };
      records.set(key, record);
      return record;
    }),
    appendAudit: vi.fn(async () => undefined),
  };
  const intake = createMediaIntakeService({
    storage,
    runInTransaction: async (_principal, execute) => execute({} as DatabaseTransaction),
    createRepository: () => repository,
  });
  return { intake, repository, storage };
}

const validInput = {
  organizationId: "org-1",
  projectId: "project-1",
  body,
  contentType: "image/png" as const,
  originalFileName: "fixture.png",
  rightsBasis: "LICENSED" as const,
  source: "synthetic-test",
  license: "test-license",
};

describe("media intake", () => {
  it("validates, hashes, stores and persists rights metadata", async () => {
    const { intake, repository, storage } = createHarness();
    const result = await intake(admin, validInput);

    expect(result.deduplicated).toBe(false);
    expect(result.asset).toMatchObject({ contentType: "image/png", byteSize: body.byteLength, rightsBasis: "LICENSED", source: "synthetic-test", license: "test-license" });
    expect(result.asset.storageKey).toMatch(/^media\/[a-f0-9]{64}$/);
    expect(storage.put).toHaveBeenCalledOnce();
    expect(repository.appendAudit).toHaveBeenCalledOnce();
  });

  it("deduplicates the same project digest without a second object write", async () => {
    const { intake, storage } = createHarness();
    await intake(admin, validInput);
    const second = await intake(admin, validInput);
    expect(second.deduplicated).toBe(true);
    expect(storage.put).toHaveBeenCalledOnce();
  });

  it("rejects unsafe type, missing licensed rights and a mismatched project before storage", async () => {
    const { intake, storage } = createHarness();
    await expect(intake(admin, { ...validInput, contentType: "text/html" as "image/png" })).rejects.toThrow();
    await expect(intake(admin, { ...validInput, body: new Uint8Array(MAX_MEDIA_BYTES + 1) })).rejects.toThrow("Media file exceeds");
    await expect(intake(admin, { ...validInput, license: null })).rejects.toThrow("Licensed media requires license metadata");
    await expect(intake(admin, { ...validInput, organizationId: "other-org" })).rejects.toThrow("MEDIA_PROJECT_NOT_FOUND");
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("rejects non-admin principals before touching storage", async () => {
    const { intake, storage } = createHarness();
    const member: PrincipalContext = { kind: "tenant-user", userId: "user-1", organizationId: "org-1", membershipId: "member-1", role: "ORG_ADMIN", projectIds: ["project-1"], correlationId: "corr-2" };
    await expect(intake(member, validInput)).rejects.toThrow("MEDIA_ADMIN_ACCESS_DENIED");
    expect(storage.put).not.toHaveBeenCalled();
  });
});
