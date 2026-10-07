import { generateKeyPairSync, randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { canonicalJson, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";

const cuts = vi.hoisted(() => ({ active: 0, roles: 0 }));
vi.mock("../../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = (context, execute, options) =>
    actual.runInAuthorizedDatabaseTransaction(context, async (tx) => {
      const snapshot = ["snapshot-input", "snapshot-publication"].includes(context.actorId);
      if (snapshot) {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]); cuts.roles++;
      }
      // Observer queries in the SDK test transport are not producer transactions.
      const track = snapshot && context.correlationId !== "synthetic-binding-observer";
      if (track) cuts.active++;
      try { return await execute(tx); } finally { if (track) cuts.active--; }
    }, options);
  return { ...actual, runInAuthorizedDatabaseTransaction: authorized };
});
import { captureSnapshotInput, createSnapshotArtifactStagingServer, createSnapshotSignedBuildServer, PrismaSnapshotPublicationRepository } from "../../src/modules/snapshot-delivery/server.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import { calculateObjectSha256 } from "../../src/platform/storage/object-storage.ts";
import { S3ObjectStorage } from "../../src/platform/storage/timeweb-s3-object-storage.ts";
import { defineSecretRef } from "../../src/platform/security/secret-ref.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";

async function fixture() {
  const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-binding-admin", correlationId: randomUUID() };
  const setup = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const suffix = randomUUID().slice(0, 8);
    const org = await tx.organization.create({ data: { name: "Synthetic binding", slug: `binding-${suffix}` } });
    const instant = new Date("2026-10-07T01:02:03.789Z");
    const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic binding",
      slug: `binding-${suffix}`, createdAt: instant } });
    expect(project.createdAt).toEqual(instant);
    expect(await tx.$queryRaw`SELECT (extract(epoch FROM "createdAt") * 1000)::bigint::text AS epoch
      FROM "Project" WHERE "id" = ${project.id}`).toEqual([{ epoch: String(instant.getTime()) }]);
    const foreign = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic foreign", slug: `binding-b-${suffix}` } });
    const scope = { organizationId: org.id, projectId: project.id };
    await tx.projectCatalogSubscription.create({ data: { ...scope, mode: "CURATED",
      cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
      update: { jobsFrozen: false, unfrozenAt: new Date() } });
    return { scope, foreignId: foreign.id };
  });
  const principal = createProjectJobPrincipal({ ...setup.scope, jobName: "snapshot-input" });
  const receipt = await captureSnapshotInput(principal, { ...setup.scope, idempotencyKey: "synthetic-binding", schemaMinor: 0 });
  const lookup = { idempotencyKeyHash: receipt.idempotencyKeyHash, requestHash: receipt.requestHash };
  return { ...setup, principal, receipt, lookup };
}
function observer<T>(scope: { organizationId: string; projectId: string }, execute: (tx: DatabaseTransaction) => Promise<T>,
  actorId = "snapshot-publication", projectIds: readonly string[] | "*" = [scope.projectId], principalKind: "project-job" | "job" = "project-job") {
  return runInAuthorizedDatabaseTransaction({ principalKind, actorId, organizationId: scope.organizationId,
    projectIds, correlationId: "synthetic-binding-observer" }, execute, { isolationLevel: "ReadCommitted", timeout: 5000 });
}

