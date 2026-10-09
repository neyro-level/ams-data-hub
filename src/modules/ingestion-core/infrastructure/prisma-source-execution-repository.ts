import "server-only";

import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ProjectJobPrincipal } from "../../../platform/authorization/principal.ts";
import { PrismaDataSafetyRepository, assertMutatingJobsAllowed } from "../../platform-operations/server.ts";
import type { SourceExecutionState, ResolvedSourceExecution } from "../application/source-execution-service.ts";
import { type RawArtifactReceipt } from "../application/import-pipeline.ts";
import { assertSourceRevisionApproval } from "../application/source-revision-approval.ts";
import { assertManualSourceRevisionApproval } from "../application/manual-source-revision-approval.ts";
import { normalizedContentHash } from "../application/import-pipeline.ts";
import { analyzeImportSafety, reviewSuspiciousImport } from "../domain/safety-engine.ts";
import { type SafetyAnalysisResult } from "../domain/safety-engine.ts";
import { reconcileMissingInventory, type InventoryIdentityState } from "../domain/inventory-lifecycle.ts";
import { sourceSafetyPolicySchema } from "../domain/source-safety-policy-schema.ts";
import { createUlid } from "@ams-data-hub/data-contracts";
import { PrismaSourceRegistryRepository } from "./prisma-source-registry-repository.ts";
import { lockSourceIdentities } from "./source-identity-lock.ts";
import { enqueueSourceGoodSnapshot } from "./source-snapshot-intent.ts";

export interface StagedSourceRecord {
  externalId: string;
  orderKey: string;
  inventoryUid: string;
  recordHash: string;
  payload: Prisma.InputJsonObject;
}

export interface SourceRuntimeMutationPlan {
  revisionId: string;
  sourceVersion: number;
  baseLastGoodRevisionId: string | null;
  createCount: number;
  updateCount: number;
  deactivateCount: number;
}

/** Applying persisted normalized records does not need intake credentials,
 * live executable/profile resolution or a producer connection. */
export type SourceApplyContext = Pick<ResolvedSourceExecution, "target" | "principal" | "safetyPolicy" | "lastGood"> & {
  source: Pick<ResolvedSourceExecution["source"], "version" | "lastGoodRevisionId" | "safetyPolicyId">;
};
export interface SourceManualApproval { requestId: string; reviewedAt: Date }

function assertRawReceiptIdentity(receipt: RawArtifactReceipt) {
  if (!/^[a-f0-9]{64}$/u.test(receipt.rawArtifactHash)
    || receipt.storageKey !== `source-artifacts/${receipt.rawArtifactHash}`
    || !Number.isSafeInteger(receipt.byteCount) || receipt.byteCount < 0 || receipt.byteCount > 268_435_456)
    throw new Error("RAW_ARTIFACT_RECEIPT_INVALID");
}

