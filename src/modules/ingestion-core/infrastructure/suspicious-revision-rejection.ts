import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { assertMutatingJobsAllowed, PrismaDataSafetyRepository } from "../../platform-operations/server.ts";
import { analyzeImportSafety, reviewSuspiciousImport, type SafetyAnalysisResult } from "../domain/safety-engine.ts";
import { sourceSafetyPolicySchema } from "../domain/source-safety-policy-schema.ts";
import { normalizedContentHash } from "../application/import-pipeline.ts";
import { lockSourceIdentities } from "./source-identity-lock.ts";

export async function prepareSuspiciousRevisionRejection(transaction: DatabaseTransaction, input: {
  organizationId: string; projectId: string; sourceId: string; sourceRevisionId: string;
  requestId: string; requestedBy: string; reason: string; correlationId: string;
}) {
  await lockSourceIdentities(transaction, input); // global -> source; shared with actual apply.
  await assertMutatingJobsAllowed(new PrismaDataSafetyRepository(transaction));
  const scope = { organizationId: input.organizationId, projectId: input.projectId, sourceId: input.sourceId };
  const project = await transaction.project.findFirst({ where: { organizationId: input.organizationId, id: input.projectId },
    select: { status: true, serviceState: true } });
  const source = await transaction.source.findFirst({ where: { organizationId: input.organizationId, projectId: input.projectId, id: input.sourceId },
    select: { id: true } });
  if (!source || project?.status !== "ACTIVE" || project.serviceState !== "ACTIVE") throw new Error("SOURCE_OPERATION_REVIEW_BLOCKED");
  const locked = await transaction.$queryRaw<{ id: string; status: string; bounded: boolean }[]>(Prisma.sql`
    SELECT "id", "status", (octet_length("safetyPolicy"::text) <= 4096
      AND "safetyAnalysis" IS NOT NULL AND octet_length("safetyAnalysis"::text) <= 4096) AS bounded FROM "SourceRevision"
    WHERE "organizationId" = ${input.organizationId} AND "projectId" = ${input.projectId}
      AND "sourceId" = ${input.sourceId} AND "id" = ${input.sourceRevisionId} FOR UPDATE`);
  if (locked[0]?.status !== "SUSPICIOUS") throw new Error("SOURCE_SAFETY_REVIEW_NOT_PENDING");
  if (locked[0].bounded !== true) throw new Error("SOURCE_REVISION_SAFETY_INVALID");
  const revision = await transaction.sourceRevision.findFirst({ where: { ...scope, id: input.sourceRevisionId, status: "SUSPICIOUS" },
    select: { id: true, baseLastGoodRevisionId: true, recordCount: true, invalidRecordCount: true, safetyPolicy: true, safetyAnalysis: true } });
  if (!revision) throw new Error("SOURCE_SAFETY_REVIEW_NOT_PENDING");
  const previous = revision.baseLastGoodRevisionId ? await transaction.sourceRevision.findFirst({
    where: { ...scope, id: revision.baseLastGoodRevisionId, status: "GOOD" }, select: { recordCount: true },
  }) : null;
  if (revision.baseLastGoodRevisionId && !previous) throw new Error("SOURCE_REVISION_SAFETY_INVALID");
  let analysis: SafetyAnalysisResult;
  try {
    analysis = analyzeImportSafety({ recordCount: revision.recordCount, invalidRecordCount: revision.invalidRecordCount,
      previousGoodRecordCount: previous?.recordCount ?? null,
      issues: revision.invalidRecordCount > 0 ? [{ severity: "CRITICAL", code: "SOURCE_RECORD_INVALID" }] : [],
    }, sourceSafetyPolicySchema.parse(revision.safetyPolicy));
    if (analysis.disposition !== "SUSPICIOUS" || normalizedContentHash(analysis) !== normalizedContentHash(revision.safetyAnalysis)) {
      throw new Error("SOURCE_REVISION_SAFETY_INVALID");
    }
  } catch {
    // Never propagate private policy/analysis validation diagnostics to workers.
    throw new Error("SOURCE_REVISION_SAFETY_INVALID");
  }
  // Consume only after caller begin has pinned the current outbox/request lease.
  return async () => {
    const completedAt = new Date();
    const reviewed = reviewSuspiciousImport(analysis, { decision: "REJECT", reviewedBy: input.requestedBy,
      reviewedAt: completedAt.toISOString(), reason: input.reason });
    const changed = await transaction.sourceRevision.updateMany({ where: { ...scope, id: revision.id, status: "SUSPICIOUS" },
      data: { status: "REJECTED", safetyAnalysis: reviewed as unknown as Prisma.InputJsonObject, completedAt } });
    if (changed.count !== 1) throw new Error("SOURCE_SAFETY_REVIEW_NOT_PENDING");
    await transaction.auditEvent.create({ data: { organizationId: input.organizationId,
      actorType: "USER", actorId: input.requestedBy, action: "operations-control.suspicious.rejected",
      entityType: "SourceRevision", entityId: revision.id, source: "operations-control", correlationId: input.correlationId,
      afterMarker: { requestId: input.requestId, projectId: input.projectId, decision: "REJECTED" },
    } });
    return { action: "SUSPICIOUS_REJECT" as const, sourceRevisionId: revision.id };
  };
}
