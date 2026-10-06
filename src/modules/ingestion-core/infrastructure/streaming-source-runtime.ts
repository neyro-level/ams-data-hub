import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "../../../generated/prisma/client.ts";
import { runInPrincipalDatabaseTransaction } from "../../../platform/database/transaction.ts";
import { getLogger } from "../../../platform/observability/logger.ts";
import type { StreamingObjectStorage } from "../../../platform/storage/object-storage.ts";
import { SourceExecutionService, type ResolvedSourceExecution } from "../application/source-execution-service.ts";
import { normalizedContentHash, type ImportPipelineStage, type SourceImportResult } from "../application/import-pipeline.ts";
import { analyzeImportSafety } from "../domain/safety-engine.ts";
import { sourceSafetyPolicySchema } from "../domain/source-safety-policy-schema.ts";
import { canonicalSourceFields } from "../domain/canonical-source-fields.ts";
import { normalizeDescription } from "../domain/canonical-inventory.ts";
import { createStreamingSourceIntake } from "./streaming-source-intake.ts";
import { PrismaSourceExecutionRepository, type StagedSourceRecord } from "./prisma-source-execution-repository.ts";
import type { StreamingRawArtifact } from "./streaming-raw-artifact.ts";

const BATCH_RECORDS = 100;
const BATCH_BYTES = 4 * 1024 * 1024;
const RECORD_BYTES = 2 * 1024 * 1024;
const knownFailures = new Set([
  "SOURCE_DUPLICATE_EXTERNAL_ID", "SOURCE_EXECUTION_STALE", "SOURCE_EXECUTION_POLICY_STALE", "SOURCE_EXECUTION_IDENTITY_STALE",
  "SOURCE_REVISION_STAGING_CLOSED", "SOURCE_RECORD_INVALID", "SOURCE_RECORD_TOO_LARGE",
  "SOURCE_REVISION_SAFETY_INVALID",
  "IMPORT_REQUIRES_APPROVAL", "IMPORT_REJECTED_BY_SAFETY_POLICY", "SOURCE_ENDPOINT_CREDENTIAL_UNAVAILABLE",
  "SOURCE_ENDPOINT_INTAKE_FAILED", "RAW_ARTIFACT_TOO_LARGE", "RAW_ARTIFACT_CAPACITY_EXCEEDED",
  "YRL_XML_MALFORMED", "YRL_NAMESPACE_MISMATCH", "YRL_ARTIFACT_TOO_LARGE", "YRL_OFFER_LIMIT_EXCEEDED",
  "YRL_DEPTH_LIMIT_EXCEEDED", "YRL_DTD_FORBIDDEN", "YRL_FIELD_TOO_LONG", "YRL_OFFER_TOO_COMPLEX", "YRL_ROOT_INVALID", "YRL_UTF8_INVALID",
  "MARKETPLACE_XML_MALFORMED", "MARKETPLACE_XML_SIGNATURE_INVALID", "MARKETPLACE_XML_ARTIFACT_TOO_LARGE",
  "MARKETPLACE_XML_RECORD_LIMIT_EXCEEDED", "MARKETPLACE_XML_DEPTH_LIMIT_EXCEEDED", "MARKETPLACE_XML_DTD_FORBIDDEN",
  "MARKETPLACE_XML_FIELD_TOO_LONG", "MARKETPLACE_XML_RECORD_TOO_COMPLEX", "MARKETPLACE_XML_ROOT_INVALID", "MARKETPLACE_XML_UTF8_INVALID",
]);

