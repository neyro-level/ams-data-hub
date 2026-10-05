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
import { createMediaMirrorService } from "../src/modules/media-assets/application/media-mirror-service.ts";
import type {
  MediaMirrorRepository,
  PersistMediaWarningInput,
  PersistMirroredAssetInput,
} from "../src/modules/media-assets/application/ports/media-mirror-repository.ts";

const principal: PrincipalContext = {
  kind: "project-job",
  jobName: "synthetic-media-mirror",
  organizationId: "org-1",
  projectId: "project-1",
  correlationId: "corr-1",
};

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

class MemoryStorage implements ObjectStorage {
  public readonly entries = new Map<string, ObjectStorageObject>();
  public readonly put = vi.fn(async (input: ObjectStoragePutInput) => {
    assertImmutableObjectStoragePut(input);
    const object = { key: input.key, contentType: input.contentType, contentLength: input.body.byteLength, sha256: input.sha256, etag: null, lastModifiedAt: new Date(0) };
    this.entries.set(input.key, object);
    return object;
  });
  public get = vi.fn(async (): Promise<ObjectStorageGetResult | null> => null);
  public head = vi.fn(async (key: string) => this.entries.get(key) ?? null);
  public presignGet = vi.fn(async (): Promise<ObjectStoragePresignedUrl> => ({ url: new URL("https://media.example.invalid/object"), expiresAt: new Date(0) }));
}

function harness() {
  const storage = new MemoryStorage();
  const assets = new Map<string, string>();
  const sources = new Map<string, { assetId: string | null }>();
  const mirrored: PersistMirroredAssetInput[] = [];
  const warnings: PersistMediaWarningInput[] = [];
  const repository: MediaMirrorRepository = {
    scopeExists: vi.fn(async () => true),
    persistMirrored: vi.fn(async (input) => {
      mirrored.push(input);
      const assetId = assets.get(input.sha256) ?? `asset-${assets.size + 1}`;
      assets.set(input.sha256, assetId);
      sources.set(input.canonicalSourceUrl, { assetId });
      return {
        assetId,
        agent: input.kind === "AGENT_PHOTO" ? {
          status: "ACTIVE" as const,
          showOnSite: input.entityUid === "agent-consented",
          consentConfirmedAt: input.entityUid === "agent-consented" ? new Date(0) : null,
        } : null,
      };
    }),
    persistWarning: vi.fn(async (input) => {
      warnings.push(input);
      return { assetId: sources.get(input.canonicalSourceUrl)?.assetId ?? null, agent: null };
    }),
  };
  const fetchMedia = vi.fn(async (url: string) => {
    if (url.includes("missing")) throw Object.assign(new Error("not found"), { code: "HTTP_STATUS_DENIED" });
    if (url.includes("html")) return { status: 200, contentType: "image/png", body: new TextEncoder().encode("<html>"), finalUrl: new URL(url) };
    return { status: 200, contentType: "image/png; charset=binary", body: png, finalUrl: new URL(url) };
  });
  const mirror = createMediaMirrorService({
    storage,
    fetchMedia,
    runInTransaction: async (_actor, execute) => execute({} as DatabaseTransaction),
    createRepository: () => repository,
  });
  return { mirror, mirrored, warnings, storage };
}

const base = {
  organizationId: "org-1",
  projectId: "project-1",
  sourceId: "source-1",
  sourceRevisionId: "revision-1",
  observedAt: "2026-10-05T00:00:00.000Z",
};

describe("safe media mirror", () => {
  it("deduplicates bytes across query variants and preserves protected source order", async () => {
    const { mirror, mirrored, storage } = harness();
    const result = await mirror(principal, {
      ...base,
      items: [
        { sourceUrl: "https://media.example.invalid/photo.png?size=large", entityType: "INVENTORY", entityUid: "listing-1", kind: "LISTING_IMAGE", position: 0, isImageOrderChangeAllowed: false, rightsBasis: "LICENSED", license: "synthetic-feed" },
        { sourceUrl: "https://media.example.invalid/photo.png?size=small", entityType: "INVENTORY", entityUid: "listing-1", kind: "LISTING_IMAGE", position: 1, isImageOrderChangeAllowed: false, rightsBasis: "LICENSED", license: "synthetic-feed" },
      ],
    });
    expect(result).toMatchObject({ importStatus: "UNCHANGED", mediaStatus: "COMPLETE" });
    expect(result.items.map((item) => item.position)).toEqual([0, 1]);
    expect(result.items[0]!.canonicalSourceUrl).toBe(result.items[1]!.canonicalSourceUrl);
    expect(result.items[0]!.assetId).toBe(result.items[1]!.assetId);
    expect(mirrored.every((item) => item.isImageOrderChangeAllowed === false)).toBe(true);
    expect(storage.put).toHaveBeenCalledOnce();
  });

  it("keeps one unavailable or invalid image as a media warning without failing import", async () => {
    const { mirror, warnings } = harness();
    const result = await mirror(principal, {
      ...base,
      items: [
        { sourceUrl: "https://media.example.invalid/ok.png", entityType: "INVENTORY", entityUid: "listing-1", kind: "LISTING_IMAGE", position: 0, rightsBasis: "LICENSED", license: "synthetic-feed" },
        { sourceUrl: "https://media.example.invalid/missing.png", entityType: "INVENTORY", entityUid: "listing-1", kind: "LISTING_IMAGE", position: 1, rightsBasis: "LICENSED", license: "synthetic-feed" },
        { sourceUrl: "https://media.example.invalid/html.png", entityType: "INVENTORY", entityUid: "listing-1", kind: "LISTING_IMAGE", position: 2, rightsBasis: "LICENSED", license: "synthetic-feed" },
      ],
    });
    expect(result.importStatus).toBe("UNCHANGED");
    expect(result.mediaStatus).toBe("WARNING");
    expect(result.items.map((item) => item.status)).toEqual(["MIRRORED", "WARNING", "WARNING"]);
    expect(warnings.map((item) => item.warningCode)).toEqual(["OUTBOUND_HTTP_STATUS_DENIED", "MEDIA_IMAGE_DECODE_REJECTED"]);
  });

  it("mirrors agent photos but gates public use on active explicit consent", async () => {
    const { mirror } = harness();
    const result = await mirror(principal, {
      ...base,
      items: [
        { sourceUrl: "https://media.example.invalid/one.png", entityType: "AGENT", entityUid: "agent-private", kind: "AGENT_PHOTO", position: 0, rightsBasis: "LICENSED", license: "synthetic-feed" },
        { sourceUrl: "https://media.example.invalid/two.png", entityType: "AGENT", entityUid: "agent-consented", kind: "AGENT_PHOTO", position: 0, rightsBasis: "LICENSED", license: "synthetic-feed" },
      ],
    });
    expect(result.items.map((item) => item.publiclyPublishable)).toEqual([false, true]);
  });

  it("rejects any caller outside the exact project-job scope before network access", async () => {
    const { mirror } = harness();
    const foreign = { ...principal, projectId: "other-project" } as PrincipalContext;
    await expect(mirror(foreign, { ...base, items: [] })).rejects.toThrow("MEDIA_MIRROR_PROJECT_JOB_REQUIRED");
  });
});
