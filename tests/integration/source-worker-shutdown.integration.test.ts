import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import { getSourceWorkerReadiness } from "../../src/modules/platform-operations/server.ts";
import { SOURCE_IMPORT_QUEUE, sourceManualJobId } from "../../src/modules/ingestion-core/worker.ts";
import { getPgBoss, stopPgBoss } from "../../src/modules/platform-operations/worker.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import { getPrismaPool } from "../../src/platform/database/prisma/client.ts";
import { acquireSourceExecutionGuard } from "../../src/modules/ingestion-core/infrastructure/source-execution-guard.ts";
import { acquirePermanentOutboxWorkerGuard } from "../../src/modules/platform-operations/infrastructure/permanent-worker-guard.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";

const evidence = process.platform === "win32" ? "Windows registered SIGTERM handler via IPC (not Unix OS signal)" : "actual OS SIGTERM";
async function eventually<T>(read: () => Promise<T>, ready: (value: T) => boolean, timeout = 30_000): Promise<T> {
  const until = Date.now() + timeout;
  while (true) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() >= until) throw new Error("SYNTHETIC_SHUTDOWN_WAIT_TIMEOUT");
    await new Promise((done) => setTimeout(done, 25));
  }
}
function childWorker(env: NodeJS.ProcessEnv, mode: string) {
  const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "tests/helpers/source-worker-shutdown-process.ts"], {
    cwd: resolve(import.meta.dirname, "../.."), env: { ...env, SYNTHETIC_SHUTDOWN_MODE: mode }, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const events = new Set<string>();
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-16_384); });
  // Do not forward child diagnostics: database credentials are ENV-only.
  child.stderr?.on("data", () => undefined);
  child.on("message", (message: unknown) => {
    if (message && typeof message === "object" && "event" in message && typeof message.event === "string") events.add(message.event);
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, reject) => {
    child.once("error", () => reject(new Error("SYNTHETIC_CHILD_START_FAILED")));
    child.once("close", (code, signal) => done({ code, signal }));
  });
  return { child, exited, event: (name: string) => eventually(async () => events.has(name), Boolean),
    stopped: () => output.includes("source_worker_stopped"), timedOut: () => output.includes("WORKER_SHUTDOWN_TIMEOUT"),
    guardLost: () => output.includes("WORKER_GUARD_LOST") };
}
function stop(child: ChildProcess) {
  if (process.platform === "win32") child.send("emit-sigterm");
  else child.kill("SIGTERM");
}
async function waitExit(worker: ReturnType<typeof childWorker>, timeout = 15_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([worker.exited, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("SYNTHETIC_CHILD_EXIT_TIMEOUT")), timeout);
  })]); } finally { clearTimeout(timer); }
}
async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-shutdown-admin", correlationId: randomUUID() };
  const scope = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const org = await tx.organization.create({ data: { name: "Synthetic shutdown", slug: `shutdown-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic shutdown", slug: `shutdown-${suffix}` } });
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
      update: { jobsFrozen: false, unfrozenAt: new Date() } });
    return { organizationId: org.id, projectId: project.id };
  });
  const source = await sourceRegistryCommands.createSource(admin, { ...scope, sourceKey: "synthetic", name: "Synthetic shutdown",
    endpointCredentialRef: "SYNTHETIC_SHUTDOWN_FEED", adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "default-v1", profileVersion: "1.0.0",
    datasetType: "MIXED_REALTY", transportType: "HTTPS_XML", sharingPolicy: "PROJECT_ONLY", schedulePolicy: { mode: "MANUAL_ONLY" },
    safetyPolicyId: "", expectedNamespace: "", expectedProducer: "" });
  const target = { ...scope, sourceId: source.sourceId };
  await sourceRegistryCommands.setSourceEnabled(admin, { ...target, version: source.version, enabled: true });
  const directory = await mkdtemp(join(tmpdir(), "ams-shutdown-proof-"));
  const env = { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory,
    APP_ENV: "test", OUTBOX_WORKER_ID: `shutdown-${suffix}`, OUTBOX_POLL_DELAY_MS: "10", OUTBOX_SHUTDOWN_DRAIN_TIMEOUT_MS: "3000",
    SYNTHETIC_SHUTDOWN_FEED: "https://synthetic-shutdown.example.invalid/feed.xml",
    PROJECT_STORAGE_BINDINGS: JSON.stringify([{ ...scope, bucketRef: "SYNTHETIC_SHUTDOWN_BUCKET", endpointRef: "SYNTHETIC_SHUTDOWN_ENDPOINT",
      regionRef: "SYNTHETIC_SHUTDOWN_REGION", accessKeyIdRef: "SYNTHETIC_SHUTDOWN_ACCESS", secretAccessKeyRef: "SYNTHETIC_SHUTDOWN_SECRET" }]),
    SYNTHETIC_SHUTDOWN_BUCKET: `synthetic-shutdown-${suffix}`, SYNTHETIC_SHUTDOWN_ENDPOINT: "https://s3.twcstorage.ru",
    SYNTHETIC_SHUTDOWN_REGION: "ru-1", SYNTHETIC_SHUTDOWN_ACCESS: "synthetic-shutdown-access", SYNTHETIC_SHUTDOWN_SECRET: "synthetic-shutdown-secret" };
  const workers: ReturnType<typeof childWorker>[] = [];
  const launch = (mode: string) => { const worker = childWorker(env, mode); workers.push(worker); return worker; };
  const healthcheck = (workerId = env.OUTBOX_WORKER_ID) => {
    const worker = childWorker({ ...env, OUTBOX_WORKER_ID: workerId }, "healthcheck"); workers.push(worker); return worker;
  };
  const readiness = () => getSourceWorkerReadiness(env.OUTBOX_WORKER_ID);
  const request = (key: string) => sourceRegistryCommands.requestManualSourceRun(admin, { ...target, idempotencyKey: `${key}-${suffix}` });
  const read = () => runInPrincipalDatabaseTransaction(admin, async (tx) => ({
    source: await tx.source.findUniqueOrThrow({ where: { id: target.sourceId } }),
    identities: await tx.inventoryIdentity.findMany({ where: target, orderBy: { externalOfferId: "asc" } }),
    events: await tx.inventoryLifecycleEvent.findMany({ where: { ...scope, inventory: { sourceId: target.sourceId } }, orderBy: { occurredAt: "asc" } }),
    intents: await tx.outboxEvent.findMany({ where: { organizationId: scope.organizationId, topic: "snapshot.build.request",
      payload: { path: ["projectId"], equals: scope.projectId } }, orderBy: { occurredAt: "asc" } }),
    requests: await tx.sourceManualRunRequest.findMany({ where: target }),
    revisions: await tx.sourceRevision.findMany({ where: target, orderBy: { startedAt: "asc" } }),
  }));
  const nativeJob = async (id: string) => {
    const boss = await getPgBoss();
    // Actual child reconciliation creates the queue; do not precreate it in the fixture.
    if (!await boss.getQueue(SOURCE_IMPORT_QUEUE)) return null;
    return boss.getJobById(SOURCE_IMPORT_QUEUE, sourceManualJobId(id));
  };
  const spools = async () => (await readdir(directory)).filter((name) => name.startsWith("ams-data-hub-raw-"));
  const assertLocksFree = async () => {
    const lease = await acquireSourceExecutionGuard(getPrismaPool(), target); await lease.release();
    const release = await acquirePermanentOutboxWorkerGuard(getPrismaPool()); await release();
  };
  const cleanup = async () => {
    for (const worker of workers) if (worker.child.exitCode === null && worker.child.signalCode === null) {
      worker.child.kill("SIGKILL"); await worker.exited;
    }
    await stopPgBoss();
    // Exact mkdtemp-owned test directory only; never remove other spool artifacts.
    await rm(directory, { recursive: true, force: true });
  };
  return { admin, target, directory, launch, healthcheck, readiness, request, read, nativeJob, spools, assertLocksFree, cleanup };
}

describe(`actual source-worker child shutdown: ${evidence}; synthetic transport, owner-login DB (not queue ACL proof)`, () => {
  it("qualifies only its exact owner and refreshes during a stalled import; read-only CLI and shutdown agree", async () => {
    const context = await setup();
    try {
      expect((await context.readiness()).heartbeat.status).toBe("unknown");
      await context.request("health-stall"); const worker = context.launch("upload"); await worker.event("upload-consumed");
      const initial = await eventually(context.readiness, (value) => value.heartbeat.status === "healthy");
      expect(initial).toMatchObject({ pgBoss: "connected", sourceConsumer: "active" });
      expect(await waitExit(context.healthcheck(), 30_000)).toEqual({ code: 0, signal: null });
      expect(await waitExit(context.healthcheck("absent-owner"), 30_000)).toEqual({ code: 1, signal: null });
      const next = await eventually(context.readiness, (value) => value.heartbeat.status === "healthy"
        && value.heartbeat.lastHeartbeatAt !== initial.heartbeat.lastHeartbeatAt, 45_000);
      expect(next.heartbeat.lastHeartbeatAt).not.toBe(initial.heartbeat.lastHeartbeatAt);
      stop(worker.child); expect(await waitExit(worker)).toEqual({ code: 0, signal: null });
      expect(await context.readiness()).toMatchObject({ pgBoss: "unconfirmed", sourceConsumer: "unconfirmed", heartbeat: { status: "unknown" } });
      expect(await waitExit(context.healthcheck(), 30_000)).toEqual({ code: 1, signal: null });
      expect(await context.spools()).toEqual([]); await context.assertLocksFree();
    } finally { await context.cleanup(); }
  }, 120_000);

  it("loss of the original permanent guardian stops the actual CLI and releases its locks", async () => {
    const context = await setup();
    try {
      await context.request("guardian-loss"); const worker = context.launch("upload"); await worker.event("upload-consumed");
      const lock = await getPrismaPool().query<{ pid: number }>("SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 4278803 AND objid = 17311 AND objsubid = 2 AND granted");
      expect(lock.rows).toHaveLength(1);
      await getPrismaPool().query("SELECT pg_terminate_backend($1)", [lock.rows[0]!.pid]);
      expect(await waitExit(worker)).toEqual({ code: 1, signal: null }); expect(worker.guardLost()).toBe(true); expect(worker.stopped()).toBe(false);
      await context.assertLocksFree(); const facts = await context.read();
      expect(facts.source.lastGoodRevisionId).toBeNull(); expect(facts.identities).toEqual([]);
      // Fatal loss can leave a TTL-qualified row and a crash orphan in this exact test-owned directory.
    } finally { await context.cleanup(); }
  }, 60_000);
  it.each(["headers", "upload"])("%s abort preserves durable retry/manual state, LastGood and clean spool; restart succeeds", async (mode) => {
    const context = await setup();
    try {
      const baselineRequest = await context.request("baseline");
      const baselineWorker = context.launch("good");
      await eventually(() => context.nativeJob(baselineRequest.requestId), (job) => job?.state === "completed");
      stop(baselineWorker.child); expect(await waitExit(baselineWorker)).toEqual({ code: 0, signal: null });
      const baseline = await context.read(); expect(baseline.identities).toHaveLength(1);
      const requested = await context.request("abort");
      const worker = context.launch(mode);
      await worker.event(mode === "headers" ? "headers-requested" : "upload-consumed");
      const before = await context.nativeJob(requested.requestId); expect(before?.state).toBe("active");
      if (mode === "upload") expect(await context.spools()).not.toEqual([]);
      stop(worker.child); expect(await waitExit(worker)).toEqual({ code: 0, signal: null }); expect(worker.stopped()).toBe(true);
      expect(await context.spools()).toEqual([]); await context.assertLocksFree();
      const job = await context.nativeJob(requested.requestId);
      expect(job).toMatchObject({ state: "created", retryCount: before!.retryCount, output: { status: "DEFERRED", code: "WORKER_SHUTDOWN" }, startedOn: null });
      const after = await context.read();
      expect(after.requests.find((item) => item.id === requested.requestId)?.status).toBe("CLAIMED");
      expect(after.source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
      expect(after.identities).toEqual(baseline.identities); expect(after.events).toEqual(baseline.events); expect(after.intents).toEqual(baseline.intents);
      expect(after.revisions.at(-1)).toMatchObject({ status: "FAILED", failureCode: "SOURCE_EXECUTION_ABORTED" });
      // Advance only the synthetic deferred delay. Preserve the native row and budget.
      await (await getPgBoss()).update(SOURCE_IMPORT_QUEUE, undefined, { id: sourceManualJobId(requested.requestId), startAfter: new Date() });
      const recovered = context.launch("good");
      await eventually(() => context.nativeJob(requested.requestId), (value) => value?.state === "completed");
      stop(recovered.child); expect(await waitExit(recovered)).toEqual({ code: 0, signal: null });
      const final = await context.read(); expect(final.requests.find((item) => item.id === requested.requestId)?.status).toBe("COMPLETED");
      expect(final.revisions.filter((revision) => revision.status === "GOOD")).toHaveLength(2);
      expect(final.identities[0]!.uid).toBe(baseline.identities[0]!.uid);
    } finally { await context.cleanup(); }
  }, 100_000);

  it("GOOD committed before blocked native ACK survives shutdown without a second import", async () => {
    const context = await setup(); let blocker: PoolClient | undefined;
    try {
      const requested = await context.request("good-before-ack"); const worker = context.launch("upload"); await worker.event("upload-consumed");
      blocker = await getPrismaPool().connect(); await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM pgboss.job WHERE name = $1 AND id = $2::uuid FOR UPDATE", [SOURCE_IMPORT_QUEUE, sourceManualJobId(requested.requestId)]);
      worker.child.send("release-upload");
      const committed = await eventually(context.read, (value) => value.requests.some((item) => item.id === requested.requestId && item.status === "COMPLETED"));
      expect((await context.nativeJob(requested.requestId))?.state).toBe("active");
      stop(worker.child); await blocker.query("COMMIT"); blocker.release(); blocker = undefined;
      expect(await waitExit(worker)).toEqual({ code: 0, signal: null }); expect(worker.stopped()).toBe(true);
      expect((await context.nativeJob(requested.requestId))?.state).toBe("completed");
      expect(await context.spools()).toEqual([]); await context.assertLocksFree();
      const restart = context.launch("good");
      await eventually(async () => (await getPrismaPool().query("SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 4278803 AND objid = 17311 AND granted")).rowCount, (count) => count === 1);
      stop(restart.child); expect(await waitExit(restart)).toEqual({ code: 0, signal: null });
      const final = await context.read(); expect(final.revisions).toEqual(committed.revisions); expect(final.identities).toEqual(committed.identities); expect(final.intents).toEqual(committed.intents);
    } finally { if (blocker) { await blocker.query("ROLLBACK"); blocker.release(); } await context.cleanup(); }
  }, 100_000);

  it("noncancellable SDK reaches fatal deadline, not fake graceful success; job remains durable", async () => {
    const context = await setup();
    try {
      const requested = await context.request("fatal"); const worker = context.launch("fatal"); await worker.event("upload-consumed");
      const before = await context.nativeJob(requested.requestId); stop(worker.child);
      expect(await waitExit(worker)).toEqual({ code: 1, signal: null }); expect(worker.timedOut()).toBe(true); expect(worker.stopped()).toBe(false);
      const after = await context.nativeJob(requested.requestId); expect(after).toMatchObject({ state: "active", retryCount: before!.retryCount });
      const facts = await context.read(); expect(facts.source.lastGoodRevisionId).toBeNull(); expect(facts.identities).toEqual([]); expect(facts.intents).toEqual([]);
      expect(facts.requests.find((item) => item.id === requested.requestId)?.status).toBe("CLAIMED");
      await context.assertLocksFree();
      // Crash-orphan cleanup is intentionally not asserted: fatal termination
      // cannot run finally. This private directory is removed by test cleanup.
      expect(await context.spools()).not.toEqual([]);
    } finally { await context.cleanup(); }
  }, 60_000);
});
