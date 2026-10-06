import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
const gateway = vi.hoisted(() => ({ feed: vi.fn(), media: vi.fn() }));
vi.mock("../../src/platform/http/safe-outbound.ts", async (original) => ({
  ...await original<typeof import("../../src/platform/http/safe-outbound.ts")>(),
  safeOutboundStream: gateway.feed, safeOutboundBuffered: gateway.media,
}));
import { createSourceExecutionServer, createInventoryPublicProjectionServer, sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import { serializePublicDto } from "@ams-data-hub/data-contracts";
import { syntheticCanonicalInventory } from "../fixtures/canonical-inventory.ts";
import { createMediaAssetsServer } from "../../src/modules/media-assets/server.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import type { PlatformAdminPrincipal, PrincipalContext } from "../../src/platform/authorization/principal.ts";
import * as database from "../../src/platform/database/transaction.ts";
import { runInPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import { assertImmutableObjectStoragePut, type ObjectStorage, type StreamingObjectStorage,
  type ObjectStorageGetResult, type ObjectStorageObject, type ObjectStoragePutInput, type ObjectStorageStreamingPutInput,
  type ObjectStoragePresignedUrl } from "../../src/platform/storage/object-storage.ts";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
class MemoryStorage implements ObjectStorage, StreamingObjectStorage {
  readonly entries = new Map<string, ObjectStorageGetResult>();
  public async put(input: ObjectStoragePutInput): Promise<ObjectStorageObject> {
    assertImmutableObjectStoragePut(input);
    const object = { ...input, contentLength: input.body.byteLength, etag: null, lastModifiedAt: new Date(0) };
    this.entries.set(input.key, object); return object;
  }
  public async putStream(input: ObjectStorageStreamingPutInput) {
    const chunks: Uint8Array[] = []; for await (const chunk of input.openBody()) chunks.push(chunk);
    return this.put({ ...input, body: Buffer.concat(chunks) });
  }
  public async get(key: string) { return this.entries.get(key) ?? null; }
  public readonly head = vi.fn(async (key: string) => this.entries.get(key) ?? null);
  public async presignGet(): Promise<ObjectStoragePresignedUrl> { throw new Error("SYNTHETIC_PRESIGN_NOT_USED"); }
}

describe("persisted GOOD inventory mirrored media public facade", () => {
  it("projects only scoped current GOOD members with a non-bypass worker and no producer fallback", async () => {
    const suffix = randomUUID().slice(0, 8);
    const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-media-admin", correlationId: randomUUID() };
    const scope = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const org = await tx.organization.create({ data: { name: "Synthetic media", slug: `projection-${suffix}` } });
      const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic media", slug: `projection-${suffix}` } });
      await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
        update: { jobsFrozen: false, unfrozenAt: new Date() } });
      return { organizationId: org.id, projectId: project.id };
    });
    const reference = `SYNTHETIC_PROJECTION_${suffix.toUpperCase()}`;
    process.env[reference] = "https://feed.example.invalid/synthetic.xml";
    let role: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const created = await sourceRegistryCommands.createSource(admin, { ...scope, sourceKey: "synthetic", name: "Synthetic",
        endpointCredentialRef: reference, adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "default-v1", profileVersion: "1.0.0",
        datasetType: "MIXED_REALTY", transportType: "HTTPS_XML", sharingPolicy: "PROJECT_ONLY", schedulePolicy: { mode: "MANUAL_ONLY" },
        safetyPolicyId: "", expectedNamespace: "", expectedProducer: "" });
      const target = { ...scope, sourceId: created.sourceId };
      await sourceRegistryCommands.setSourceEnabled(admin, { ...target, version: created.version, enabled: true });
      const storage = new MemoryStorage(); const runtime = createSourceExecutionServer(storage); const media = createMediaAssetsServer(storage);
      const provide = (images: string[]) => {
        const bytes = new TextEncoder().encode(`<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06"><offer internal-id="one"><category>квартира</category><type>продажа</type><price><value>1000</value></price>${images.map((url) => `<picture>${url}</picture>`).join("")}</offer></realty-feed>`);
        gateway.feed.mockResolvedValue({ status: 200, contentType: "application/xml", contentLength: bytes.byteLength,
          finalUrl: new URL(process.env[reference]!), body: (async function* () { yield bytes; })(), close: vi.fn() });
      };
      const a = "https://producer.example.invalid/a.png"; const b = "https://producer.example.invalid/b.png";
      provide([a, b]); expect(await runtime.run(target)).toMatchObject({ state: "GOOD" });
      const read = () => runInPrincipalDatabaseTransaction(admin, async (tx) => ({
        source: await tx.source.findUniqueOrThrow({ where: { id: target.sourceId } }),
        identity: await tx.inventoryIdentity.findFirstOrThrow({ where: target }),
      }));
      const first = await read(); const job = createProjectJobPrincipal({ ...scope, jobName: "synthetic-snapshot" });
      gateway.media.mockImplementation(async (url: string) => ({ status: 200, contentType: "image/png", body: png, finalUrl: new URL(url) }));
      const mirror = (revision: string, urls: string[]) => media.mirrorMediaBatch(job, { ...target, sourceRevisionId: revision,
        observedAt: new Date().toISOString(), items: urls.map((sourceUrl, position) => ({ sourceUrl, position, entityType: "INVENTORY",
          entityUid: first.identity.uid, kind: "LISTING_IMAGE" as const, rightsBasis: "LICENSED" as const, license: "synthetic" })) });
      await mirror(first.source.lastGoodRevisionId!, [a, b]);
      const input = { ...target, sourceRevisionId: first.source.lastGoodRevisionId!, inventoryUid: first.identity.uid, expectedRecordHash: first.identity.normalizedHash };
      expect((await media.projectInventoryMedia(job, input)).media).toHaveLength(2);
      provide([a]); expect(await runtime.run(target)).toMatchObject({ state: "GOOD" }); const second = await read();
      gateway.media.mockRejectedValue(new Error("PRODUCER_OFF"));
      expect(await mirror(second.source.lastGoodRevisionId!, [a])).toMatchObject({ mediaStatus: "WARNING" });
      const currentInput = { ...input, sourceRevisionId: second.source.lastGoodRevisionId!, expectedRecordHash: second.identity.normalizedHash };
      // Malicious/stale relation claims the new revision without persisted membership.
      await runInPrincipalDatabaseTransaction(admin, (tx) => tx.mediaSource.updateMany({
        where: { ...target, canonicalSourceUrl: b }, data: { sourceRevisionId: currentInput.sourceRevisionId } }));
      const outboundCount = gateway.media.mock.calls.length;
      const original = database.runInPrincipalDatabaseTransaction;
      let workerTransactions = 0;
      role = vi.spyOn(database, "runInPrincipalDatabaseTransaction").mockImplementation(async <T>(principal: PrincipalContext,
        execute: (tx: DatabaseTransaction) => Promise<T>) => original(principal, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user")).toEqual([{ rolbypassrls: false }]);
        workerTransactions++; return execute(tx);
      }));
      const workerMedia = createMediaAssetsServer(storage);
      const projected = await workerMedia.projectInventoryMedia(job, currentInput);
      expect(projected.media).toHaveLength(1); expect(projected.media[0]).toMatchObject({ kind: "IMAGE", position: 0 });
      expect(projected.warnings).toEqual(["MEDIA_MIRROR_WARNING"]);
      expect(JSON.stringify(projected)).not.toMatch(/https:|sourceUrl|storageKey|originalFileName/u);
      expect(gateway.media).toHaveBeenCalledTimes(outboundCount); expect(workerTransactions).toBe(2);
      const canonical = syntheticCanonicalInventory({ ...target, uid: second.identity.uid, normalizedHash: second.identity.normalizedHash,
        sourceHash: second.identity.sourceHash, media: [{ sourceUrl: a, position: 0 }] });
      const publicProjection = await createInventoryPublicProjectionServer(storage)(job, { entity: canonical, sourceRevisionId: currentInput.sourceRevisionId });
      expect(JSON.parse(serializePublicDto(publicProjection.inventory)).media).toEqual(projected.media);
      expect(publicProjection.warnings).toEqual(["MEDIA_MIRROR_WARNING"]);
      storage.head.mockClear();
      await expect(workerMedia.projectInventoryMedia(job, { ...currentInput, expectedRecordHash: first.identity.normalizedHash }))
        .rejects.toThrow("MEDIA_PROJECTION_REVISION_NOT_FOUND");
      expect(storage.head).not.toHaveBeenCalled();
      await expect(workerMedia.projectInventoryMedia(job, input)).rejects.toThrow("MEDIA_PROJECTION_REVISION_NOT_FOUND");
      const reader = createProjectJobPrincipal({ ...scope, jobName: "media-projection" });
      await database.runInPrincipalDatabaseTransaction(reader, async (tx) => {
        expect(await tx.sourceRevisionRecord.count({ where: { ...target, revisionId: currentInput.sourceRevisionId } })).toBe(1);
        expect((await tx.sourceRevisionRecord.updateMany({ where: { ...target, revisionId: currentInput.sourceRevisionId },
          data: { recordHash: "f".repeat(64) } })).count).toBe(0);
        expect((await tx.sourceRevision.updateMany({ where: { id: currentInput.sourceRevisionId }, data: { failureCode: "TEST_DENIED" } })).count).toBe(0);
      });
      role.mockRestore(); role = undefined;
      // Current relation points at another project's object: deny before HEAD.
      const foreignProjectId = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        const foreign = await tx.project.create({ data: { organizationId: scope.organizationId, name: "Other", slug: `other-${suffix}` } });
        const asset = await tx.mediaAsset.findFirstOrThrow({ where: scope });
        const foreignAsset = await tx.mediaAsset.create({ data: { organizationId: scope.organizationId, projectId: foreign.id, sha256: asset.sha256,
          storageKey: asset.storageKey, contentType: asset.contentType, byteSize: asset.byteSize, originalFileName: "synthetic.png",
          rightsBasis: "OWNED", source: "synthetic", uploadedBy: "synthetic" } });
        await tx.mediaSource.updateMany({ where: { ...target, canonicalSourceUrl: a }, data: { assetId: foreignAsset.id } });
        return foreign.id;
      });
      storage.head.mockClear();
      expect((await media.projectInventoryMedia(job, currentInput)).media).toEqual([]); expect(storage.head).not.toHaveBeenCalled();
      const foreignReader = createProjectJobPrincipal({ organizationId: scope.organizationId, projectId: foreignProjectId, jobName: "media-projection" });
      await runInPrincipalDatabaseTransaction(foreignReader, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.sourceRevisionRecord.count({ where: target })).toBe(0);
        expect(await tx.sourceRevision.count({ where: target })).toBe(0);
        expect(await tx.mediaAsset.count({ where: scope })).toBe(0);
        expect(await tx.mediaSource.count({ where: target })).toBe(0);
      });
    } finally { role?.mockRestore(); delete process.env[reference]; gateway.feed.mockReset(); gateway.media.mockReset(); }
  });
});