describe("actual capture/sign/bind and immutable S3 artifact staging", () => {
  it("binds before PUT, leaves no partial current after failure, replays on restart and denies key-rotation substitution", async () => {
    cuts.roles = 0; const setup = await fixture(); const { scope } = setup;
    const client = new S3Client({ endpoint: "https://synthetic-storage.example.invalid", region: "synthetic-1",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" }, forcePathStyle: true });
    const stored = new Map<string, { body: Uint8Array; contentType: string }>();
    let puts = 0; let fail = true; let firstPutProof: Promise<unknown> | undefined; let firstPutSettled = false;
    const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
      expect(cuts.active).toBe(0);
      if (command instanceof PutObjectCommand) {
        const index = ++puts;
        if (index === 1) {
          firstPutProof = observer(scope, async (tx) => {
            expect(await tx.snapshotPublicationBinding.count()).toBe(1);
            expect(await tx.deliveryRun.count()).toBe(0);
            expect(await tx.projectCurrentSnapshotManifest.count()).toBe(0);
          });
          await firstPutProof;
          firstPutSettled = true;
        }
        if (fail && index === 3) throw new Error("SYNTHETIC_PARTIAL_PUT_FAILURE");
        expect(command.input.Key).toMatch(new RegExp(`^snapshots/${scope.projectId}/[a-f0-9]{64}$`, "u"));
        expect(command.input.Body).toBeInstanceOf(Uint8Array);
        stored.set(command.input.Key!, { body: Uint8Array.from(command.input.Body as Uint8Array), contentType: command.input.ContentType! });
        return { ETag: "synthetic-etag" } as never;
      }
      if (command instanceof GetObjectCommand) {
        const object = stored.get(command.input.Key!); if (!object) throw Object.assign(new Error(), { name: "NoSuchKey" });
        return { Body: { transformToByteArray: async () => object.body }, ContentType: object.contentType,
          ContentLength: object.body.byteLength, LastModified: new Date(0), ETag: "synthetic-etag" } as never;
      }
      throw new Error("SYNTHETIC_UNEXPECTED_S3_OPERATION");
    });
    const storage = new S3ObjectStorage({ bucket: "synthetic-binding-bucket", client });
    const keys = generateKeyPairSync("ed25519"); const rotated = generateKeyPairSync("ed25519");
    const previous = process.env.SYNTHETIC_BINDING_SIGNING_KEY;
    process.env.SYNTHETIC_BINDING_SIGNING_KEY = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const bound = { ...scope, storage, keyId: "synthetic-binding-key", privateKeyRef: defineSecretRef("SYNTHETIC_BINDING_SIGNING_KEY"),
      trustSet: { currentKeyId: "synthetic-binding-key", nextKeyId: null, revokedKeyIds: [],
        publicKeys: { "synthetic-binding-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } } };
    try {
      const signed = await createSnapshotSignedBuildServer(bound)(setup.principal, setup.lookup);
      const text = canonicalJson(signed.manifest as CanonicalJsonValue);
      // Compare independently in PostgreSQL, without logging the signed payload.
      expect(await observer(scope, (tx) => tx.$queryRaw`
        SELECT (m->>'projectId' = r."projectId") AS project,
          (current_setting('TimeZone') = 'UTC') AS "utcSession",
          (m->>'schemaMajor' = '1') AS major,
          (m->>'schemaMinor' = r."schemaMinor"::text) AS minor,
          (m->>'publishSequence' = r."publishSequence"::text) AS sequence,
          (m->>'catalogRevision' = r."catalogRevision"::text) AS catalog,
          ((m->>'generatedAt')::timestamptz = r."capturedAt") AS generated,
          ((m->>'publishedAt')::timestamptz = r."capturedAt") AS published,
          (extract(epoch FROM ((m->>'generatedAt')::timestamptz - r."capturedAt")) * 1000)::int AS "timestampDeltaMs",
          (jsonb_array_length(m->'files') = 13) AS files,
          (jsonb_typeof(m->'signature') = 'string') AS signature
        FROM "SnapshotBuildInput" r CROSS JOIN (SELECT ${text}::jsonb AS m) payload
        WHERE r."id" = ${setup.receipt.id}
      `)).toEqual([{ project: true, utcSession: true, major: true, minor: true, sequence: true, catalog: true,
        generated: true, published: true, timestampDeltaMs: 0, files: true, signature: true }]);
      await expect(createSnapshotArtifactStagingServer(bound)(setup.principal, setup.lookup)).rejects.toThrow("SYNTHETIC_PARTIAL_PUT_FAILURE");
      expect(firstPutSettled).toBe(true);
      await firstPutProof;
      const binding = await observer(scope, (tx) => tx.snapshotPublicationBinding.findFirstOrThrow());
      expect(binding.buildInputId).toBe(setup.receipt.id); expect(binding.inputHash).toBe(setup.receipt.inputHash);
      expect(stored.size).toBeGreaterThan(0);
      expect([...stored.values()].every((object) => object.contentType === "application/gzip")).toBe(true);
      fail = false;
      const staged = await createSnapshotArtifactStagingServer(bound)(setup.principal, setup.lookup); // Fresh factory models process restart.
      expect(staged.binding).toEqual(binding);
      expect(staged.current.manifestSha256).toBe(binding.manifestSha256);
      const object = await storage.get(staged.current.manifestKey);
      expect(calculateObjectSha256(object!.body)).toBe(binding.manifestSha256);
      expect(new TextDecoder().decode(object!.body)).toBe(binding.manifestCanonical);
      await observer(scope, async (tx) => {
        expect(await tx.snapshotPublicationBinding.count()).toBe(1);
        expect(await tx.deliveryRun.count()).toBe(0); expect(await tx.projectCurrentSnapshotManifest.count()).toBe(0);
      });
      const beforeRotation = puts;
      process.env.SYNTHETIC_BINDING_SIGNING_KEY = rotated.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      await expect(createSnapshotArtifactStagingServer({ ...bound, keyId: "synthetic-rotated-key", trustSet: {
        currentKeyId: "synthetic-rotated-key", nextKeyId: null, revokedKeyIds: [],
        publicKeys: { "synthetic-rotated-key": rotated.publicKey.export({ format: "pem", type: "spki" }).toString() },
      } })(setup.principal, setup.lookup)).rejects.toThrow("SNAPSHOT_PUBLICATION_BINDING_CONFLICT");
      expect(puts).toBe(beforeRotation);
      expect(await observer(scope, (tx) => tx.snapshotPublicationBinding.findFirstOrThrow())).toEqual(binding);
      await expect(createSnapshotArtifactStagingServer(bound)(createProjectJobPrincipal({ ...scope,
        projectId: setup.foreignId, jobName: "snapshot-input" }), setup.lookup)).rejects.toThrow("SNAPSHOT_INPUT_ACCESS_DENIED");
      expect(cuts.roles).toBeGreaterThan(6);
    } finally {
      if (previous === undefined) delete process.env.SYNTHETIC_BINDING_SIGNING_KEY; else process.env.SYNTHETIC_BINDING_SIGNING_KEY = previous;
      send.mockRestore(); client.destroy();
    }
  }, 60_000);

  it("enforces exact binding/receipt scope, immutable grants and header/hash checks independently of the server seam", async () => {
    const setup = await fixture(); const { scope, receipt } = setup;
    // Real signed server output establishes the DB identity; the SDK remains synthetic.
    const keys = generateKeyPairSync("ed25519"); const previous = process.env.SYNTHETIC_BINDING_SIGNING_KEY;
    process.env.SYNTHETIC_BINDING_SIGNING_KEY = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const client = new S3Client({ region: "synthetic-1", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" } });
    const send = vi.spyOn(client, "send").mockResolvedValue({ ETag: "synthetic-etag" } as never);
    try {
      const stage = createSnapshotArtifactStagingServer({ ...scope, storage: new S3ObjectStorage({ bucket: "synthetic-binding-bucket", client }),
        keyId: "synthetic-binding-key", privateKeyRef: defineSecretRef("SYNTHETIC_BINDING_SIGNING_KEY"), trustSet: {
          currentKeyId: "synthetic-binding-key", nextKeyId: null, revokedKeyIds: [],
          publicKeys: { "synthetic-binding-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } } });
      const result = await stage(setup.principal, setup.lookup);
      for (const projects of ["*", [], [scope.projectId, setup.foreignId], [setup.foreignId]] as const) {
        expect(await observer(scope, (tx) => tx.snapshotPublicationBinding.count(), "snapshot-publication", projects)).toBe(0);
      }
      expect(await observer(scope, (tx) => tx.snapshotPublicationBinding.count(), "snapshot-publication", [scope.projectId], "job")).toBe(0);
      expect(await observer(scope, (tx) => tx.snapshotPublicationBinding.count(), "snapshot-input")).toBe(0);
      await expect(observer(scope, (tx) => new PrismaSnapshotPublicationRepository(tx).bind({ ...scope,
        projectId: setup.foreignId, receiptId: receipt.id, inputHash: receipt.inputHash,
        manifest: { ...result.manifest, projectId: setup.foreignId } }))).rejects.toThrow();
      const { createdAt: _createdAt, ...identity } = result.binding; void _createdAt;
      await expect(observer(scope, (tx) => tx.snapshotPublicationBinding.create({ data: { ...identity, inputHash: "f".repeat(64) } })))
        .rejects.toThrow("SNAPSHOT_PUBLICATION_RECEIPT_INVALID");
      const wrongHeader = canonicalJson({ ...result.manifest, catalogRevision: "f".repeat(64) } as CanonicalJsonValue);
      await expect(observer(scope, (tx) => tx.snapshotPublicationBinding.create({ data: { ...identity,
        manifestCanonical: wrongHeader, manifestSha256: calculateObjectSha256(new TextEncoder().encode(wrongHeader)) } })))
        .rejects.toThrow("SNAPSHOT_PUBLICATION_MANIFEST_INVALID");
      const wrongTime = canonicalJson({ ...result.manifest,
        generatedAt: new Date(new Date(result.manifest.generatedAt).getTime() + 1).toISOString() } as CanonicalJsonValue);
      await expect(observer(scope, (tx) => tx.snapshotPublicationBinding.create({ data: { ...identity,
        manifestCanonical: wrongTime, manifestSha256: calculateObjectSha256(new TextEncoder().encode(wrongTime)) } })))
        .rejects.toThrow("SNAPSHOT_PUBLICATION_MANIFEST_INVALID");
      await expect(observer(scope, (tx) => tx.snapshotPublicationBinding.create({ data: { ...identity, manifestSha256: "f".repeat(64) } })))
        .rejects.toThrow();
      await expect(observer(scope, (tx) => tx.$executeRaw`UPDATE "SnapshotPublicationBinding" SET "keyId" = 'synthetic-forged'`)).rejects.toThrow();
      await expect(observer(scope, (tx) => tx.$executeRaw`DELETE FROM "SnapshotPublicationBinding"`)).rejects.toThrow();
      await expect(observer(scope, (tx) => tx.project.updateMany({ where: { id: scope.projectId },
        data: { name: "synthetic-forged" } }))).rejects.toThrow();
      await observer(scope, async (tx) => {
        expect(await tx.$queryRawUnsafe("SELECT has_table_privilege(current_user, 'public.\"SnapshotPublicationBinding\"', 'UPDATE') AS allowed"))
          .toEqual([{ allowed: false }]);
        expect(await tx.project.findFirst({ where: { id: scope.projectId } })).not.toBeNull();
        expect(await tx.snapshotPublicationBinding.findFirstOrThrow()).toEqual(result.binding);
      });
    } finally {
      if (previous === undefined) delete process.env.SYNTHETIC_BINDING_SIGNING_KEY; else process.env.SYNTHETIC_BINDING_SIGNING_KEY = previous;
      send.mockRestore(); client.destroy();
    }
  }, 60_000);
});
