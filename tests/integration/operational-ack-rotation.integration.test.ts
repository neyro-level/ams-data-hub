import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ afterInspection: null as (() => Promise<void>) | null, afterBegin: null as (() => Promise<void>) | null }));
vi.mock("../../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = async (context, execute, options) => {
    const result = await actual.runInAuthorizedDatabaseTransaction(context, async (tx) => {
      if (context.principalKind === "project-job" || context.principalKind === "system-job") {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]);
      }
      return execute(tx);
    },options);
    if (context.actorId === "operations-executor" && context.correlationId === "synthetic-ack-execution" && hooks.afterBegin) {
      const hook = hooks.afterBegin; hooks.afterBegin = null; await hook();
    }
    if (context.actorId === "snapshot-ack-rotation" && context.correlationId === "synthetic-ack-execution" && hooks.afterInspection) {
      const hook = hooks.afterInspection; hooks.afterInspection = null; await hook();
    }
    return result;
  };
  const principal: typeof actual.runInPrincipalDatabaseTransaction = (input, execute) => authorized(actual.createDatabaseAuthorizationContext(input),execute);
  const system: typeof actual.runInSystemJobDatabaseTransaction = (input, execute) => authorized(actual.createSystemJobDatabaseAuthorizationContext(input),execute);
  return { ...actual, runInAuthorizedDatabaseTransaction: authorized, runInPrincipalDatabaseTransaction: principal, runInSystemJobDatabaseTransaction: system };
});
import { createOperationalAckRotationExecutor, requestOperationalAction } from "../../src/modules/operations-control/server.ts";
import { OperationalActionLifecycleRepository } from "../../src/modules/operations-control/infrastructure/operational-action-lifecycle.ts";
import { OPERATIONAL_ACTION_TOPICS } from "../../src/modules/operations-control/index.ts";
import { ReliabilityService } from "../../src/modules/platform-operations/application/reliability-service.ts";
import { PrismaReliabilityRepository } from "../../src/modules/platform-operations/infrastructure/prisma-reliability-repository.ts";
import { PrismaSnapshotDeliveryRepository } from "../../src/modules/snapshot-delivery/server.ts";
import { createSnapshotAckService, hashProjectAckToken } from "../../src/modules/snapshot-delivery/index.ts";
import { runInPrincipalDatabaseTransaction, runInAuthorizedDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { runSourceWorker } from "../../src/infrastructure/source-worker-runtime.ts";
import { createOperationalAckRotationCapability } from "../../src/infrastructure/ack-rotation-capability.ts";
import { getPgBoss, stopPgBoss, recordSourceWorkerHeartbeat } from "../../src/modules/platform-operations/worker.ts";
import { SOURCE_IMPORT_QUEUE } from "../../src/modules/ingestion-core/worker.ts";

describe("real request-owned operational ACK rotation", () => {
  it.each(["enabled", "disabled", "invalid", "recovery", "replay"])("registers actual combined-worker ACK with pg-boss: %s", async (mode) => {
    const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-ack-runtime", correlationId: randomUUID() };
    const suffix = randomUUID(); const workerId = `synthetic-ack-${suffix}`;
    const scope = await runInPrincipalDatabaseTransaction(admin,async (tx) => {
      const org = await tx.organization.create({ data: { name: "Synthetic runtime ACK", slug: `ack-worker-${suffix}` } });
      const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic runtime ACK", slug: `ack-worker-${suffix}` } });
      const scope = { organizationId: org.id, projectId: project.id };
      await tx.projectAckCredential.create({ data: { ...scope, currentTokenHash: hashProjectAckToken(randomBytes(32).toString("base64url")) } });
      await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() }, update: { jobsFrozen: false, unfrozenAt: new Date() } });
      return scope;
    });
    const accepted = await requestOperationalAction(admin,{ ...scope,action: "ACK_ROTATE",ackRotationPhase: "STAGE",ackCredentialVersion: 1,
      sourceId: "", sourceRevisionId: "", reason: "", idempotencyKey: randomUUID() });
    const eventId = await runInPrincipalDatabaseTransaction(admin,async (tx) => {
      const row = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } });
      if (!row.outboxEventId) throw new Error("SYNTHETIC_ACK_EVENT_MISSING");
      await tx.outboxEvent.update({ where: { id: row.outboxEventId },data: { availableAt: new Date("1992-01-01T00:00:00Z") } }); return row.outboxEventId;
    });
    for (const flag of ["SNAPSHOT_BUILD_ENABLED","SNAPSHOT_PUBLISH_ENABLED","SNAPSHOT_ROLLBACK_ENABLED"]) vi.stubEnv(flag,"false");
    vi.stubEnv("ACK_ROTATION_ENABLED",mode === "disabled" ? "false" : "true");
    vi.stubEnv("PROJECT_ACK_ROTATION_BINDINGS",JSON.stringify([{ ...scope,nextTokenRef: "SYNTHETIC_ACK_NEXT" }]));
    vi.stubEnv("SYNTHETIC_ACK_NEXT",randomBytes(32).toString("base64url"));
    vi.stubEnv("PROJECT_STORAGE_BINDINGS",JSON.stringify([{ ...scope,bucketRef: "SYNTHETIC_ACK_BUCKET",endpointRef: "SYNTHETIC_ACK_ENDPOINT",
      regionRef: "SYNTHETIC_ACK_REGION",accessKeyIdRef: "SYNTHETIC_ACK_ACCESS",secretAccessKeyRef: "SYNTHETIC_ACK_SECRET" }]));
    vi.stubEnv("SYNTHETIC_ACK_BUCKET","synthetic-ack-runtime"); vi.stubEnv("SYNTHETIC_ACK_ENDPOINT","https://s3.twcstorage.ru");
    vi.stubEnv("SYNTHETIC_ACK_REGION","ru-1"); vi.stubEnv("SYNTHETIC_ACK_ACCESS","synthetic-access"); vi.stubEnv("SYNTHETIC_ACK_SECRET","synthetic-secret");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(),60_000);
    let completeSpy: { mockRestore(): void } | undefined; let fetchSpy: { mockRestore(): void } | undefined; let queueJobId: string | undefined;
    try {
      if (mode === "recovery" || mode === "replay") {
        const reliability = new ReliabilityService(new PrismaReliabilityRepository(),() => new Date("1992-01-01T00:00:01Z"));
        const lease = await reliability.claim("synthetic-ack-before-crash",300_000,[OPERATIONAL_ACTION_TOPICS.ACK_ROTATE]);
        if (!lease || lease.outboxEventId !== eventId) throw new Error("SYNTHETIC_ACK_LEASE_MISSING");
        const execute = createOperationalAckRotationCapability(); if (!execute) throw new Error("SYNTHETIC_ACK_CAPABILITY_MISSING");
        if (mode === "recovery") {
          const actual = OperationalActionLifecycleRepository.prototype.succeedRotatedAck;
          const crash = vi.spyOn(OperationalActionLifecycleRepository.prototype,"succeedRotatedAck").mockImplementationOnce(async function (this: OperationalActionLifecycleRepository, pending, result) {
            await actual.call(this,pending,result); throw new Error("SYNTHETIC_ACK_AFTER_SUCCESS_CRASH");
          });
          try { await expect(execute(lease)).rejects.toThrow("SYNTHETIC_ACK_AFTER_SUCCESS_CRASH"); } finally { crash.mockRestore(); }
          expect(await runInPrincipalDatabaseTransaction(admin,(tx) => tx.projectAckCredential.findUniqueOrThrow({ where: { organizationId_projectId: scope },select: { version: true } }))).toEqual({ version: 1 });
        } else {
          await expect(execute(lease)).resolves.toMatchObject({ action: "ACK_ROTATE",phase: "STAGE",credentialVersion: 2 });
          await runInPrincipalDatabaseTransaction(admin,async (tx) => {
            await tx.project.update({ where: { id: scope.projectId },data: { serviceState: "SUSPENDED" } });
            await tx.dataSafetyState.update({ where: { id: "global" },data: { jobsFrozen: true } });
          });
          vi.stubEnv("SYNTHETIC_ACK_NEXT",""); // Replay does not resolve its configured secret.
        }
      }
      if (["disabled","invalid"].includes(mode)) vi.stubEnv("PROJECT_ACK_ROTATION_BINDINGS","invalid");
      if (mode === "invalid") {
        await recordSourceWorkerHeartbeat(workerId);
        await expect(runSourceWorker({ workerId,signal: controller.signal,pollIntervalMs: 10 })).rejects.toThrow("ACK_ROTATION_BINDINGS_INVALID");
      } else {
        const boss = await getPgBoss(); const complete = boss.complete.bind(boss); const fetch = boss.fetch.bind(boss);
        completeSpy = vi.spyOn(boss,"complete").mockImplementation(async (name,id,data,options) => {
          const queued = name === "outbox.dispatch" && typeof id === "string" ? await boss.getJobById(name,id) : null;
          const result = await complete(name,id,data,options);
          if ((queued?.data as { event?: { outboxEventId?: string } } | undefined)?.event?.outboxEventId === eventId) {
            queueJobId = queued!.id; expect(data).toEqual({ status: "success" });
            const deadline = Date.now()+2000; let active = false;
            while (!active && Date.now()<deadline) {
              active = await runInPrincipalDatabaseTransaction(admin,async (tx) => await tx.runtimeHeartbeat.count({ where: { runtime: "source-worker",workerId } })===1);
              if (!active) await new Promise((resolve) => setTimeout(resolve,10));
            }
            expect(active).toBe(true); controller.abort();
          }
          return result;
        });
        fetchSpy = vi.spyOn(boss,"fetch").mockImplementation(async (name,options) => { const result = await fetch(name,options);
          if (mode === "disabled" && name === SOURCE_IMPORT_QUEUE) controller.abort(); return result; });
        await expect(runSourceWorker({ workerId,signal: controller.signal,pollIntervalMs: 10 })).resolves.toEqual({ fetched: 0,completed: 0,failed: 0 });
        if (mode !== "disabled") expect((await (await getPgBoss()).getJobById("outbox.dispatch",queueJobId!))?.state).toBe("completed");
      }
      const executed = !["disabled","invalid"].includes(mode);
      await runInPrincipalDatabaseTransaction(admin,async (tx) => {
        expect((await tx.projectAckCredential.findUniqueOrThrow({ where: { organizationId_projectId: scope } })).version).toBe(executed ? 2 : 1);
        expect((await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } })).status).toBe(executed ? "SUCCEEDED" : "REQUESTED");
        expect((await tx.outboxEvent.findUniqueOrThrow({ where: { id: eventId } })).status).toBe(executed ? "PROCESSED" : "PENDING");
        expect(await tx.runtimeHeartbeat.count({ where: { runtime: "source-worker",workerId } })).toBe(0);
        const jobs = await tx.jobRun.findMany({ where: { outboxEventId: eventId } });
        expect(jobs).toHaveLength(["recovery","replay"].includes(mode) ? 2 : executed ? 1 : 0);
        if (executed) expect(jobs.find((job) => job.status === "SUCCESS")).toMatchObject({ workerId });
        if (!executed) await tx.outboxEvent.update({ where: { id: eventId },data: { availableAt: new Date("2050-01-01T00:00:00Z") } });
      });
    } finally { controller.abort(); clearTimeout(timer); completeSpy?.mockRestore(); fetchSpy?.mockRestore(); await stopPgBoss(); vi.unstubAllEnvs(); }
  },90_000);
  it.each(["overlap", "late-failure", "late-cancel", "takeover", "project", "freeze", "missing", "same", "oversize", "stale", "scope", "concurrent",
    "race-stale", "race-config", "race-lease-lost"])("preserves atomic identity after %s", async (mode) => {
    const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-ack-admin", correlationId: randomUUID() };
    const currentToken = randomBytes(32).toString("base64url"); const nextToken = randomBytes(32).toString("base64url");
    const setup = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const suffix = randomUUID(); const org = await tx.organization.create({ data: { name: "Synthetic ACK", slug: `ack-${suffix}` } });
      const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic ACK", slug: `ack-${suffix}` } });
      const foreign = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic sibling", slug: `ack-b-${suffix}` } });
      const scope = { organizationId: org.id, projectId: project.id };
      await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
        update: { jobsFrozen: false, unfrozenAt: new Date() } });
      if (mode !== "missing") await tx.projectAckCredential.create({ data: { ...scope, currentTokenHash: hashProjectAckToken(currentToken) } });
      return { scope, foreignId: foreign.id };
    });
    const { scope } = setup; let now = new Date("1993-01-01T00:00:01Z");
    const reliability = new ReliabilityService(new PrismaReliabilityRepository(), () => now);
    const owned = new Map<string, NonNullable<Awaited<ReturnType<typeof reliability.claim>>>>();
    const accept = async (phase: "STAGE" | "PROMOTE", version: number) => {
      const accepted = await requestOperationalAction(admin, { ...scope, action: "ACK_ROTATE", ackRotationPhase: phase, ackCredentialVersion: version,
        sourceId: "", sourceRevisionId: "", reason: "", idempotencyKey: randomUUID() });
      const eventId = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
        const request = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } });
        await tx.outboxEvent.update({ where: { id: request.outboxEventId! }, data: { availableAt: new Date("1993-01-01T00:00:00Z"), correlationId: "synthetic-ack-execution" } });
        return request.outboxEventId;
      });
      const lease = await reliability.claim(`synthetic-ack-${randomUUID()}`,300_000,[OPERATIONAL_ACTION_TOPICS.ACK_ROTATE]);
      if (!lease || lease.outboxEventId !== eventId) throw new Error("SYNTHETIC_ACK_CLAIM_INVALID");
      owned.set(lease.outboxEventId,lease); return { requestId: accepted.requestId, lease };
    };
    const observer = <T>(execute: Parameters<typeof runInAuthorizedDatabaseTransaction<T>>[1], actorId = "snapshot-ack-rotation", projectIds: readonly string[] | "*" = [scope.projectId]) =>
      runInAuthorizedDatabaseTransaction({ principalKind: "project-job", actorId, organizationId: scope.organizationId, projectIds, correlationId: "synthetic-ack-observer" },execute,
        { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
    const environment: Record<string, string | undefined> = { SYNTHETIC_ACK_NEXT: mode === "same" ? currentToken : mode === "oversize" ? "x".repeat(513) : nextToken };
    const resolveNextTokenRef = vi.fn(() => "SYNTHETIC_ACK_NEXT");
    const execute = createOperationalAckRotationExecutor({ environment, resolveNextTokenRef });
    const controller = new AbortController(); const actual = OperationalActionLifecycleRepository.prototype.succeedRotatedAck;
    const succeed = vi.spyOn(OperationalActionLifecycleRepository.prototype,"succeedRotatedAck").mockImplementationOnce(async function (this: OperationalActionLifecycleRepository, lease, result) {
      const value = await actual.call(this,lease,result);
      if (mode === "late-failure") throw new Error("SYNTHETIC_AFTER_ACK_SUCCESS");
      if (mode === "late-cancel") controller.abort(); return value;
    });
    try {
      let first = await accept("STAGE",mode === "stale" ? 2 : 1);
      for (const altered of [{ ...first.lease, attempt: first.lease.attempt+1 }, { ...first.lease, workerId: "synthetic-forged" },
        { ...first.lease, jobRunId: "synthetic-forged" }, { ...first.lease, leaseAcquiredAt: "1993-01-01T00:00:02.000Z" }])
        await expect(execute(altered)).rejects.toThrow("OUTBOX_OPERATION_LEASE_LOST");
      expect(resolveNextTokenRef).not.toHaveBeenCalled();
      await observer((tx) => new OperationalActionLifecycleRepository(tx).begin(first.lease),"operations-executor");
      await expect(observer((tx) => tx.operationalActionRequest.update({ where: { id: first.requestId },data: { status: "SUCCEEDED",finishedAt: new Date(),
        result: { action: "ACK_ROTATE",phase: "STAGE",previousCredentialVersion: 1,credentialVersion: 2 } } }),"operations-executor"))
        .rejects.toThrow("OPERATIONS_CONTROL_RESULT_INVALID");
      if (mode.startsWith("race-")) {
        const concurrentCommit = async () => {
          await expect(execute(first.lease)).resolves.toMatchObject({ action: "ACK_ROTATE",credentialVersion: 2 });
          if (mode === "race-config") environment.SYNTHETIC_ACK_NEXT = undefined;
          if (mode === "race-lease-lost") {
            now = new Date("1993-01-01T00:06:00Z");
            const replacement = await reliability.claim("synthetic-ack-race-takeover",300_000,[OPERATIONAL_ACTION_TOPICS.ACK_ROTATE]);
            if (!replacement) throw new Error("SYNTHETIC_ACK_TAKEOVER_MISSING"); owned.set(replacement.outboxEventId,replacement);
          }
        };
        if (mode === "race-config") hooks.afterInspection = concurrentCommit; else hooks.afterBegin = concurrentCommit;
        if (mode === "race-lease-lost") await expect(execute(first.lease)).rejects.toThrow("ACK_CREDENTIAL_STALE");
        else await expect(execute(first.lease)).resolves.toMatchObject({ action: "ACK_ROTATE",credentialVersion: 2 });
        environment.SYNTHETIC_ACK_NEXT = nextToken;
      }
      if (mode === "scope") {
        for (const projects of [[], "*", [setup.foreignId], [scope.projectId,setup.foreignId]] as const)
          expect(await observer((tx) => tx.snapshotAckRotationReceipt.findMany(),"snapshot-ack-rotation",projects)).toEqual([]);
        expect(await observer((tx) => tx.snapshotAckRotationReceipt.findMany(),"operations-executor")).toEqual([]);
      }
      if (["takeover","project","freeze"].includes(mode)) hooks.afterInspection = async () => {
        if (mode === "takeover") { now = new Date("1993-01-01T00:06:00Z");
          const replacement = await reliability.claim("synthetic-ack-takeover",300_000,[OPERATIONAL_ACTION_TOPICS.ACK_ROTATE]);
          if (!replacement) throw new Error("SYNTHETIC_ACK_TAKEOVER_MISSING"); owned.set(replacement.outboxEventId,replacement); }
        if (mode === "project") await runInPrincipalDatabaseTransaction(admin,(tx) => tx.project.update({ where: { id: scope.projectId }, data: { serviceState: "SUSPENDED" } }));
        if (mode === "freeze") await runInPrincipalDatabaseTransaction(admin,(tx) => tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } }));
      };
      const error = { "late-failure": "SYNTHETIC_AFTER_ACK_SUCCESS", "late-cancel": "OPERATIONS_CONTROL_EXECUTION_CANCELLED", takeover: "OUTBOX_OPERATION_LEASE_LOST",
        project: "SOURCE_OPERATION_REVIEW_BLOCKED", freeze: "DATA_SAFETY_JOBS_FROZEN", missing: "ACK_CREDENTIAL_NOT_CONFIGURED",
        same: "ACK_ROTATION_CONFIGURATION_INVALID", oversize: "ACK_ROTATION_CONFIGURATION_INVALID", stale: "ACK_CREDENTIAL_STALE" }[mode];
      if (error) {
        await expect(execute(first.lease,controller.signal)).rejects.toThrow(error);
        await observer(async (tx) => {
          expect(await tx.snapshotAckRotationReceipt.count()).toBe(0);
          const credential = await tx.projectAckCredential.findFirst({ where: scope }); expect(credential?.version ?? null).toBe(mode === "missing" ? null : 1);
          expect(credential?.nextTokenHash ?? null).toBeNull();
        });
        succeed.mockRestore();
        if (["missing","same","oversize","stale"].includes(mode)) return;
        await runInPrincipalDatabaseTransaction(admin,async (tx) => {
          await tx.project.update({ where: { id: scope.projectId }, data: { serviceState: "ACTIVE" } });
          await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: false, unfrozenAt: new Date() } });
        });
      }
      if (mode === "concurrent") {
        const second = await accept("STAGE",1);
        const settled = await Promise.allSettled([execute(first.lease),execute(second.lease)]);
        expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
        if (settled[1]?.status === "fulfilled") first = second;
        expect(await observer((tx) => tx.snapshotAckRotationReceipt.count())).toBe(1);
      }
      const validLease = owned.get(first.lease.outboxEventId)!;
      const result = await execute(validLease);
      expect(result).toEqual({ action: "ACK_ROTATE", phase: "STAGE", previousCredentialVersion: 1, credentialVersion: 2 });
      await expect(observer((tx) => tx.snapshotAckRotationReceipt.create({ data: { ...scope, requestId: first.requestId,
        phase: "STAGE", previousVersion: 1, credentialVersion: 2, previousCurrentTokenHash: "scrypt$forged", currentTokenHash: "scrypt$forged", nextTokenHash: "scrypt$forged" } })))
        .rejects.toThrow("ACK_ROTATION_RECEIPT_IMMUTABLE");
      // Actual ACK application, not just checking a hash helper: both overlap tokens succeed.
      let sequence = 0;
      const ack = async (token: string) => runInPrincipalDatabaseTransaction(admin,async (tx) => {
        const repo = new PrismaSnapshotDeliveryRepository(tx); const publishSequence = ++sequence;
        await tx.projectSnapshotSequence.upsert({
          where: { organizationId_projectId: scope },
          create: { ...scope, lastReservedSequence: publishSequence },
          update: { lastReservedSequence: publishSequence },
        });
        await repo.publishCurrentAndCreateRun({ ...scope, publishSequence, manifestSha256: "a".repeat(64), manifestKey: `snapshots/${scope.projectId}/${"a".repeat(64)}`, publishedAt: new Date() });
        await repo.transitionRun({ ...scope, publishSequence, expectedStatuses: ["PENDING"], nextStatus: "DOWNLOADED", occurredAt: new Date() });
        await repo.transitionRun({ ...scope, publishSequence, expectedStatuses: ["DOWNLOADED"], nextStatus: "APPLIED", occurredAt: new Date() });
        return createSnapshotAckService({ repository: repo, now: () => new Date() }).acknowledge({ ...scope,publishSequence,token,idempotencyKey: randomUUID() });
      });
      expect((await ack(currentToken)).run.status).toBe("ACKNOWLEDGED"); expect((await ack(nextToken)).run.status).toBe("ACKNOWLEDGED");
      const promoted = await accept("PROMOTE",2);
      environment.SYNTHETIC_ACK_NEXT = undefined; resolveNextTokenRef.mockImplementation(() => { throw new Error("SYNTHETIC_TOKEN_MUST_NOT_RESOLVE"); });
      expect(await execute(promoted.lease)).toEqual({ action: "ACK_ROTATE", phase: "PROMOTE", previousCredentialVersion: 2, credentialVersion: 3 });
      await expect(ack(currentToken)).rejects.toThrow("ACK_AUTHENTICATION_FAILED"); expect((await ack(nextToken)).run.status).toBe("ACKNOWLEDGED");
      await runInPrincipalDatabaseTransaction(admin,async (tx) => {
        await tx.project.update({ where: { id: scope.projectId }, data: { serviceState: "SUSPENDED" } });
        await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } });
      });
      expect(await execute(validLease)).toEqual(result);
      expect(await observer((tx) => tx.projectAckCredential.findFirstOrThrow({ where: scope, select: { version: true } }))).toEqual({ version: 3 });
    } finally {
      hooks.afterInspection = null; hooks.afterBegin = null; succeed.mockRestore();
      for (const lease of owned.values()) await reliability.complete(lease);
    }
  },60_000);
});