async function execute(context: ResolvedSourceExecution, storage: StreamingObjectStorage, manualRequestId?: string): Promise<SourceImportResult> {
  const transaction = <T>(run: (repository: PrismaSourceExecutionRepository) => Promise<T>) =>
    runInPrincipalDatabaseTransaction(context.principal, (tx) => run(new PrismaSourceExecutionRepository(tx)));
  let stage: ImportPipelineStage = "SAFE_INTAKE";
  let revisionId: string | undefined;
  let raw: StreamingRawArtifact | undefined;
  try {
    const safetyPolicy = sourceSafetyPolicySchema.parse(context.safetyPolicy);
    revisionId = (await transaction((repository) => repository.begin(context, manualRequestId))).id;
    const intake = createStreamingSourceIntake({ endpointReference: context.endpointReference, storage, adapter: context.adapter, safetyPolicy });
    raw = await intake.safeIntake.acquire();
    stage = "RAW_ARTIFACT";
    const receipt = await raw.persist();
    let batch: StagedSourceRecord[] = [];
    let batchBytes = 0;
    let recordCount = 0;
    let invalidRecordCount = 0;
    const flush = async () => {
      if (!batch.length) return;
      await transaction((repository) => repository.append(context, revisionId!, batch));
      batch = []; batchBytes = 0;
    };
    stage = "PARSE";
    for await (const record of context.executableAdapter.parse(raw.open(), {
      limits: intake.limits, ...(context.source.expectedNamespace ? { expectedNamespace: context.source.expectedNamespace } : {}),
    })) {
      stage = "NORMALIZE";
      const result = context.executableAdapter.normalize(record);
      stage = "VALIDATE";
      if (!result.draft || result.issues.length > 0 || !result.draft.externalId.trim() || result.draft.externalId.length > 240) {
        invalidRecordCount += 1;
        if (invalidRecordCount > intake.limits.maxRecords) throw new Error("SOURCE_RECORD_INVALID");
        stage = "PARSE";
        continue;
      }
      const draft = { ...result.draft, ...(result.draft.description === undefined ? {} : {
        description: normalizeDescription(result.draft.description).descriptionHtmlSafe,
      }) };
      if ((draft.price !== undefined && draft.price < 0) || (draft.areaM2 !== undefined && draft.areaM2 < 0)
        || (draft.latitude !== undefined && (draft.latitude < -90 || draft.latitude > 90))
        || (draft.longitude !== undefined && (draft.longitude < -180 || draft.longitude > 180))
        || (draft.title?.length ?? 0) > 500 || (draft.description?.length ?? 0) > 100_000
        || draft.imageUrls.some((url) => url.length > 2000)) throw new Error("SOURCE_RECORD_INVALID");
      const fields = canonicalSourceFields(record.element, context.profile.formatContract?.caseSensitiveTags ?? true);
      const payload = { schemaVersion: 1, draft, fields, rawRecord: record.element } as unknown as Prisma.InputJsonObject;
      const bytes = Buffer.byteLength(JSON.stringify(payload));
      if (bytes > RECORD_BYTES) throw new Error("SOURCE_RECORD_TOO_LARGE");
      if (batch.length >= BATCH_RECORDS || batchBytes + bytes > BATCH_BYTES) await flush();
      stage = "IDENTITY_RESOLUTION";
      batch.push({ externalId: draft.externalId, orderKey: Buffer.from(draft.externalId).toString("hex"),
        inventoryUid: "", recordHash: normalizedContentHash({ draft: { ...draft, provenance: undefined }, fields }), payload });
      batchBytes += bytes;
      recordCount += 1;
      stage = "STAGING";
      if (batch.length >= BATCH_RECORDS || batchBytes >= BATCH_BYTES) await flush();
      stage = "PARSE";
    }
    stage = "STAGING";
    await flush();
    // Stable semantic hash uses sorted persisted record hashes in
    // bounded pages; never JSON.stringify the complete Source in memory.
    const semantic = createHash("sha256");
    let cursor = "";
    while (true) {
      const page = await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.sourceRevisionRecord.findMany({
        where: { ...context.target, revisionId, orderKey: { gt: cursor } }, orderBy: { orderKey: "asc" }, take: BATCH_RECORDS,
        select: { externalId: true, orderKey: true, recordHash: true },
      }));
      if (!page.length) break;
      for (const record of page) semantic.update(`${Buffer.byteLength(record.externalId)}:${record.externalId}:${record.recordHash}\n`);
      cursor = page.at(-1)!.orderKey;
    }
    const normalizedHash = semantic.digest("hex");
    stage = "SAFETY_ANALYSIS";
    const safety = analyzeImportSafety({ recordCount, invalidRecordCount,
      previousGoodRecordCount: context.lastGood?.recordCount ?? null,
      issues: invalidRecordCount > 0 ? [{ severity: "CRITICAL", code: "SOURCE_RECORD_INVALID" }] : [],
    }, safetyPolicy);
    await transaction((repository) => repository.stage(context, revisionId!, {
      rawArtifact: receipt, normalizedContentHash: normalizedHash, recordCount, invalidRecordCount, safety,
    }));
    if (safety.disposition === "SUSPICIOUS") throw new Error("IMPORT_REQUIRES_APPROVAL");
    if (safety.disposition !== "SAFE") throw new Error("IMPORT_REJECTED_BY_SAFETY_POLICY");
    stage = "MUTATION_PLAN";
    const plan = await transaction((repository) => repository.plan(context, revisionId!));
    stage = "DATABASE_APPLY";
    const good = await transaction((repository) => repository.apply(context, revisionId!, plan, manualRequestId));
    return { state: "GOOD", sourceId: context.target.sourceId, ...good, rawArtifactHash: receipt.rawArtifactHash,
      normalizedContentHash: normalizedHash, snapshotTriggered: true };
  } catch (error) {
    const code = error instanceof Error && knownFailures.has(error.message) ? error.message : "IMPORT_PIPELINE_FAILED";
    if (revisionId) {
      try { await transaction((repository) => repository.fail(context, revisionId!, stage, code)); } catch { /* value-free result, retryable persistent evidence */ }
    }
    return { state: "FAILED", sourceId: context.target.sourceId, failedStage: stage, code };
  } finally {
    if (raw) {
      try { await raw.dispose(); } catch {
        getLogger().warn({ sourceId: context.target.sourceId, code: "RAW_ARTIFACT_CLEANUP_FAILED" }, "Source raw lease cleanup failed");
      }
    }
  }
}

/** Application composition; callers configure only Source IDs. Storage is the
 * server-owned infrastructure dependency, never a per-Source payload adapter. */
export function createSourceExecutionServer(storage: StreamingObjectStorage, options: { manualRequestId?: string } = {}) {
  if (options.manualRequestId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/u.test(options.manualRequestId)) throw new Error("SOURCE_MANUAL_REQUEST_INVALID");
  return new SourceExecutionService({
    load: (principal, sourceId) => runInPrincipalDatabaseTransaction(principal,
      (tx) => new PrismaSourceExecutionRepository(tx).load(principal, sourceId)),
    run: (context) => execute(context, storage, options.manualRequestId),
  });
}