export class PrismaSourceExecutionRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async load(principal: ProjectJobPrincipal, sourceId: string): Promise<SourceExecutionState | null> {
    await assertMutatingJobsAllowed(new PrismaDataSafetyRepository(this.transaction));
    const source = await new PrismaSourceRegistryRepository(this.transaction).findSource({
      organizationId: principal.organizationId, projectId: principal.projectId, sourceId,
    });
    if (!source) return null;
    const scope = { organizationId: source.organizationId, projectId: source.projectId };
    const project = await this.transaction.project.findFirstOrThrow({ where: { organizationId: source.organizationId, id: source.projectId }, select: { serviceState: true, status: true } });
    if (project.status !== "ACTIVE") throw new Error("SOURCE_EXECUTION_PROJECT_BLOCKED");
    const policy = source.safetyPolicyId ? await this.transaction.sourceSafetyPolicy.findFirst({ where: { ...scope, id: source.safetyPolicyId } }) : null;
    const revision = source.lastGoodRevisionId ? await this.transaction.sourceRevision.findFirst({
      where: { ...scope, sourceId, id: source.lastGoodRevisionId, status: "GOOD" }, select: { id: true, recordCount: true },
    }) : null;
    return { source, serviceState: project.serviceState,
      safetyPolicy: policy ? sourceSafetyPolicySchema.parse(policy.policy) : null,
      lastGood: revision ? { revisionId: revision.id, recordCount: revision.recordCount } : null };
  }

  async begin(context: ResolvedSourceExecution, manualRequestId?: string) {
    await this.lockSource(context);
    if (manualRequestId) {
      const claimed = await this.transaction.sourceManualRunRequest.updateMany({ where: { ...context.target, id: manualRequestId,
        status: { in: ["REQUESTED", "CLAIMED"] } }, data: { status: "CLAIMED" } });
      if (claimed.count !== 1) throw new Error("SOURCE_MANUAL_REQUEST_INVALID");
    }
    const policy = context.source.safetyPolicyId ? await this.transaction.sourceSafetyPolicy.findFirstOrThrow({
      where: { organizationId: context.target.organizationId, projectId: context.target.projectId, id: context.source.safetyPolicyId },
    }) : null;
    const revision = await this.transaction.sourceRevision.create({ data: {
      ...context.target, sourceVersion: context.source.version,
      baseLastGoodRevisionId: context.source.lastGoodRevisionId,
      adapterKey: context.adapter.key, adapterVersion: context.adapter.version,
      profileKey: context.profile.key, profileVersion: context.profile.version,
      safetyPolicy: sourceSafetyPolicySchema.parse(context.safetyPolicy) as unknown as Prisma.InputJsonObject,
      safetyPolicyVersion: policy?.version ?? null,
    }, select: { id: true, startedAt: true } });
    await this.transaction.source.update({ where: { id: context.target.sourceId }, data: { lastAttemptAt: revision.startedAt } });
    return revision;
  }

  async beginRawArtifactPut(context: ResolvedSourceExecution, revisionId: string, intent: RawArtifactReceipt) {
    assertRawReceiptIdentity(intent);
    await this.lockSource(context);
    // The caller's producer lease fences this read and INSERT. A retention cut
    // must hold exclusive admission while persisting PENDING; after guardian
    // loss that transaction lock prevents a producer reading uncommitted state.
    const deletion = await this.transaction.rawArtifactDeletion.findFirst({ where: {
      organizationId: context.target.organizationId, projectId: context.target.projectId,
      rawArtifactHash: intent.rawArtifactHash, status: { in: ["PENDING", "ACKNOWLEDGED"] },
    }, select: { id: true } });
    if (deletion) throw new Error("RAW_ARTIFACT_DELETE_PENDING");
    await this.transaction.rawArtifactPutAttempt.create({ data: { ...context.target, revisionId,
      rawArtifactHash: intent.rawArtifactHash, storageKey: intent.storageKey, byteCount: intent.byteCount } });
  }

  async registerRawArtifact(context: ResolvedSourceExecution, revisionId: string, receipt: RawArtifactReceipt) {
    assertRawReceiptIdentity(receipt);
    await this.lockSource(context);
    const settled = await this.transaction.$executeRaw(Prisma.sql`UPDATE "RawArtifactPutAttempt"
      SET status='STORED', "storedAt"=transaction_timestamp()::timestamptz(3)
      WHERE "organizationId"=${context.target.organizationId} AND "projectId"=${context.target.projectId}
        AND "sourceId"=${context.target.sourceId} AND "revisionId"=${revisionId} AND status='PENDING'
        AND "rawArtifactHash"=${receipt.rawArtifactHash} AND "storageKey"=${receipt.storageKey} AND "byteCount"=${receipt.byteCount}`);
    if (settled !== 1) throw new Error("RAW_ARTIFACT_RECEIPT_INVALID");
    // An actual verified PUT receipt is recorded before parsing, including for
    // malformed XML. Do not invent a receipt for an unfinished external PUT.
    const updated = await this.transaction.sourceRevision.updateMany({ where: { ...context.target,
      id: revisionId, status: "PENDING", rawStorageKey: null, rawArtifactHash: null, rawByteCount: null },
    data: { rawStorageKey: receipt.storageKey, rawArtifactHash: receipt.rawArtifactHash, rawByteCount: receipt.byteCount } });
    if (updated.count !== 1) throw new Error("SOURCE_REVISION_STAGING_CLOSED");
  }

  async append(context: ResolvedSourceExecution, revisionId: string, records: readonly StagedSourceRecord[]) {
    const scope = { ...context.target, id: revisionId };
    const pending = await this.transaction.sourceRevision.findFirst({ where: { ...scope, status: "PENDING" }, select: { id: true } });
    if (!pending) throw new Error("SOURCE_REVISION_STAGING_CLOSED");
    const existing = await this.transaction.inventoryIdentity.findMany({ where: {
      ...context.target, externalOfferId: { in: records.map((record) => record.externalId) },
    }, select: { externalOfferId: true, uid: true } });
    const identities = new Map(existing.map((record) => [record.externalOfferId, record.uid]));
    try {
      await this.transaction.sourceRevisionRecord.createMany({ data: records.map((record) => ({
        ...context.target, revisionId, ...record, inventoryUid: identities.get(record.externalId) ?? createUlid(),
      })) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new Error("SOURCE_DUPLICATE_EXTERNAL_ID");
      throw error;
    }
  }

  async stage(context: ResolvedSourceExecution, revisionId: string, input: {
    rawArtifact: RawArtifactReceipt; normalizedContentHash: string; recordCount: number; invalidRecordCount: number; safety: SafetyAnalysisResult;
  }) {
    const status = input.safety.disposition === "SAFE" ? "STAGED" : input.safety.disposition === "SUSPICIOUS" ? "SUSPICIOUS" : "REJECTED";
    const updated = await this.transaction.sourceRevision.updateMany({ where: { ...context.target, id: revisionId, status: "PENDING" }, data: {
      status, rawStorageKey: input.rawArtifact.storageKey, rawArtifactHash: input.rawArtifact.rawArtifactHash,
      rawByteCount: input.rawArtifact.byteCount, normalizedContentHash: input.normalizedContentHash,
      recordCount: input.recordCount, invalidRecordCount: input.invalidRecordCount,
      safetyAnalysis: input.safety as unknown as Prisma.InputJsonObject,
      ...(status !== "STAGED" ? { completedAt: new Date() } : {}),
    } });
    if (updated.count !== 1) throw new Error("SOURCE_REVISION_STAGING_CLOSED");
  }

  async lockSource(context: SourceApplyContext) {
    // Serialize with freeze before checking it; no HTTP/S3/parser work runs here.
    await this.transaction.$queryRaw(Prisma.sql`select pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text`);
    await assertMutatingJobsAllowed(new PrismaDataSafetyRepository(this.transaction));
    await lockSourceIdentities(this.transaction, context.target);
    await this.transaction.$queryRaw(Prisma.sql`select "id" from "Source" where "organizationId" = ${context.target.organizationId}
      and "projectId" = ${context.target.projectId} and "id" = ${context.target.sourceId} for update`);
    const source = await this.transaction.source.findFirstOrThrow({ where: { organizationId: context.target.organizationId, projectId: context.target.projectId, id: context.target.sourceId } });
    const project = await this.transaction.project.findFirstOrThrow({ where: { organizationId: context.target.organizationId, id: context.target.projectId } });
    if (!source.enabled || project.status !== "ACTIVE" || project.serviceState !== "ACTIVE" || source.version !== context.source.version
      || source.lastGoodRevisionId !== context.source.lastGoodRevisionId) throw new Error("SOURCE_EXECUTION_STALE");
    const policy = source.safetyPolicyId ? await this.transaction.sourceSafetyPolicy.findFirstOrThrow({
      where: { organizationId: source.organizationId, projectId: source.projectId, id: source.safetyPolicyId },
    }) : null;
    if (policy && JSON.stringify(sourceSafetyPolicySchema.parse(policy.policy)) !== JSON.stringify(sourceSafetyPolicySchema.parse(context.safetyPolicy))) {
      throw new Error("SOURCE_EXECUTION_POLICY_STALE");
    }
    return source;
  }

  async plan(context: SourceApplyContext, revisionId: string, manual?: SourceManualApproval): Promise<SourceRuntimeMutationPlan> {
    const revision = await this.transaction.sourceRevision.findFirstOrThrow({ where: { ...context.target, id: revisionId, status: manual ? "SUSPICIOUS" : "STAGED" } });
    await this.assertAdmittedRevision(context, revision, manual);
    const counts = await this.transaction.$queryRaw<{ createCount: bigint; updateCount: bigint }[]>(Prisma.sql`
      select count(*) filter (where i."uid" is null) as "createCount", count(*) filter (where i."uid" is not null) as "updateCount"
      from "SourceRevisionRecord" r left join "InventoryIdentity" i on i."organizationId" = r."organizationId"
        and i."projectId" = r."projectId" and i."sourceId" = r."sourceId" and i."externalOfferId" = r."externalId"
      where r."revisionId" = ${revisionId}
    `);
    return { revisionId, sourceVersion: revision.sourceVersion, baseLastGoodRevisionId: revision.baseLastGoodRevisionId,
      createCount: Number(counts[0]!.createCount), updateCount: Number(counts[0]!.updateCount),
      deactivateCount: await this.reconcileMissing(context, revision, false) };
  }

  private async assertAdmittedRevision(context: SourceApplyContext, revision: {
    organizationId: string; projectId: string; sourceId: string; id: string; sourceVersion: number;
    safetyPolicyVersion: number | null; baseLastGoodRevisionId: string | null;
    safetyPolicy: Prisma.JsonValue; safetyAnalysis: Prisma.JsonValue; recordCount: number; invalidRecordCount: number;
  }, manual?: SourceManualApproval) {
    if (!manual) { assertSourceRevisionApproval(revision, context.lastGood?.recordCount ?? null); return null; }
    const rows = await this.transaction.$queryRaw<{ id: string; requestHash: string; requestedBy: string; reason: string }[]>(Prisma.sql`
      SELECT * FROM source_manual_approval_request(${revision.organizationId},${revision.projectId},${revision.sourceId},${revision.id},${manual.requestId})`);
    const request = rows[0];
    if (rows.length !== 1 || !request || !Number.isFinite(manual.reviewedAt.getTime())) throw new Error("SOURCE_REVISION_MANUAL_APPROVAL_INVALID");
    const original = analyzeImportSafety({ recordCount: revision.recordCount, invalidRecordCount: revision.invalidRecordCount,
      previousGoodRecordCount: context.lastGood?.recordCount ?? null, issues: revision.invalidRecordCount ? [{ severity: "CRITICAL", code: "SOURCE_RECORD_INVALID" }] : [] },
      sourceSafetyPolicySchema.parse(revision.safetyPolicy));
    if (normalizedContentHash(original) !== normalizedContentHash(revision.safetyAnalysis)) throw new Error("SOURCE_REVISION_MANUAL_APPROVAL_INVALID");
    const reviewed = reviewSuspiciousImport(original, { decision: "APPROVE", reviewedBy: request.requestedBy,
      reason: request.reason, reviewedAt: manual.reviewedAt.toISOString() });
    assertManualSourceRevisionApproval({ ...revision, safetyAnalysis: reviewed }, context.lastGood?.recordCount ?? null,
      { organizationId: revision.organizationId, projectId: revision.projectId, sourceId: revision.sourceId, revisionId: revision.id,
        requestId: request.id, requestHash: request.requestHash, sourceVersion: revision.sourceVersion,
        safetyPolicyVersion: revision.safetyPolicyVersion, baseLastGoodRevisionId: revision.baseLastGoodRevisionId,
        previousGoodRecordCount: context.lastGood?.recordCount ?? null, policyHash: normalizedContentHash(sourceSafetyPolicySchema.parse(revision.safetyPolicy)),
        originalAnalysisHash: normalizedContentHash(original), reviewedAnalysisHash: normalizedContentHash(reviewed) });
    return reviewed;
  }

  private async reconcileMissing(context: SourceApplyContext, revision: {
    id: string; startedAt: Date; recordCount: number; safetyPolicy: Prisma.JsonValue;
  }, apply: boolean): Promise<number> {
    // A baseline never removes previous inventory, even if legacy identities
    // predate revision persistence. Empty feeds never reconcile absence.
    if (!context.lastGood || revision.recordCount === 0) return 0;
    const policy = sourceSafetyPolicySchema.parse(revision.safetyPolicy);
    let cursor = "";
    let deactivated = 0;
    while (true) {
      const page = await this.transaction.$queryRaw<InventoryIdentityState[]>(Prisma.sql`
        select i.* from "InventoryIdentity" i
        where i."organizationId" = ${context.target.organizationId} and i."projectId" = ${context.target.projectId}
          and i."sourceId" = ${context.target.sourceId} and i."status" = 'ACTIVE' and i."uid" > ${cursor}
          and not exists (select 1 from "SourceRevisionRecord" r where r."revisionId" = ${revision.id} and r."externalId" = i."externalOfferId")
        order by i."uid" limit 200
      `);
      if (!page.length) break;
      const changes = page.map((current) => {
        const decision = reconcileMissingInventory(current, policy, {
          completedGoodRun: true, baseline: false, suspicious: false, occurredAt: revision.startedAt,
        });
        if (decision.outcome === "INACTIVATED") deactivated += 1;
        return { current, decision };
      }).filter(({ decision }) => decision.outcome !== "UNCHANGED");
      if (apply && changes.length) {
        const rows = changes.map(({ current, decision: { state } }) => Prisma.sql`(
          ${state.uid}, ${current.version}::integer, ${state.status}::"InventoryLifecycleStatus",
          ${state.missingGoodRuns}::integer, ${state.missingSince}::timestamptz, ${state.version}::integer
        )`);
        const updated = await this.transaction.$executeRaw(Prisma.sql`
          update "InventoryIdentity" i set "status" = v.status, "missingGoodRuns" = v.runs,
            "missingSince" = v.since, "version" = v.version, "updatedAt" = ${revision.startedAt}
          from (values ${Prisma.join(rows)}) as v(uid, expected_version, status, runs, since, version)
          where i."uid" = v.uid and i."version" = v.expected_version
            and i."organizationId" = ${context.target.organizationId} and i."projectId" = ${context.target.projectId}
            and i."sourceId" = ${context.target.sourceId}
        `);
        if (updated !== changes.length) throw new Error("SOURCE_EXECUTION_IDENTITY_STALE");
        const events = changes.filter(({ decision }) => decision.event !== null);
        if (events.length) await this.transaction.inventoryLifecycleEvent.createMany({ data: events.map(({ current, decision }) => ({
          organizationId: context.target.organizationId, projectId: context.target.projectId,
          inventoryUid: current.uid, type: decision.event!, occurredAt: revision.startedAt,
        })) });
      }
      cursor = page.at(-1)!.uid;
    }
    return deactivated;
  }

  async apply(context: SourceApplyContext, revisionId: string, plan: SourceRuntimeMutationPlan, manualRequestId?: string, manual?: SourceManualApproval) {
    await this.lockSource(context);
    const revision = await this.transaction.sourceRevision.findFirstOrThrow({ where: { ...context.target, id: revisionId, status: manual ? "SUSPICIOUS" : "STAGED" } });
    const reviewed = await this.assertAdmittedRevision(context, revision, manual);
    if (revision.sourceVersion !== context.source.version || revision.baseLastGoodRevisionId !== context.source.lastGoodRevisionId
      || plan.revisionId !== revisionId || plan.sourceVersion !== revision.sourceVersion || plan.baseLastGoodRevisionId !== revision.baseLastGoodRevisionId
      || plan.createCount + plan.updateCount !== revision.recordCount
      || plan.deactivateCount !== await this.reconcileMissing(context, revision, false)) {
      throw new Error("SOURCE_EXECUTION_STALE");
    }
    const stale = await this.transaction.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      select count(*) from "SourceRevisionRecord" r join "InventoryIdentity" i
        on i."organizationId" = r."organizationId" and i."projectId" = r."projectId"
        and i."sourceId" = r."sourceId" and i."externalOfferId" = r."externalId"
      where r."revisionId" = ${revisionId} and (i."uid" <> r."inventoryUid" or i."lastSeenAt" > ${revision.startedAt})
    `);
    if (stale[0]?.count !== 0n) throw new Error("SOURCE_EXECUTION_IDENTITY_STALE");
    if (manual) {
      await this.transaction.$executeRaw(Prisma.sql`SELECT set_config('app.source_approval_request_id',${manual.requestId},true)`);
      await this.transaction.$executeRaw(Prisma.sql`SELECT set_config('app.source_approval_revision_id',${revisionId},true)`);
    }
    // Missing grace/state/events share the final GOOD transaction and roll back
    // with any later constraint/outbox failure. No broken run reaches this path.
    await this.reconcileMissing(context, revision, true);
    // CUID event ids are allocated by Prisma in bounded batches, not fabricated SQL ids.
    let cursor = "";
    while (true) {
      const reactivated = await this.transaction.$queryRaw<{ uid: string }[]>(Prisma.sql`
        select i."uid" from "InventoryIdentity" i join "SourceRevisionRecord" r
          on i."organizationId" = r."organizationId" and i."projectId" = r."projectId"
          and i."sourceId" = r."sourceId" and i."externalOfferId" = r."externalId"
        where r."revisionId" = ${revisionId} and i."status" = 'INACTIVE' and i."uid" > ${cursor}
        order by i."uid" limit 200
      `);
      if (!reactivated.length) break;
      await this.transaction.inventoryLifecycleEvent.createMany({ data: reactivated.map(({ uid }) => ({
        organizationId: context.target.organizationId, projectId: context.target.projectId,
        inventoryUid: uid, type: "REACTIVATED", occurredAt: revision.startedAt,
      })) });
      cursor = reactivated.at(-1)!.uid;
    }
    await this.transaction.$executeRaw(Prisma.sql`
      insert into "InventoryIdentity" ("uid", "organizationId", "projectId", "sourceId", "externalOfferId", "status",
        "firstSeenAt", "lastSeenAt", "missingGoodRuns", "missingSince", "sourceHash", "normalizedHash", "version", "createdAt", "updatedAt")
      select "inventoryUid", "organizationId", "projectId", "sourceId", "externalId", 'ACTIVE'::"InventoryLifecycleStatus", ${revision.startedAt},
        ${revision.startedAt}, 0, null, ${revision.rawArtifactHash}, "recordHash", 1, ${revision.startedAt}, ${revision.startedAt}
      from "SourceRevisionRecord" where "revisionId" = ${revisionId}
      on conflict ("organizationId", "projectId", "sourceId", "externalOfferId") do update set
        "status" = 'ACTIVE', "lastSeenAt" = excluded."lastSeenAt", "missingGoodRuns" = 0, "missingSince" = null,
        "sourceHash" = excluded."sourceHash", "normalizedHash" = excluded."normalizedHash",
        "version" = "InventoryIdentity"."version" + 1, "updatedAt" = excluded."updatedAt"
    `);
    const previous = context.lastGood ? await this.transaction.sourceRevision.findFirstOrThrow({
      where: { ...context.target, id: context.lastGood.revisionId, status: "GOOD" }, select: { sequence: true },
    }) : null;
    const sequence = (previous?.sequence ?? 0) + 1;
    if (manual) await this.transaction.$executeRaw(Prisma.sql`SELECT set_config('app.source_approval_request_id',${manual.requestId},true)`);
    await this.transaction.sourceRevision.update({ where: { id: revisionId }, data: { status: "GOOD", sequence, completedAt: manual?.reviewedAt ?? new Date(),
      ...(reviewed ? { safetyAnalysis: reviewed as unknown as Prisma.InputJsonObject } : {}) } });
    if (manual) await this.transaction.$executeRaw(Prisma.sql`SELECT set_config('app.source_approval_request_id','',true),set_config('app.source_approval_revision_id','',true)`);
    await this.transaction.source.update({ where: { id: context.target.sourceId }, data: {
      lastGoodRevisionId: revisionId, lastSuccessAt: revision.startedAt,
    } });
    await enqueueSourceGoodSnapshot(this.transaction, context.principal, context.target, { revisionId, sequence });
    if (manualRequestId) {
      const completed = await this.transaction.sourceManualRunRequest.updateMany({ where: { ...context.target, id: manualRequestId,
        status: "CLAIMED" }, data: { status: "COMPLETED" } });
      if (completed.count !== 1) throw new Error("SOURCE_MANUAL_REQUEST_INVALID");
    }
    return { revisionId, sequence };
  }

  async fail(context: ResolvedSourceExecution, revisionId: string, stage: string, code: string) {
    await this.transaction.sourceRevision.updateMany({ where: { ...context.target, id: revisionId, status: { in: ["PENDING", "STAGED"] } },
      data: { status: "FAILED", failedStage: stage, failureCode: code, completedAt: new Date() } });
  }
}
