import { randomUUID } from "node:crypto";
import { createUlid } from "@ams-data-hub/data-contracts";
import { describe,expect,it,vi } from "vitest";
vi.mock("../../src/platform/database/transaction.ts",async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = (context,execute,options) => actual.runInAuthorizedDatabaseTransaction(context,async (tx) => {
    if (context.principalKind !== "platform-admin") await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
    if (context.principalKind !== "platform-admin") expect(await tx.$queryRawUnsafe("SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user")).toEqual([{ rolbypassrls: false,rolsuper: false }]);
    return execute(tx);
  },options);
  return { ...actual,runInAuthorizedDatabaseTransaction: authorized,
    runInPrincipalDatabaseTransaction: (principal,execute) => authorized(actual.createDatabaseAuthorizationContext(principal),execute),
    runInSystemJobDatabaseTransaction: (input,execute) => authorized(actual.createSystemJobDatabaseAuthorizationContext(input),execute) } satisfies typeof actual;
});
import { executeSuspiciousApproval,requestOperationalAction } from "../../src/modules/operations-control/server.ts";
import { OperationalActionLifecycleRepository } from "../../src/modules/operations-control/infrastructure/operational-action-lifecycle.ts";
import { OPERATIONAL_ACTION_TOPICS } from "../../src/modules/operations-control/index.ts";
import { ReliabilityService } from "../../src/modules/platform-operations/index.ts";
import { PrismaReliabilityRepository } from "../../src/modules/platform-operations/server.ts";
import { analyzeImportSafety,BOOTSTRAP_SOURCE_SAFETY_POLICY,reviewSuspiciousImport,type SafetyAnalysisResult } from "../../src/modules/ingestion-core/domain/safety-engine.ts";
import { createSnapshotRevisionApprovalReader } from "../../src/modules/ingestion-core/infrastructure/snapshot-revision-approval.ts";
import { runInPrincipalDatabaseTransaction,runInAuthorizedDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import type { Prisma } from "../../src/generated/prisma/client.ts";
import { runSourceWorker } from "../../src/infrastructure/source-worker-runtime.ts";
import { getPgBoss,stopPgBoss,publishClaimedEvent } from "../../src/modules/platform-operations/worker.ts";
import { OUTBOX_DELIVERY_QUEUE } from "../../src/modules/platform-operations/domain/pg-boss.ts";
import { S3Client } from "@aws-sdk/client-s3";

async function fixture(mode?: string) {
  const suffix = randomUUID(); const admin: PlatformAdminPrincipal = { kind: "platform-admin",userId: "synthetic-reviewer",correlationId: suffix };
  const subject = await runInPrincipalDatabaseTransaction(admin,async (tx) => {
    await tx.dataSafetyState.upsert({ where: { id: "global" },create: { id: "global",jobsFrozen: false,unfrozenAt: new Date() },update: { jobsFrozen: false,unfrozenAt: new Date() } });
    const org = await tx.organization.create({ data: { name: "Synthetic approval",slug: `approve-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: org.id,name: "Synthetic approval",slug: `approve-${suffix}` } });
    const scope = { organizationId: org.id,projectId: project.id };
    const policy = { ...BOOTSTRAP_SOURCE_SAFETY_POLICY,deactivationEnabled: true,inactiveAfterMissingGoodRuns: mode === "grace" ? 2 : 1,inactiveAfterMissingHours: 0 };
    const safety = await tx.sourceSafetyPolicy.create({ data: { ...scope,policy } });
    const source = await tx.source.create({ data: { ...scope,sourceKey: "synthetic-approval",name: "Synthetic approval",enabled: true,
      adapterKey: "yrl-realty-2010",adapterVersion: "1.0.0",profileKey: "default-v1",profileVersion: "1.0.0",datasetType: "RESALE",
      schedulePolicy: { mode: "MANUAL_ONLY" },safetyPolicyId: safety.id } });
    const target = { ...scope,sourceId: source.id };
    const metadata = { ...target,sourceVersion: source.version,adapterKey: source.adapterKey,adapterVersion: source.adapterVersion,
      profileKey: source.profileKey,profileVersion: source.profileVersion,safetyPolicy: policy,safetyPolicyVersion: safety.version,
      rawStorageKey: "synthetic/private/approval",rawArtifactHash: "a".repeat(64),rawByteCount: 0,normalizedContentHash: "b".repeat(64) };
    const good = await tx.sourceRevision.create({ data: { ...metadata,recordCount: 10,
      safetyAnalysis: analyzeImportSafety({ recordCount: 10,invalidRecordCount: 0,previousGoodRecordCount: null,issues: [] },policy) as unknown as Prisma.InputJsonObject } });
    const uids = Array.from({ length: 10 },() => createUlid());
    for (const [index,uid] of uids.entries()) {
      const externalId = `synthetic-${index}`;
      await tx.sourceRevisionRecord.create({ data: { ...target,revisionId: good.id,externalId,orderKey: Buffer.from(externalId).toString("hex"),inventoryUid: uid,recordHash: "c".repeat(64),payload: {} } });
      await tx.inventoryIdentity.create({ data: { ...target,uid,externalOfferId: externalId,status: index ? "ACTIVE" : "INACTIVE",
        firstSeenAt: new Date("2001-01-01"),lastSeenAt: new Date("2001-01-01"),sourceHash: "a".repeat(64),normalizedHash: "c".repeat(64),version: 1 } });
    }
    await tx.sourceRevision.update({ where: { id: good.id },data: { status: "STAGED" } });
    await tx.sourceRevision.update({ where: { id: good.id },data: { status: "GOOD",sequence: 1,completedAt: new Date() } });
    await tx.source.update({ where: { id: source.id },data: { lastGoodRevisionId: good.id } });
    const revision = await tx.sourceRevision.create({ data: { ...metadata,baseLastGoodRevisionId: good.id,recordCount: 1,
      safetyAnalysis: analyzeImportSafety({ recordCount: 1,invalidRecordCount: 0,previousGoodRecordCount: 10,issues: [] },policy) as unknown as Prisma.InputJsonObject } });
    const externalId = mode === "new-identity" ? "synthetic-new" : "synthetic-0";
    await tx.sourceRevisionRecord.create({ data: { ...target,revisionId: revision.id,externalId,orderKey: Buffer.from(externalId).toString("hex"),inventoryUid: mode === "new-identity" ? createUlid() : uids[0]!,recordHash: "d".repeat(64),payload: {} } });
    await tx.sourceRevision.update({ where: { id: revision.id },data: { status: "SUSPICIOUS",completedAt: new Date() } });
    if (mode === "baseline") {
      const newer = await tx.sourceRevision.create({ data: { ...metadata,baseLastGoodRevisionId: good.id,recordCount: 10,
        safetyAnalysis: analyzeImportSafety({ recordCount: 10,invalidRecordCount: 0,previousGoodRecordCount: 10,issues: [] },policy) as unknown as Prisma.InputJsonObject } });
      for (const [index,uid] of uids.entries()) {
        const id = `synthetic-${index}`;
        await tx.sourceRevisionRecord.create({ data: { ...target,revisionId: newer.id,externalId: id,orderKey: Buffer.from(id).toString("hex"),inventoryUid: uid,recordHash: "c".repeat(64),payload: {} } });
      }
      await tx.sourceRevision.update({ where: { id: newer.id },data: { status: "STAGED" } });
      await tx.sourceRevision.update({ where: { id: newer.id },data: { status: "GOOD",sequence: 2,completedAt: new Date() } });
      await tx.source.update({ where: { id: source.id },data: { lastGoodRevisionId: newer.id } });
    }
    return { ...target,revisionId: revision.id,goodId: good.id,policyId: safety.id };
  });
  const accepted = await requestOperationalAction(admin,{ ...subject,sourceRevisionId: subject.revisionId,action: "SUSPICIOUS_APPROVE",
    reason: "Synthetic private review",idempotencyKey: `approve-${suffix}` });
  await runInPrincipalDatabaseTransaction(admin,async (tx) => {
    const q = await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } });
    await tx.outboxEvent.update({ where: { id: q.outboxEventId! },data: { availableAt: new Date("1990-01-01") } });
  });
  const reliability = new ReliabilityService(new PrismaReliabilityRepository());
  const lease = await reliability.claim(`synthetic-approve-${suffix}`,300_000,[OPERATIONAL_ACTION_TOPICS.SUSPICIOUS_APPROVE]);
  if (!lease || (lease.payload as { requestId?: string }).requestId !== accepted.requestId) throw new Error("SYNTHETIC_LEASE_MISSING");
  const read = () => runInPrincipalDatabaseTransaction(admin,async (tx) => ({
    request: await tx.operationalActionRequest.findUniqueOrThrow({ where: { id: accepted.requestId } }),
    revision: await tx.sourceRevision.findUniqueOrThrow({ where: { id: subject.revisionId } }),
    source: await tx.source.findUniqueOrThrow({ where: { id: subject.sourceId } }),
    receipts: await tx.sourceManualApprovalReceipt.findMany({ where: { revisionId: subject.revisionId } }),
    identities: await tx.inventoryIdentity.findMany({ where: { sourceId: subject.sourceId },orderBy: { externalOfferId: "asc" } }),
    events: await tx.inventoryLifecycleEvent.findMany({ where: { organizationId: subject.organizationId,projectId: subject.projectId } }),
    intents: await tx.outboxEvent.findMany({ where: { organizationId: subject.organizationId,topic: "snapshot.build.request" } }),
  }));
  return { admin,subject,requestId: accepted.requestId,lease,reliability,read };
}

describe("actual request-owned manual source approval under NOBYPASS",() => {
  it.each(["execute","replay"])("registers actual combined-worker approval without intake/IO: %s",async (mode) => {
    const f = await fixture(); const controller = new AbortController(); const workerId = `${f.lease.workerId}-runtime`;
    vi.stubEnv("SNAPSHOT_BUILD_ENABLED","false"); vi.stubEnv("SNAPSHOT_PUBLISH_ENABLED","false");
    vi.stubEnv("SNAPSHOT_ROLLBACK_ENABLED","false"); vi.stubEnv("ACK_ROTATION_ENABLED","false");
    vi.stubEnv("PROJECT_STORAGE_BINDINGS",JSON.stringify([{ organizationId: f.subject.organizationId,projectId: f.subject.projectId,
      bucketRef: "SYNTHETIC_APPROVAL_BUCKET",endpointRef: "SYNTHETIC_APPROVAL_ENDPOINT",regionRef: "SYNTHETIC_APPROVAL_REGION",
      accessKeyIdRef: "SYNTHETIC_APPROVAL_ACCESS",secretAccessKeyRef: "SYNTHETIC_APPROVAL_SECRET" }]));
    vi.stubEnv("SYNTHETIC_APPROVAL_BUCKET","synthetic-approval"); vi.stubEnv("SYNTHETIC_APPROVAL_ENDPOINT","https://s3.twcstorage.ru");
    vi.stubEnv("SYNTHETIC_APPROVAL_REGION","ru-1"); vi.stubEnv("SYNTHETIC_APPROVAL_ACCESS","synthetic-approval"); vi.stubEnv("SYNTHETIC_APPROVAL_SECRET","synthetic-approval");
    const outbound = vi.spyOn(S3Client.prototype,"send").mockRejectedValue(new Error("SYNTHETIC_UNEXPECTED_OUTBOUND"));
    const boss = await getPgBoss(); await boss.createQueue(OUTBOX_DELIVERY_QUEUE);
    if (mode === "replay") {
      await executeSuspiciousApproval(f.lease);
      await runInPrincipalDatabaseTransaction(f.admin,async (tx) => {
        await tx.dataSafetyState.update({ where: { id: "global" },data: { jobsFrozen: true } });
        await tx.project.update({ where: { id: f.subject.projectId },data: { serviceState: "SUSPENDED" } });
      });
    }
    await publishClaimedEvent(boss,f.lease);
    let observed = false; const complete = boss.complete.bind(boss);
    const completed = vi.spyOn(boss,"complete").mockImplementation(async (name,id,data,options) => {
      const job = name === OUTBOX_DELIVERY_QUEUE && typeof id === "string" ? await boss.getJobById(name,id) : null;
      const result = await complete(name,id,data,options);
      if ((job?.data as { event?: { outboxEventId?: string } } | undefined)?.event?.outboxEventId === f.lease.outboxEventId) {
        expect(data).toEqual({ status: "success" });
        observed = await runInPrincipalDatabaseTransaction(f.admin,(tx) => tx.runtimeHeartbeat.count({ where: { runtime: "source-worker",workerId } }).then((count) => count === 1));
        controller.abort();
      }
      return result;
    });
    const timer = setTimeout(() => controller.abort(),10_000);
    try {
      await expect(runSourceWorker({ workerId,signal: controller.signal,pollIntervalMs: 10 })).resolves.toEqual({ fetched: 0,completed: 0,failed: 0 });
      expect(observed).toBe(true); expect(outbound).not.toHaveBeenCalled();
      const state = await f.read(); expect(state.request.status).toBe("SUCCEEDED"); expect(state.receipts).toHaveLength(1); expect(state.intents).toHaveLength(1);
      await runInPrincipalDatabaseTransaction(f.admin,async (tx) => {
        expect(await tx.runtimeHeartbeat.count({ where: { runtime: "source-worker",workerId } })).toBe(0);
        expect(await tx.jobRun.findUniqueOrThrow({ where: { id: f.lease.jobRunId } })).toMatchObject({ status: "SUCCESS" });
      });
    } finally { controller.abort(); clearTimeout(timer); completed.mockRestore(); outbound.mockRestore(); await stopPgBoss(); vi.unstubAllEnvs(); }
  });
  it.each(["apply","late-failure","late-cancel","freeze","project","source","policy","baseline","rejected","new-identity","grace","forged-analysis","critical","forged-sql","concurrent","takeover","scope","receipt-forgery"])
  ("proves atomic real apply or bounded denial: %s",async (mode) => {
    const f = await fixture(mode); const initial = await f.read(); const controller = new AbortController();
    const succeed = OperationalActionLifecycleRepository.prototype.succeedApprovedRevision;
    let spy: ReturnType<typeof vi.spyOn> | undefined;
    let cleanupLease = f.lease;
    try {
      for (const changed of [{ attempt: f.lease.attempt+1 },{ workerId: "foreign" },{ jobRunId: "foreign" },{ leaseAcquiredAt: new Date(0).toISOString() }])
        await expect(executeSuspiciousApproval({ ...f.lease,...changed })).rejects.toThrow("OUTBOX_OPERATION_LEASE_LOST");
      if (mode === "forged-sql") await expect(runInAuthorizedDatabaseTransaction({ principalKind: "project-job",actorId: "operations-executor",
        organizationId: f.subject.organizationId,projectIds: [f.subject.projectId],correlationId: randomUUID() },async (tx) => {
        await new OperationalActionLifecycleRepository(tx).begin(f.lease);
        await tx.$executeRawUnsafe("SELECT set_config('app.actor_id','source-import',true)");
        await tx.$executeRawUnsafe("SELECT set_config('app.source_approval_request_id',$1,true),set_config('app.source_approval_revision_id',$2,true)",f.requestId,f.subject.revisionId);
        const completedAt = new Date();
        const reviewed = reviewSuspiciousImport(initial.revision.safetyAnalysis as unknown as SafetyAnalysisResult,
          { decision: "APPROVE",reviewedBy: f.admin.userId,reason: "Synthetic private review",reviewedAt: completedAt.toISOString() });
        await tx.sourceRevision.update({ where: { id: f.subject.revisionId },data: { status: "GOOD",sequence: 2,completedAt,safetyAnalysis: reviewed as unknown as Prisma.InputJsonObject } });
      })).rejects.toThrow("SOURCE_APPROVAL_APPLY_INVALID");
      if (mode === "late-failure" || mode === "late-cancel") spy = vi.spyOn(OperationalActionLifecycleRepository.prototype,"succeedApprovedRevision").mockImplementation(async function (this: OperationalActionLifecycleRepository,...args) {
        const result = await succeed.apply(this,args); if (mode === "late-cancel") controller.abort(); else throw new Error("SYNTHETIC_LATE_APPROVAL_FAILURE"); return result;
      });
      await runInPrincipalDatabaseTransaction(f.admin,async (tx) => {
        if (mode === "freeze") await tx.dataSafetyState.update({ where: { id: "global" },data: { jobsFrozen: true } });
        if (mode === "project") await tx.project.update({ where: { id: f.subject.projectId },data: { serviceState: "SUSPENDED" } });
        if (mode === "source") await tx.source.update({ where: { id: f.subject.sourceId },data: { version: { increment: 1 } } });
        if (mode === "policy") await tx.sourceSafetyPolicy.update({ where: { id: f.subject.policyId },data: { policy: { ...BOOTSTRAP_SOURCE_SAFETY_POLICY } } });
        if (mode === "forged-analysis") await tx.sourceRevision.update({ where: { id: f.subject.revisionId },data: { safetyAnalysis: { disposition: "SUSPICIOUS" } } });
        if (mode === "critical") await tx.sourceRevision.update({ where: { id: f.subject.revisionId },data: { invalidRecordCount: 1,
          safetyAnalysis: { ...(initial.revision.safetyAnalysis as Prisma.JsonObject),disposition: "SUSPICIOUS" } } });
        if (mode === "rejected") await tx.sourceRevision.update({ where: { id: f.subject.revisionId },data: { status: "REJECTED" } });
      });
      if (mode === "takeover") {
        const taken = await f.reliability.takeOver(f.lease,f.lease.workerId);
        if (!taken) throw new Error("SYNTHETIC_TAKEOVER_MISSING"); cleanupLease = taken;
        await expect(executeSuspiciousApproval(f.lease)).rejects.toThrow("OUTBOX_OPERATION_LEASE_LOST");
        await expect(executeSuspiciousApproval(taken)).resolves.toMatchObject({ sequence: 2 });
        expect((await f.read()).receipts).toHaveLength(1);
      } else if (!["apply","new-identity","grace","forged-sql","concurrent","scope","receipt-forgery"].includes(mode)) {
        await expect(executeSuspiciousApproval(f.lease,controller.signal)).rejects.toThrow();
        const state = await f.read(); expect(state.receipts).toEqual([]); expect(state.intents).toEqual([]);
        expect(state.source.lastGoodRevisionId).toBe(initial.source.lastGoodRevisionId); expect(state.revision.status).toBe(mode === "rejected" ? "REJECTED" : "SUSPICIOUS");
        expect(state.request.status).toBe("REQUESTED"); expect(state.identities).toEqual(initial.identities); expect(state.events).toEqual([]);
      } else {
        const result = { action: "SUSPICIOUS_APPROVE",sourceRevisionId: f.subject.revisionId,sequence: 2,snapshotTriggered: true };
        if (mode === "concurrent") expect(await Promise.all([executeSuspiciousApproval(f.lease),executeSuspiciousApproval(f.lease)])).toEqual([result,result]);
        else expect(await executeSuspiciousApproval(f.lease)).toEqual(result);
        const state = await f.read(); expect(state.request.status).toBe("SUCCEEDED"); expect(state.source.lastGoodRevisionId).toBe(f.subject.revisionId);
        expect(state.revision.status).toBe("GOOD"); expect(state.receipts).toHaveLength(1); expect(state.intents).toHaveLength(1);
        const applied = state.identities.find((row) => row.externalOfferId === (mode === "new-identity" ? "synthetic-new" : "synthetic-0"));
        expect(applied).toMatchObject({ status: "ACTIVE",normalizedHash: "d".repeat(64),version: mode === "new-identity" ? 1 : 2 });
        expect(state.identities.filter((row) => row.externalOfferId !== "synthetic-0" && row.externalOfferId !== "synthetic-new")
          .every((row) => row.status === (mode === "grace" ? "ACTIVE" : "INACTIVE") && row.missingGoodRuns === 1)).toBe(true);
        expect(state.identities).toHaveLength(mode === "new-identity" ? 11 : 10);
        expect(state.events.filter((row) => row.type === "REACTIVATED")).toHaveLength(mode === "new-identity" ? 0 : 1);
        expect(state.events.filter((row) => row.type === "INACTIVATED")).toHaveLength(mode === "grace" ? 0 : 9);
        if (mode === "receipt-forgery") {
          const receipt = state.receipts[0]!;
          await expect(runInPrincipalDatabaseTransaction(f.admin,(tx) => tx.sourceManualApprovalReceipt.create({ data: { ...receipt,
            policy: receipt.policy as Prisma.InputJsonObject,originalAnalysis: receipt.originalAnalysis as Prisma.InputJsonObject,
            reviewedAnalysis: receipt.reviewedAnalysis as Prisma.InputJsonObject } }))).rejects.toThrow("SOURCE_APPROVAL_RECEIPT_IMMUTABLE");
          await expect(runInPrincipalDatabaseTransaction(f.admin,(tx) => tx.sourceManualApprovalReceipt.update({ where: { organizationId_projectId_revisionId: {
            organizationId: f.subject.organizationId,projectId: f.subject.projectId,revisionId: f.subject.revisionId } },data: { sequence: 99 } }))).rejects.toThrow("SOURCE_APPROVAL_RECEIPT_IMMUTABLE");
        }
        if (mode === "scope") for (const projects of [[],["*"],[f.subject.projectId,"foreign"],["foreign"]]) {
          await runInAuthorizedDatabaseTransaction({ principalKind: "project-job",actorId: "source-import",organizationId: f.subject.organizationId,
            projectIds: projects,correlationId: randomUUID() },async (tx) => {
            expect(await tx.sourceManualApprovalReceipt.count({ where: { revisionId: f.subject.revisionId } })).toBe(0);
            expect(await tx.sourceManualApprovalMutation.count({ where: { requestId: f.requestId } })).toBe(0);
          });
        }
        await runInAuthorizedDatabaseTransaction({ principalKind: "project-job",actorId: "snapshot-input",organizationId: f.subject.organizationId,
          projectIds: [f.subject.projectId],correlationId: randomUUID() },async (tx) => {
          const approvals = await createSnapshotRevisionApprovalReader(tx,f.subject)([{ sourceId: f.subject.sourceId,revisionId: f.subject.revisionId,sequence: 2 }]);
          expect(approvals.get(f.subject.revisionId)?.disposition).toBe("APPROVED");
        });
        await runInPrincipalDatabaseTransaction(f.admin,async (tx) => {
          await tx.dataSafetyState.update({ where: { id: "global" },data: { jobsFrozen: true } });
          await tx.project.update({ where: { id: f.subject.projectId },data: { serviceState: "SUSPENDED" } });
        });
        expect(await executeSuspiciousApproval(f.lease)).toEqual(state.request.result);
        expect((await f.read()).identities).toEqual(state.identities);
      }
    } finally { spy?.mockRestore(); await f.reliability.complete(cleanupLease); }
  });
});
