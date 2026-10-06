import { randomUUID } from "node:crypto";
import { createUlid, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../../src/generated/prisma/client.ts";
import { PrismaSnapshotInputRepository, runInSnapshotInputTransaction } from "../../src/modules/snapshot-delivery/server.ts";
import {
  SNAPSHOT_INPUT_PART_KINDS, SnapshotInputPartsBuilder, snapshotInputHash,
  snapshotInputRequestHashes, snapshotInputRequestSchema,
} from "../../src/modules/snapshot-delivery/index.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction,
  type DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { createCatalogSnapshotFactReader } from "../../src/modules/shared-catalog/server.ts";
import { createSourceSnapshotFactReader } from "../../src/modules/ingestion-core/server.ts";
import * as transactionRuntime from "../../src/platform/database/transaction.ts";
import { getPrismaPool } from "../../src/platform/database/prisma/client.ts";

const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-input-admin", correlationId: "synthetic-input" };
async function setup() {
  const suffix = randomUUID().slice(0, 8);
  return runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const organization = await tx.organization.create({ data: { name: "Synthetic snapshot capture", slug: `input-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: organization.id, name: "Synthetic input", slug: `input-${suffix}` } });
    const foreignProject = await tx.project.create({ data: { organizationId: organization.id, name: "Foreign input", slug: `input-b-${suffix}` } });
    await tx.dataSafetyState.upsert({ where: { id: "global" },
      create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() }, update: { jobsFrozen: false, unfrozenAt: new Date() } });
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

  it("reads a bounded catalog closure in the caller's single cut, not another tenant subscription", async () => {
    const scope = await setup();
    const uid = createUlid();
    const developerUid = createUlid();
    const cityUid = "01M41T6Q04BADHXSERJHZFXKCH";
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const developerName = `Synthetic developer ${developerUid}`;
      await tx.developer.create({ data: { uid: developerUid, name: developerName, normalizedName: developerName.toLowerCase() } });
      await tx.development.create({ data: { uid, developerUid, cityUid, name: "Captured name", normalizedName: "captured name" } });
      await tx.projectCatalogSubscription.create({ data: {
        organizationId: scope.organizationId, projectId: scope.projectId, mode: "ALL_SHARED",
        cities: { create: { cityUid } },
      } });
    });
    await worker(scope, async (tx) => {
      const capture = async () => {
        const values: CanonicalJsonValue[] = [];
        await createCatalogSnapshotFactReader(tx).captureCandidates(scope, [], (_kind, rows) => { values.push(...rows); });
        return values;
      };
      const first = await capture();
      expect(first).toContainEqual(expect.objectContaining({ entityType: "development", uid, name: "Captured name" }));
      await runInPrincipalDatabaseTransaction(admin, (otherTx) => otherTx.development.update({ where: { uid }, data: {
        name: "Changed after cut", normalizedName: "changed after cut",
      } }));
      expect(await capture()).toEqual(first);
      await expect(createCatalogSnapshotFactReader(tx).captureCandidates({ organizationId: scope.organizationId,
        projectId: scope.foreignProjectId }, [], () => undefined)).rejects.toThrow("SHARED_CATALOG_SUBSCRIPTION_NOT_FOUND");
    });
    await worker(scope, async (tx) => {
      const values: CanonicalJsonValue[] = [];
      await createCatalogSnapshotFactReader(tx).captureCandidates(scope, [], (_kind, rows) => { values.push(...rows); });
      expect(values).toContainEqual(expect.objectContaining({ entityType: "development", uid, name: "Changed after cut" }));
    });
  });

  it("pins the historical GOOD fact still backing an ACTIVE grace identity, without raw payload or write rights", async () => {
    const scope = await setup();
    const uid = createUlid();
    const fixtures = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const source = await tx.source.create({ data: {
        organizationId: scope.organizationId, projectId: scope.projectId, sourceKey: "synthetic-input",
        name: "Synthetic input source", adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0",
        profileKey: "vladis-vt24-v1", profileVersion: "1.0.0", datasetType: "RESALE",
        schedulePolicy: { mode: "MANUAL_ONLY" }, enabled: true,
      } });
      const target = { organizationId: scope.organizationId, projectId: scope.projectId, sourceId: source.id };
      const good = async (sequence: number, externalId: string, inventoryUid: string, recordHash: string) => {
        const revision = await tx.sourceRevision.create({ data: { ...target, sourceVersion: source.version,
          adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey,
          profileVersion: source.profileVersion, safetyPolicy: {}, recordCount: 1,
        } });
        await tx.sourceRevisionRecord.create({ data: { ...target, revisionId: revision.id,
          externalId, orderKey: Buffer.from(externalId).toString("hex"), inventoryUid, recordHash,
          payload: { schemaVersion: 1, draft: { contactPhones: ["synthetic-private-only"] }, rawRecord: { marker: "private" }, fields: {} },
        } });
        await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED",
          rawStorageKey: `private-synthetic/${sequence}`, rawArtifactHash: "a".repeat(64), rawByteCount: 1,
          normalizedContentHash: recordHash, sequence, completedAt: new Date(),
        } });
        await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
        return revision.id;
      };
      const historical = await good(1, "kept", uid, "b".repeat(64));
      const head = await good(2, "new-only", createUlid(), "c".repeat(64));
      await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: head } });
      await tx.inventoryIdentity.create({ data: { ...target, uid, externalOfferId: "kept", status: "ACTIVE",
        sourceHash: "d".repeat(64), normalizedHash: "b".repeat(64), firstSeenAt: new Date(), lastSeenAt: new Date(),
        missingGoodRuns: 1, missingSince: new Date(),
      } });
      await tx.sourceRevision.create({ data: { ...target, sourceVersion: source.version, adapterKey: source.adapterKey,
        adapterVersion: source.adapterVersion, profileKey: source.profileKey, profileVersion: source.profileVersion, safetyPolicy: {},
      } });
      return { sourceId: source.id, historical, head };
    });
    await worker(scope, async (tx) => {
      const inventory: CanonicalJsonValue[] = [];
      const sources: CanonicalJsonValue[] = [];
      await createSourceSnapshotFactReader(tx).capture(scope, (kind, rows) => {
        (kind === "inventory" ? inventory : sources).push(...rows);
      });
      expect(inventory).toHaveLength(1);
      expect(inventory[0]).toMatchObject({ uid, approvedHeadId: fixtures.head, approvedHeadSequence: 2,
        factRevisionId: fixtures.historical, factRevisionSequence: 1, factProfileIdentity: "vladis-vt24-v1@1.0.0" });
      expect(sources.filter((value) => typeof value === "object" && value !== null && !Array.isArray(value)
        && value.entityType === "profile")).toHaveLength(1);
      expect(JSON.stringify({ inventory, sources })).not.toMatch(/rawRecord|contactPhones|rawStorageKey|synthetic-private-only/u);
      expect(await tx.sourceRevision.count()).toBe(2);
      expect(await tx.sourceRevision.updateMany({ where: { id: fixtures.head }, data: { failedStage: "DENIED" } })).toMatchObject({ count: 0 });
      const foreign: CanonicalJsonValue[] = [];
      await createSourceSnapshotFactReader(tx).capture({ organizationId: scope.organizationId, projectId: scope.foreignProjectId },
        (_kind, rows) => { foreign.push(...rows); });
      expect(foreign).toEqual([]);
    });
    await runInPrincipalDatabaseTransaction(admin, (tx) => tx.inventoryIdentity.update({ where: { uid }, data: { normalizedHash: "e".repeat(64) } }));
    await expect(worker(scope, (tx) => createSourceSnapshotFactReader(tx).capture(scope, () => undefined)))
      .rejects.toThrow("SNAPSHOT_INPUT_INVENTORY_FACT_MISSING");
  });

  it("fresh admission denies a freeze committed while the outer RR cut waited on the safety lock", async () => {
    const scope = await setup();
    let releaseBlocker!: () => void;
    let signalLocked!: () => void;
    let signalCut!: () => void;
    const release = new Promise<void>((resolve) => { releaseBlocker = resolve; });
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const cut = new Promise<void>((resolve) => { signalCut = resolve; });
    const blocker = runInPrincipalDatabaseTransaction(admin, async (tx) => {
      await tx.$queryRaw(Prisma.sql`select pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text`);
      await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true, frozenAt: new Date() } });
      signalLocked();
      await release;
    });
    await locked;
    const original = transactionRuntime.runInAuthorizedDatabaseTransaction;
    let workerReads = 0;
    const spy = vi.spyOn(transactionRuntime, "runInAuthorizedDatabaseTransaction").mockImplementation((context, execute, options) =>
      original(context, async (tx) => {
        if (context.principalKind === "project-job" && context.actorId === "snapshot-input") {
          await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
          const roles = await tx.$queryRawUnsafe<{ rolbypassrls: boolean; rolsuper: boolean }[]>(
            "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user");
          expect(roles).toEqual([{ rolbypassrls: false, rolsuper: false }]);
          workerReads++;
          if (options?.isolationLevel === "RepeatableRead") {
            expect(await tx.dataSafetyState.findUnique({ where: { id: "global" }, select: { jobsFrozen: true } }))
              .toEqual({ jobsFrozen: false });
            signalCut();
          }
        }
        return execute(tx);
      }, options));
    let mutated = false;
    const outcome = expect(runInSnapshotInputTransaction({ kind: "project-job", jobName: "snapshot-input",
      organizationId: scope.organizationId, projectId: scope.projectId, correlationId: randomUUID() }, async (tx) => {
      mutated = true;
      return new PrismaSnapshotInputRepository(tx).reserveSequence(scope.organizationId, scope.projectId);
    })).rejects.toThrow("SNAPSHOT_INPUT_JOBS_FROZEN");
    try {
      await cut;
      releaseBlocker();
      await blocker;
      await outcome;
      expect(workerReads).toBe(2);
      expect(mutated).toBe(false);
    } finally {
      releaseBlocker();
      spy.mockRestore();
    }
    await worker(scope, async (tx) => {
      expect(await tx.projectSnapshotSequence.count()).toBe(0);
      expect(await tx.snapshotBuildInput.count()).toBe(0);
    });
    await expect(worker(scope, (tx) => tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: false } }))).rejects.toThrow();
    await worker(scope, async (tx) => {
      const privileges = await tx.$queryRawUnsafe<{ projectUpdate: boolean; safetyUpdate: boolean }[]>(
        `SELECT has_table_privilege(current_user, 'public."Project"', 'UPDATE') AS "projectUpdate",
          has_table_privilege(current_user, 'public."DataSafetyState"', 'UPDATE') AS "safetyUpdate"`);
      expect(privileges).toEqual([{ projectUpdate: false, safetyUpdate: false }]);
    });
    await expect(worker(scope, (tx) => tx.project.update({ where: { id: scope.projectId }, data: { status: "DISABLED" } }))).rejects.toThrow();
  });

  it("bounds admission pool contention and rolls back instead of deadlocking the capture", async () => {
    const scope = await setup();
    const pool = getPrismaPool();
    const maximum = pool.options.max ?? 10;
    expect(maximum).toBeGreaterThan(1);
    const borrowed = await Promise.all(Array.from({ length: maximum - 1 }, () => pool.connect()));
    const original = transactionRuntime.runInAuthorizedDatabaseTransaction;
    const spy = vi.spyOn(transactionRuntime, "runInAuthorizedDatabaseTransaction").mockImplementation((context, execute, options) =>
      original(context, async (tx) => {
        if (context.principalKind === "project-job" && context.actorId === "snapshot-input") {
          await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        }
        return execute(tx);
      }, options));
    let reached = false;
    const started = performance.now();
    try {
      await expect(runInSnapshotInputTransaction({ kind: "project-job", jobName: "snapshot-input",
        organizationId: scope.organizationId, projectId: scope.projectId, correlationId: randomUUID() }, async (tx) => {
        reached = true;
        return new PrismaSnapshotInputRepository(tx).reserveSequence(scope.organizationId, scope.projectId);
      })).rejects.toThrow();
      expect(performance.now() - started).toBeLessThan(10_000);
      expect(reached).toBe(false);
    } finally {
      spy.mockRestore();
      for (const client of borrowed) client.release();
    }
    await worker(scope, async (tx) => {
      expect(await tx.projectSnapshotSequence.count()).toBe(0);
      expect(await tx.snapshotBuildInput.count()).toBe(0);
    });
    expect(reached).toBe(false);
    expect(pool.waitingCount).toBe(0);
    expect(pool.idleCount).toBe(pool.totalCount);
  }, 15_000);
});
