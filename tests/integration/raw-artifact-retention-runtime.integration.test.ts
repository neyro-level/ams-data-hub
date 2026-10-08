import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
const evidence = vi.hoisted(() => ({ cuts: 0, failAudit: false, workerCuts: 0 }));
vi.mock("../../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = (context, execute, options) =>
    actual.runInAuthorizedDatabaseTransaction(context, async (tx) => {
      if (context.principalKind === "project-job") {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user"))
          .toEqual([{ rolsuper: false, rolbypassrls: false }]); evidence.workerCuts++;
      }
      const audit = context.actorId === "raw-artifact-retention" && evidence.failAudit
        ? vi.spyOn(tx.auditEvent, "create").mockImplementationOnce(() => {
          evidence.failAudit = false; throw new Error("SYNTHETIC_AUDIT_AFTER_ACK_CRASH");
        }) : undefined;
      evidence.cuts++;
      try { return await execute(tx); } finally { evidence.cuts--; audit?.mockRestore(); }
    }, options);
  return { ...actual, runInAuthorizedDatabaseTransaction: authorized,
    runInPrincipalDatabaseTransaction: (principal: Parameters<typeof actual.runInPrincipalDatabaseTransaction>[0], execute: Parameters<typeof actual.runInPrincipalDatabaseTransaction>[1]) =>
      authorized(actual.createDatabaseAuthorizationContext(principal), execute) };
});
import { runRawArtifactRetentionCommand } from "../../src/infrastructure/raw-artifact-retention-runtime.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { acquireRawArtifactLifetimeGuard } from "../../src/modules/ingestion-core/server.ts";
import { getPrismaPool } from "../../src/platform/database/prisma/client.ts";
import { rawArtifactLifetimeGuardKey } from "../../src/modules/ingestion-core/infrastructure/raw-artifact-lifetime-guard.ts";
import { captureSnapshotInput } from "../../src/modules/snapshot-delivery/server.ts";
import { analyzeImportSafety, BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../../src/modules/ingestion-core/index.ts";

const hash = (index: number) => index.toString(16).padStart(64, "0");
async function fixture() {
  const suffix = randomUUID().slice(0, 8);
  const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-retention", correlationId: randomUUID() };
  const setup = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const org = await tx.organization.create({ data: { name: "Synthetic retention", slug: `retention-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic retention", slug: `retention-${suffix}` } });
    const scope = { organizationId: org.id, projectId: project.id };
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
      update: { jobsFrozen: false, unfrozenAt: new Date() } });
    await tx.projectCatalogSubscription.create({ data: { ...scope, mode: "CURATED",
      cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
    const source = await tx.source.create({ data: { ...scope, sourceKey: "synthetic-retention", name: "Synthetic retention",
      adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
      datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" }, enabled: false } });
    return { scope, source };
  });
  const bucket = `synthetic-retention-${suffix}`;
  vi.stubEnv("PROJECT_STORAGE_BINDINGS", JSON.stringify([{ ...setup.scope, bucketRef: "SYNTHETIC_DELETE_BUCKET", endpointRef: "SYNTHETIC_DELETE_ENDPOINT",
    regionRef: "SYNTHETIC_DELETE_REGION", accessKeyIdRef: "SYNTHETIC_DELETE_ACCESS", secretAccessKeyRef: "SYNTHETIC_DELETE_SECRET" }]));
  vi.stubEnv("SYNTHETIC_DELETE_BUCKET", bucket); vi.stubEnv("SYNTHETIC_DELETE_ENDPOINT", "https://synthetic.invalid");
  vi.stubEnv("SYNTHETIC_DELETE_REGION", "ru-1"); vi.stubEnv("SYNTHETIC_DELETE_ACCESS", "synthetic-delete"); vi.stubEnv("SYNTHETIC_DELETE_SECRET", "synthetic-delete");
  const run = (signal = new AbortController().signal, batch = "10") => runRawArtifactRetentionCommand([setup.scope.organizationId, setup.scope.projectId, batch], signal);
  const read = () => runInPrincipalDatabaseTransaction(admin, async (tx) => ({
    journals: await tx.rawArtifactDeletion.findMany({ where: setup.scope, orderBy: { requestedAt: "asc" } }),
    audits: await tx.auditEvent.findMany({ where: { organizationId: setup.scope.organizationId, action: "source.raw-artifact.deleted" } }),
  }));
  // Legacy metadata is synthetic setup, not invented producer STORED evidence.
  const revision = (index: number, status: "FAILED" | "GOOD" = "FAILED", recent = false, sourceId = setup.source.id) =>
    runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const time = recent ? new Date() : new Date("2001-01-01T00:00:00Z"); const target = { ...setup.scope, sourceId };
      const policy = { ...BOOTSTRAP_SOURCE_SAFETY_POLICY, allowEmpty: true };
      const created = await tx.sourceRevision.create({ data: { ...target, sourceVersion: 1, startedAt: time,
        adapterKey: setup.source.adapterKey, adapterVersion: setup.source.adapterVersion, profileKey: setup.source.profileKey, profileVersion: setup.source.profileVersion,
        safetyPolicy: policy, safetyAnalysis: JSON.parse(JSON.stringify(analyzeImportSafety({ recordCount: 0, previousGoodRecordCount: null, invalidRecordCount: 0, issues: [] }, policy))), recordCount: 0 } });
      await tx.sourceRevision.update({ where: { id: created.id }, data: { status: status === "GOOD" ? "STAGED" : "FAILED",
        sequence: status === "GOOD" ? index : null, rawArtifactHash: hash(index), rawStorageKey: `source-artifacts/${hash(index)}`, rawByteCount: 1,
        normalizedContentHash: "b".repeat(64), completedAt: time } });
      if (status === "GOOD") await tx.sourceRevision.update({ where: { id: created.id }, data: { status: "GOOD" } });
      return created.id;
    });
  const sdk = (execute?: (sha: string, signal: AbortSignal | undefined) => Promise<unknown>) => vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: unknown, options?: unknown) => {
    expect(evidence.cuts).toBe(0); expect(command).toBeInstanceOf(DeleteObjectCommand);
    if (!(command instanceof DeleteObjectCommand)) throw new Error("SYNTHETIC_UNEXPECTED_IO");
    expect(command.input.Bucket).toBe(bucket); expect(command.input.Key).toMatch(/^source-artifacts\/[a-f0-9]{64}$/u);
    const sha = command.input.Key!.slice("source-artifacts/".length);
    const candidate = (options as { abortSignal?: unknown } | undefined)?.abortSignal;
    return (execute ? await execute(sha, candidate instanceof AbortSignal ? candidate : undefined) : { $metadata: { httpStatusCode: 204, attempts: 1 } }) as never;
  });
  return { ...setup, admin, run, read, revision, sdk };
}

describe("actual bounded raw retention one-shot command under native worker NOBYPASS", () => {
  it("deletes only eligible exact keys, audits once and does not starve later batches behind DELETED", async () => {
    const f = await fixture(); const first = await f.revision(1); await f.revision(2); const sdk = f.sdk();
    try {
      expect(await f.run(undefined, "1")).toMatchObject({ deleted: 1, unknown: 0 });
      expect(await f.run(undefined, "1")).toMatchObject({ deleted: 1, alreadyRemoved: 1 });
      expect(await f.run()).toMatchObject({ deleted: 0, alreadyRemoved: 2 }); expect(sdk).toHaveBeenCalledTimes(2);
      const state = await f.read(); expect(state.journals).toHaveLength(2); expect(state.audits).toHaveLength(2);
      expect(state.journals.every((row) => row.status === "DELETED" && row.completedAt && row.acknowledgedAt)).toBe(true);
      for (const audit of state.audits) expect(audit.afterMarker).toEqual({ status: "DELETED", projectId: f.scope.projectId, currentKeyRemoved: true });
      expect(await runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.sourceRevision.findUnique({ where: { id: first }, select: { rawArtifactHash: true, rawStorageKey: true } })))
        .toEqual({ rawArtifactHash: hash(1), rawStorageKey: `source-artifacts/${hash(1)}` });
      expect(evidence.workerCuts).toBeGreaterThan(0);
    } finally { sdk.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("keeps an unknown reply PENDING across restart without second DELETE while independent work proceeds", async () => {
    const f = await fixture(); await f.revision(1); await f.revision(2);
    const sdk = f.sdk(async (sha) => { if (sha === hash(1)) throw new Error("SYNTHETIC_REPLY_LOST"); return { $metadata: { httpStatusCode: 204, attempts: 1 } }; });
    try {
      expect(await f.run(undefined, "1")).toMatchObject({ unknown: 1, deleted: 0 });
      expect(await f.run(undefined, "1")).toMatchObject({ unknown: 1, deleted: 1 });
      expect(await f.run()).toMatchObject({ unknown: 1, deleted: 0 }); expect(sdk).toHaveBeenCalledTimes(2);
      const state = await f.read(); expect(state.journals.find((row) => row.rawArtifactHash === hash(1)))
        .toMatchObject({ status: "PENDING", lastFailureCode: "RAW_DELETE_IO_UNKNOWN", acknowledgedAt: null, completedAt: null });
      expect(state.audits).toHaveLength(1);
    } finally { sdk.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("recovers ACK after a real audit-transaction rollback with zero repeated provider IO", async () => {
    const f = await fixture(); await f.revision(1); const sdk = f.sdk(); evidence.failAudit = true;
    try {
      expect(await f.run()).toMatchObject({ unknown: 1, deleted: 0 });
      let state = await f.read(); expect(state.journals[0]).toMatchObject({ status: "ACKNOWLEDGED", completedAt: null }); expect(state.audits).toHaveLength(0);
      vi.stubEnv("PROJECT_STORAGE_BINDINGS", "invalid");
      expect(await f.run()).toMatchObject({ recovered: 1, deleted: 0, unknown: 0 }); expect(sdk).toHaveBeenCalledOnce();
      state = await f.read(); expect(state.journals[0]).toMatchObject({ status: "DELETED" }); expect(state.audits).toHaveLength(1);
    } finally { evidence.failAudit = false; sdk.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("rejects known configuration errors before PENDING and admits after configuration is corrected", async () => {
    const f = await fixture(); await f.revision(1); const sdk = f.sdk();
    const bindings = process.env.PROJECT_STORAGE_BINDINGS;
    try {
      vi.stubEnv("PROJECT_STORAGE_BINDINGS", "invalid");
      await expect(f.run()).rejects.toThrow("PROJECT_STORAGE_BINDINGS_INVALID");
      vi.stubEnv("PROJECT_STORAGE_BINDINGS", bindings);
      vi.stubEnv("SYNTHETIC_DELETE_SECRET", "");
      await expect(f.run()).rejects.toThrow("PROJECT_STORAGE_CONFIGURATION_INVALID");
      vi.stubEnv("SYNTHETIC_DELETE_SECRET", "synthetic-delete");
      vi.stubEnv("SYNTHETIC_DELETE_ENDPOINT", "http://synthetic.invalid");
      await expect(f.run()).rejects.toThrow("PROJECT_STORAGE_CONFIGURATION_INVALID");
      expect((await f.read()).journals).toHaveLength(0); expect(sdk).not.toHaveBeenCalled();
      vi.stubEnv("SYNTHETIC_DELETE_ENDPOINT", "https://synthetic.invalid");
      expect(await f.run()).toMatchObject({ deleted: 1, unknown: 0 }); expect(sdk).toHaveBeenCalledOnce();
      expect((await f.read()).journals[0]).toMatchObject({ status: "DELETED" });
    } finally { sdk.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("holds its guardian through cancellation and unknown settlement, never releasing while owned DELETE is pending", async () => {
    const f = await fixture(); await f.revision(1); const controller = new AbortController();
    let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
    let finish!: () => void; const released = new Promise<void>((resolve) => { finish = resolve; });
    const sdk = f.sdk(async (_sha, signal) => { entered(); await released; expect(signal?.aborted).toBe(true); throw new Error("SYNTHETIC_ABORT_REPLY_UNKNOWN"); });
    const runtime = f.run(controller.signal); let joined = false;
    try {
      await started;
      expect((await f.read()).journals[0]).toMatchObject({ status: "PENDING" });
      await expect(acquireRawArtifactLifetimeGuard(getPrismaPool(), { ...f.scope, rawArtifactHash: hash(1) }, "producer")).rejects.toThrow("RAW_ARTIFACT_BUSY");
      controller.abort();
      await expect(acquireRawArtifactLifetimeGuard(getPrismaPool(), { ...f.scope, rawArtifactHash: hash(1) }, "producer")).rejects.toThrow("RAW_ARTIFACT_BUSY");
      finish(); expect(await runtime).toMatchObject({ unknown: 1, deleted: 0 }); joined = true;
      const producer = await acquireRawArtifactLifetimeGuard(getPrismaPool(), { ...f.scope, rawArtifactHash: hash(1) }, "producer"); await producer.release();
      expect((await f.read()).journals[0]).toMatchObject({ status: "PENDING", lastFailureCode: "RAW_DELETE_IO_UNKNOWN" });
      expect(await f.run()).toMatchObject({ unknown: 1 }); expect(sdk).toHaveBeenCalledOnce();
    } finally { controller.abort(); finish(); if (!joined) await runtime.catch(() => undefined); sdk.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("cannot acknowledge even a success reply after losing its exact guardian during DELETE", async () => {
    const f = await fixture(); await f.revision(1);
    let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
    let finish!: () => void; const held = new Promise<void>((resolve) => { finish = resolve; });
    let lost!: () => void; const aborted = new Promise<void>((resolve) => { lost = resolve; });
    const sdk = f.sdk(async (_sha, signal) => {
      if (!signal) throw new Error("SYNTHETIC_DELETE_SIGNAL_REQUIRED");
      signal.addEventListener("abort", lost, { once: true }); entered();
      try { await held; return { $metadata: { httpStatusCode: 204, attempts: 1 } }; }
      finally { signal.removeEventListener("abort", lost); }
    });
    const runtime = f.run(); let joined = false;
    try {
      await started;
      const key = rawArtifactLifetimeGuardKey({ ...f.scope, rawArtifactHash: hash(1) });
      const pool = getPrismaPool();
      // Only this fixture's exclusive SHA guardian in the isolated test DB.
      // Verify exact scope lock, both nonce markers, and session ownership.
      const owned = await pool.query<{ pid: number; locks: number }>(`SELECT l.pid,
        (SELECT count(*)::integer FROM pg_locks n WHERE n.pid=l.pid AND n.locktype='advisory'
          AND n.granted AND n.database=l.database) AS locks
        FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
        WHERE l.locktype='advisory' AND l.granted AND l.mode='ExclusiveLock' AND l.objsubid=2
          AND l.classid::bigint=$1::bigint AND l.objid::bigint=$2::bigint
          AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
          AND a.datname=current_database() AND a.usename=current_user`, [key[0] >>> 0, key[1] >>> 0]);
      expect(owned.rows).toHaveLength(1); expect(owned.rows[0]!.locks).toBe(3);
      expect((await pool.query("SELECT pg_terminate_backend($1::integer) AS terminated", [owned.rows[0]!.pid])).rows)
        .toEqual([{ terminated: true }]);
      await aborted; finish(); expect(await runtime).toMatchObject({ deleted: 0, unknown: 1 }); joined = true;
      const state = await f.read(); expect(state.journals[0]).toMatchObject({ status: "PENDING",
        lastFailureCode: "RAW_DELETE_LEASE_LOST", acknowledgedAt: null, completedAt: null }); expect(state.audits).toHaveLength(0);
      expect(await f.run()).toMatchObject({ deleted: 0, unknown: 1 }); expect(sdk).toHaveBeenCalledOnce();
    } finally { finish(); if (!joined) await runtime.catch(() => undefined); sdk.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("preserves last three GOOD plus recent references and an old captured root outside both windows", async () => {
    const f = await fixture(); const revisions: string[] = [];
    for (let index = 1; index <= 4; index++) revisions.push(await f.revision(index, "GOOD"));
    await f.revision(5, "FAILED", true);
    const sdk = f.sdk();
    try {
      await runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.source.update({ where: { id: f.source.id }, data: { lastGoodRevisionId: revisions[0]! } }));
      const capture = await captureSnapshotInput({ kind: "project-job", jobName: "snapshot-input", ...f.scope, correlationId: randomUUID() },
        { ...f.scope, schemaMinor: 0, idempotencyKey: randomUUID() }); expect(capture.publishSequence).toBe(1);
      await runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.source.update({ where: { id: f.source.id }, data: { lastGoodRevisionId: revisions[3]! } }));
      expect(await f.run()).toMatchObject({ deleted: 0, retained: 5 }); expect(sdk).not.toHaveBeenCalled(); expect((await f.read()).journals).toHaveLength(0);
    } finally { sdk.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("retains a SHA shared by another Source head, with project isolation and frozen admission", async () => {
    const f = await fixture(); await f.revision(1); const sdk = f.sdk();
    try {
      const other = await runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.source.create({ data: { ...f.scope, sourceKey: "synthetic-other", name: "Synthetic other",
        adapterKey: f.source.adapterKey, adapterVersion: f.source.adapterVersion, profileKey: f.source.profileKey, profileVersion: f.source.profileVersion,
        datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" }, enabled: false } }));
      const pinned = await f.revision(1, "GOOD", false, other.id);
      await runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.source.update({ where: { id: other.id }, data: { lastGoodRevisionId: pinned } }));
      expect(await f.run()).toMatchObject({ deleted: 0, retained: 1 }); expect(sdk).not.toHaveBeenCalled();
      await f.revision(2); await runInPrincipalDatabaseTransaction(f.admin, (tx) => tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } }));
      expect(await f.run()).toMatchObject({ deleted: 0, retained: 2 }); expect(sdk).not.toHaveBeenCalled();
      const rows = await runInAuthorizedDatabaseTransaction({ principalKind: "project-job", actorId: "raw-artifact-retention",
        organizationId: "synthetic-foreign", projectIds: [f.scope.projectId], correlationId: randomUUID() },
      (tx) => tx.rawArtifactDeletion.findMany({ where: f.scope })); expect(rows).toHaveLength(0);
    } finally { sdk.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("rejects invalid command scope/bounds and avoids all IO for pre-cancelled work", async () => {
    const f = await fixture(); await f.revision(1); const sdk = f.sdk();
    try {
      expect(() => runRawArtifactRetentionCommand([], new AbortController().signal)).toThrow("RAW_RETENTION_COMMAND_INVALID");
      expect(() => runRawArtifactRetentionCommand([f.scope.organizationId, f.scope.projectId, "51"], new AbortController().signal)).toThrow();
      expect(() => runRawArtifactRetentionCommand([f.scope.organizationId, "../foreign"], new AbortController().signal)).toThrow();
      expect(await f.run(AbortSignal.abort())).toMatchObject({ deleted: 0, unknown: 0 }); expect(sdk).not.toHaveBeenCalled();
    } finally { sdk.mockRestore(); vi.unstubAllEnvs(); }
  });
});
