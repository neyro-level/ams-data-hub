import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PrismaSnapshotInputRepository } from "../../src/modules/snapshot-delivery/server.ts";
import {
  SNAPSHOT_INPUT_PART_KINDS, SnapshotInputPartsBuilder, snapshotInputHash,
  snapshotInputRequestHashes, snapshotInputRequestSchema,
} from "../../src/modules/snapshot-delivery/index.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction,
  type DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";

const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-input-admin", correlationId: "synthetic-input" };
async function setup() {
  const suffix = randomUUID().slice(0, 8);
  return runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const organization = await tx.organization.create({ data: { name: "Synthetic snapshot capture", slug: `input-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: organization.id, name: "Synthetic input", slug: `input-${suffix}` } });
    const foreignProject = await tx.project.create({ data: { organizationId: organization.id, name: "Foreign input", slug: `input-b-${suffix}` } });
    return { organizationId: organization.id, projectId: project.id, foreignProjectId: foreignProject.id };
  });
}
function worker<T>(scope: { organizationId: string; projectId: string }, execute: (tx: DatabaseTransaction) => Promise<T>) {
  return runInAuthorizedDatabaseTransaction({ principalKind: "project-job", actorId: "snapshot-input",
    organizationId: scope.organizationId, projectIds: [scope.projectId], correlationId: randomUUID() }, async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
    const roles = await tx.$queryRawUnsafe<{ rolbypassrls: boolean; rolsuper: boolean }[]>(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user");
    expect(roles).toEqual([{ rolbypassrls: false, rolsuper: false }]);
    return execute(tx);
  }, { isolationLevel: "RepeatableRead", timeout: 30_000 });
}
function parts() {
  const builder = new SnapshotInputPartsBuilder();
  for (const kind of SNAPSHOT_INPUT_PART_KINDS) builder.add(kind, kind === "catalog" ? [{ uid: "synthetic", version: 1 }] : []);
  return builder.finish();
}

describe("snapshot input persistence foundation with NOBYPASS PostgreSQL worker", () => {
  it("reserves above existing publication, saves immutable complete input, and replays identical receipt", async () => {
    const scope = await setup();
    await runInPrincipalDatabaseTransaction(admin, (tx) => tx.projectCurrentSnapshotManifest.create({ data: {
      organizationId: scope.organizationId, projectId: scope.projectId, publishSequence: 7,
      manifestKey: "synthetic-manifest", manifestSha256: "a".repeat(64), publishedAt: new Date(),
    } }));
    const request = snapshotInputRequestSchema.parse({
      organizationId: scope.organizationId, projectId: scope.projectId, idempotencyKey: "synthetic-capture" });
    const hashes = snapshotInputRequestHashes(request);
    const receipt = await worker(scope, async (tx) => {
      const repository = new PrismaSnapshotInputRepository(tx);
      await repository.lockProject(scope.organizationId, scope.projectId);
      expect(await repository.find(scope.organizationId, scope.projectId, hashes.idempotencyKeyHash, hashes.requestHash)).toBeNull();
      const publishSequence = await repository.reserveSequence(scope.organizationId, scope.projectId);
      expect(publishSequence).toBe(8);
      return repository.save({ organizationId: scope.organizationId, projectId: scope.projectId, ...hashes,
        inputSchemaVersion: 1, projectorVersion: "db-v1", schemaMinor: 0, publishSequence,
        projectStateRevision: 1, catalogRevision: snapshotInputHash([{ uid: "synthetic", version: 1 }]),
        capturedAt: new Date("2026-10-06T00:00:00.000Z"), parts: parts() });
    });
    await worker(scope, async (tx) => {
      const repository = new PrismaSnapshotInputRepository(tx);
      expect(await repository.find(scope.organizationId, scope.projectId, hashes.idempotencyKeyHash, hashes.requestHash)).toEqual(receipt);
      expect(await repository.find(scope.organizationId, scope.foreignProjectId, hashes.idempotencyKeyHash, hashes.requestHash)).toBeNull();
    });
    await expect(worker(scope, (tx) => new PrismaSnapshotInputRepository(tx).find(scope.organizationId,
      scope.projectId, hashes.idempotencyKeyHash, "b".repeat(64)))).rejects.toThrow("SNAPSHOT_INPUT_IDEMPOTENCY_CONFLICT");
    await expect(worker(scope, (tx) => tx.snapshotBuildInputPart.create({ data: {
      organizationId: scope.organizationId, projectId: scope.projectId, buildInputId: receipt.id,
      kind: "catalog", partIndex: 1, payloadHash: snapshotInputHash([]), payload: [],
    } }))).rejects.toThrow("SNAPSHOT_INPUT_CAPTURE_CLOSED");
    await expect(worker(scope, (tx) => tx.$executeRawUnsafe('UPDATE "SnapshotBuildInput" SET "schemaMinor" = 1'))).rejects.toThrow();
    await expect(worker(scope, (tx) => tx.projectSnapshotSequence.update({
      where: { organizationId_projectId: { organizationId: scope.organizationId, projectId: scope.projectId } },
      data: { lastReservedSequence: 1 },
    }))).rejects.toThrow("SNAPSHOT_SEQUENCE_NOT_INCREASING");
    await worker(scope, async (tx) => {
      const repository = new PrismaSnapshotInputRepository(tx);
      await repository.lockProject(scope.organizationId, scope.projectId);
      expect(await repository.reserveSequence(scope.organizationId, scope.projectId)).toBe(9);
    });
  });

  it("rolls back sequence and receipt when capture fails before commit", async () => {
    const scope = await setup();
    await expect(worker(scope, async (tx) => {
      const repository = new PrismaSnapshotInputRepository(tx);
      await repository.lockProject(scope.organizationId, scope.projectId);
      expect(await repository.reserveSequence(scope.organizationId, scope.projectId)).toBe(1);
      throw new Error("SYNTHETIC_CAPTURE_FAILURE");
    })).rejects.toThrow("SYNTHETIC_CAPTURE_FAILURE");
    await worker(scope, async (tx) => {
      expect(await tx.projectSnapshotSequence.count()).toBe(0);
      expect(await tx.snapshotBuildInput.count()).toBe(0);
      expect(await tx.snapshotBuildInputPart.count()).toBe(0);
    });
    await expect(worker(scope, (tx) => new PrismaSnapshotInputRepository(tx).reserveSequence(
      scope.organizationId, scope.foreignProjectId))).rejects.toThrow();
  });

  it("enforces complete sections at DB commit, not merely through the TypeScript builder", async () => {
    const scope = await setup();
    await expect(worker(scope, async (tx) => {
      const sequence = await new PrismaSnapshotInputRepository(tx).reserveSequence(scope.organizationId, scope.projectId);
      await tx.snapshotBuildInput.create({ data: {
        organizationId: scope.organizationId, projectId: scope.projectId,
        idempotencyKeyHash: "a".repeat(64), requestHash: "b".repeat(64), inputSchemaVersion: 1,
        projectorVersion: "db-v1", schemaMinor: 0, publishSequence: sequence, projectStateRevision: 1,
        catalogRevision: "c".repeat(64), inputHash: "d".repeat(64), capturedAt: new Date(),
      } });
    })).rejects.toThrow("SNAPSHOT_INPUT_INCOMPLETE");
    await worker(scope, async (tx) => {
      expect(await tx.snapshotBuildInput.count()).toBe(0);
      expect(await tx.projectSnapshotSequence.count()).toBe(0);
    });
  });

  it("rejects a late gap even after the header constraint was made immediate", async () => {
    const scope = await setup();
    await expect(worker(scope, async (tx) => {
      const repository = new PrismaSnapshotInputRepository(tx);
      const publishSequence = await repository.reserveSequence(scope.organizationId, scope.projectId);
      const receipt = await repository.save({ organizationId: scope.organizationId, projectId: scope.projectId,
        idempotencyKeyHash: "a".repeat(64), requestHash: "b".repeat(64), inputSchemaVersion: 1,
        projectorVersion: "db-v1", schemaMinor: 0, publishSequence, projectStateRevision: 1,
        catalogRevision: "c".repeat(64), capturedAt: new Date(), parts: parts() });
      await tx.$executeRawUnsafe('SET CONSTRAINTS "SnapshotBuildInput_complete" IMMEDIATE');
      await tx.snapshotBuildInputPart.create({ data: {
        organizationId: scope.organizationId, projectId: scope.projectId, buildInputId: receipt.id,
        kind: "catalog", partIndex: 99, payload: [], payloadHash: snapshotInputHash([]),
      } });
    })).rejects.toThrow("SNAPSHOT_INPUT_INCOMPLETE");
    await worker(scope, async (tx) => {
      expect(await tx.snapshotBuildInput.count()).toBe(0);
      expect(await tx.projectSnapshotSequence.count()).toBe(0);
    });
  });
});
