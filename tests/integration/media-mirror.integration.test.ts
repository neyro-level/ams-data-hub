import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMediaMirrorService } from "../../src/modules/media-assets/application/media-mirror-service.ts";
import { PrismaMediaMirrorRepository } from "../../src/modules/media-assets/infrastructure/prisma-media-mirror-repository.ts";
import { sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import {
  assertImmutableObjectStoragePut,
  type ObjectStorage,
  type ObjectStorageGetResult,
  type ObjectStorageObject,
  type ObjectStoragePresignedUrl,
  type ObjectStoragePutInput,
} from "../../src/platform/storage/object-storage.ts";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

class MemoryStorage implements ObjectStorage {
  private readonly entries = new Map<string, ObjectStorageObject>();
  public readonly put = vi.fn(async (input: ObjectStoragePutInput) => {
    assertImmutableObjectStoragePut(input);
    const value = { key: input.key, contentType: input.contentType, contentLength: input.body.byteLength, sha256: input.sha256, etag: null, lastModifiedAt: new Date(0) };
    this.entries.set(input.key, value);
    return value;
  });
  public get = vi.fn(async (): Promise<ObjectStorageGetResult | null> => null);
  public head = vi.fn(async (key: string) => this.entries.get(key) ?? null);
  public presignGet = vi.fn(async (): Promise<ObjectStoragePresignedUrl> => ({ url: new URL("https://media.example.invalid/object"), expiresAt: new Date(0) }));
}

function admin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `media-admin-${randomUUID()}`, correlationId: randomUUID() };
}

describe("media mirror persistence", () => {
  it("persists independent warnings, digest dedupe and a consent-gated agent photo", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const scope = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Media Org ${suffix}`, slug: `media-org-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Media Project ${suffix}`, slug: `media-project-${suffix}` } });
      await transaction.agent.create({
        data: {
          uid: `01JMEDIA${suffix.toUpperCase()}0000000000`.slice(0, 26),
          organizationId: organization.id,
          projectId: project.id,
          slug: `agent-${suffix}`,
          origin: "FEED",
          fullName: "Синтетический Агент",
          showOnSite: true,
          status: "ACTIVE",
        },
      });
      return { organizationId: organization.id, projectId: project.id };
    });
    const credential = `SYNTHETIC_MEDIA_ENDPOINT_${suffix.toUpperCase()}`;
    process.env[credential] = "https://feed.example.invalid/synthetic.xml";
    try {
      const source = await sourceRegistryCommands.createSource(principal, {
        ...scope,
        sourceKey: `media-${suffix}`,
        name: "Synthetic media source",
        endpointCredentialRef: credential,
        adapterKey: "yrl-realty-2010",
        adapterVersion: "1.0.0",
        profileKey: "vladis-vt24-v1",
        profileVersion: "1.0.0",
        datasetType: "MIXED_REALTY",
        transportType: "HTTPS_XML",
        sharingPolicy: "PROJECT_ONLY",
        schedulePolicy: { mode: "MANUAL_ONLY" },
        safetyPolicyId: "",
        expectedNamespace: "",
        expectedProducer: "",
      });
      const storage = new MemoryStorage();
      const mirror = createMediaMirrorService({
        storage,
        fetchMedia: async (url) => {
          if (url.includes("missing")) throw Object.assign(new Error("missing"), { code: "HTTP_STATUS_DENIED" });
          return { status: 200, contentType: "image/png", body: png, finalUrl: new URL(url) };
        },
        runInTransaction: runInPrincipalDatabaseTransaction,
        createRepository: (transaction) => new PrismaMediaMirrorRepository(transaction),
      });
      const agent = await runInPrincipalDatabaseTransaction(principal, (transaction) => transaction.agent.findFirstOrThrow({ where: scope }));
      const result = await mirror(createProjectJobPrincipal({ jobName: "media-mirror-test", ...scope }), {
        ...scope,
        sourceId: source.sourceId,
        sourceRevisionId: "revision-1",
        observedAt: "2026-10-05T00:00:00.000Z",
        items: [
          { sourceUrl: "https://media.example.invalid/listing-a.png?one=1", entityType: "INVENTORY", entityUid: "listing-1", kind: "LISTING_IMAGE", position: 0, rightsBasis: "LICENSED", license: "synthetic-feed" },
          { sourceUrl: "https://media.example.invalid/listing-b.png?two=2", entityType: "INVENTORY", entityUid: "listing-1", kind: "LISTING_IMAGE", position: 1, rightsBasis: "LICENSED", license: "synthetic-feed" },
          { sourceUrl: "https://media.example.invalid/missing.png", entityType: "INVENTORY", entityUid: "listing-1", kind: "LISTING_IMAGE", position: 2, rightsBasis: "LICENSED", license: "synthetic-feed" },
          { sourceUrl: "https://media.example.invalid/agent.png", entityType: "AGENT", entityUid: agent.uid, kind: "AGENT_PHOTO", position: 0, rightsBasis: "LICENSED", license: "synthetic-feed" },
        ],
      });
      expect(result).toMatchObject({ importStatus: "UNCHANGED", mediaStatus: "WARNING" });
      expect(result.items.at(-1)).toMatchObject({ kind: "AGENT_PHOTO", publiclyPublishable: false });
      const persisted = await runInPrincipalDatabaseTransaction(principal, async (transaction) => ({
        assetCount: await transaction.mediaAsset.count({ where: scope }),
        sources: await transaction.mediaSource.findMany({ where: { ...scope, sourceId: source.sourceId }, orderBy: { position: "asc" } }),
      }));
      expect(persisted.assetCount).toBe(1);
      expect(persisted.sources).toHaveLength(4);
      expect(persisted.sources.filter((item) => item.status === "WARNING")).toHaveLength(1);
      expect(persisted.sources.find((item) => item.kind === "AGENT_PHOTO")?.assetId).not.toBeNull();
      expect(storage.put).toHaveBeenCalledOnce();
    } finally {
      delete process.env[credential];
    }
  });
});
