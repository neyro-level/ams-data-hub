import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
const gateway = vi.hoisted(() => ({ feed: vi.fn(), media: vi.fn() }));
vi.mock("../../src/platform/http/safe-outbound.ts", async (original) => ({
  ...await original<typeof import("../../src/platform/http/safe-outbound.ts")>(),
  safeOutboundStream: gateway.feed, safeOutboundBuffered: gateway.media,
}));
import { createSourceExecutionServer, createInventoryPublicProjectionServer, sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import { serializePublicDto } from "@ams-data-hub/data-contracts";
import { composeSnapshot, SNAPSHOT_DATASET_KINDS } from "../../src/modules/snapshot-delivery/index.ts";
import { syntheticCanonicalInventory } from "../fixtures/canonical-inventory.ts";
import { createMediaAssetsServer } from "../../src/modules/media-assets/server.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import type { PlatformAdminPrincipal, PrincipalContext } from "../../src/platform/authorization/principal.ts";
import * as database from "../../src/platform/database/transaction.ts";
import { runInPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import { S3ObjectStorage } from "../../src/platform/storage/timeweb-s3-object-storage.ts";
import { calculateObjectSha256 } from "../../src/platform/storage/object-storage.ts";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
function syntheticS3() {
  const client = new S3Client({ region: "ru-1", credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" } });
  const entries = new Map<string, { body: Uint8Array; contentType: string }>();
  // Only the SDK transport is replaced: immutable keys, hashing, streaming and limits remain real.
  vi.spyOn(client, "send").mockImplementation(async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      const chunks: Uint8Array[] = [];
      if (command.input.Body instanceof Uint8Array) chunks.push(command.input.Body);
      else for await (const chunk of command.input.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
      entries.set(command.input.Key!, { body: Buffer.concat(chunks), contentType: command.input.ContentType! });
      return { ETag: "synthetic" } as never;
    }
    if (!(command instanceof GetObjectCommand) && !(command instanceof HeadObjectCommand)) throw new Error("SYNTHETIC_S3_OPERATION_DENIED");
    const object = entries.get(command.input.Key!);
    if (!object) throw { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } };
    return { ContentLength: object.body.length, ContentType: object.contentType, LastModified: new Date(0), ETag: "synthetic",
      ...(command instanceof GetObjectCommand ? { Body: { async *[Symbol.asyncIterator]() { yield object.body; }, destroy: vi.fn() } } : {}) } as never;
  });
  const storage = new S3ObjectStorage({ bucket: "synthetic-project", client });
  return Object.assign(storage, { head: vi.spyOn(storage, "head") });
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
      const storage = syntheticS3(); const runtime = createSourceExecutionServer(storage); const media = createMediaAssetsServer(storage);
      const provide = (images: string[]) => {
        const bytes = new TextEncoder().encode(`<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06"><offer internal-id="one"><category>квартира</category><type>продажа</type><price><value>1000</value></price>${images.map((url) => `<picture>${url}</picture>`).join("")}</offer></realty-feed>`);
        gateway.feed.mockResolvedValue({ status: 200, contentType: "application/xml", contentLength: bytes.byteLength,
          finalUrl: new URL(process.env[reference]!), body: (async function* () { yield bytes; })(), close: vi.fn() });
      };
      const a = "https://producer.example.invalid/a.png"; const b = "https://producer.example.invalid/b.png";
      provide([a, b, a]); expect(await runtime.run(target)).toMatchObject({ state: "GOOD" });
      const read = () => runInPrincipalDatabaseTransaction(admin, async (tx) => ({
        source: await tx.source.findUniqueOrThrow({ where: { id: target.sourceId } }),
        identity: await tx.inventoryIdentity.findFirstOrThrow({ where: target }),
      }));
      const first = await read(); const job = createProjectJobPrincipal({ ...scope, jobName: "synthetic-snapshot" });
      gateway.media.mockImplementation(async (url: string) => ({ status: 200, contentType: "image/png", body: png, finalUrl: new URL(url) }));
      const mirror = (revision: string, urls: string[]) => media.mirrorMediaBatch(job, { ...target, sourceRevisionId: revision,
        observedAt: new Date().toISOString(), items: urls.map((sourceUrl, position) => ({ sourceUrl, position, entityType: "INVENTORY",
          entityUid: first.identity.uid, kind: "LISTING_IMAGE" as const, rightsBasis: "LICENSED" as const, license: "synthetic" })) });
      await mirror(first.source.lastGoodRevisionId!, [a, b, a]);
      const input = { ...target, sourceRevisionId: first.source.lastGoodRevisionId!, inventoryUid: first.identity.uid, expectedRecordHash: first.identity.normalizedHash };
      storage.head.mockClear();
      expect((await media.projectInventoryMedia(job, input)).media.map((item) => item.position)).toEqual([0, 1, 2]);
      expect(storage.head).toHaveBeenCalledOnce();
      const c = "https://producer.example.invalid/never-mirrored.png";
      provide([a, c]); expect(await runtime.run(target)).toMatchObject({ state: "GOOD" }); const second = await read();
      gateway.media.mockRejectedValue(new Error("PRODUCER_OFF"));
      expect(await mirror(second.source.lastGoodRevisionId!, [a, c])).toMatchObject({ importStatus: "UNCHANGED", mediaStatus: "WARNING" });
      await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        expect(await tx.mediaSource.findFirst({ where: { ...target, canonicalSourceUrl: c },
          select: { status: true, warningCode: true, assetId: true } })).toEqual({ status: "WARNING", warningCode: "MEDIA_MIRROR_FAILED", assetId: null });
        expect((await tx.inventoryIdentity.findUniqueOrThrow({ where: { uid: first.identity.uid } })).status).toBe("ACTIVE");
      });
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
      expect(projected.warnings).toEqual(["MEDIA_MIRROR_WARNING", "MEDIA_MIRROR_WARNING"]);
      expect(JSON.stringify(projected)).not.toMatch(/https:|sourceUrl|storageKey|originalFileName/u);
      expect(gateway.media).toHaveBeenCalledTimes(outboundCount); expect(workerTransactions).toBe(2);
      const canonical = syntheticCanonicalInventory({ ...target, uid: second.identity.uid, normalizedHash: second.identity.normalizedHash,
        sourceHash: second.identity.sourceHash, media: [{ sourceUrl: a, position: 0 }] });
      const publicProjection = await createInventoryPublicProjectionServer(storage)(job, { entity: canonical, sourceRevisionId: currentInput.sourceRevisionId });
      expect(JSON.parse(serializePublicDto(publicProjection.inventory)).media).toEqual(projected.media);
      expect(publicProjection.warnings).toEqual(["MEDIA_MIRROR_WARNING", "MEDIA_MIRROR_WARNING"]);
      const inventory = JSON.parse(serializePublicDto(publicProjection.inventory));
      const mediaRef = projected.media[0]!.ref;
      const composition = composeSnapshot({ projectId: scope.projectId, schemaMinor: 0, publishSequence: 1,
        generatedAt: new Date(0).toISOString(), publishedAt: new Date(0).toISOString(), catalogRevision: "synthetic-independence",
        sourceRevisions: [currentInput.sourceRevisionId], keyId: "synthetic", requiresProjectContact: true,
        datasets: SNAPSHOT_DATASET_KINDS.map((kind) => ({ kind, records: kind === "inventory" ? [{ key: inventory.uid, value: inventory,
          references: [{ kind: "media", key: mediaRef }] }] : kind === "media" ? [{ key: mediaRef, value: { ref: mediaRef, kind: "IMAGE" } }]
          : kind === "project/contacts" ? [{ key: scope.projectId, value: { phone: "+70000000000", email: "public@example.test" } }] : [] })) });
      const catalog = JSON.parse(gunzipSync(composition.files.find((file) => file.manifest.kind === "inventory")!.body).toString());
      expect(catalog[0].media).toEqual(projected.media);
      const image = await workerMedia.readInventoryPublicMedia(job, { ...currentInput, ref: mediaRef, position: 0 });
      expect(Buffer.from(image.body)).toEqual(Buffer.from(png)); expect(calculateObjectSha256(image.body)).toBe(mediaRef);
      expect(Object.keys(image).sort()).toEqual(["body", "contentType", "ref"]);
      expect(gateway.media).toHaveBeenCalledTimes(outboundCount);
      await expect(workerMedia.readInventoryPublicMedia(job, { ...currentInput, ref: mediaRef, position: 1 }))
        .rejects.toThrow("MEDIA_PUBLIC_OBJECT_NOT_FOUND");
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
  }, 30_000);
});
