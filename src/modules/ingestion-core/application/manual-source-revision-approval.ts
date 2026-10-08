import { z } from "zod";
import { analyzeImportSafety, reviewSuspiciousImport } from "../domain/safety-engine.ts";
import { sourceSafetyPolicySchema } from "../domain/source-safety-policy-schema.ts";
import { normalizedContentHash } from "./import-pipeline.ts";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().max(2_147_483_647);
const proofSchema = z.object({
  organizationId: id, projectId: id, sourceId: id, revisionId: id,
  requestId: id, requestHash: hash, sourceVersion: count.positive(),
  safetyPolicyVersion: count.positive().nullable(), baseLastGoodRevisionId: id.nullable(),
  previousGoodRecordCount: count.nullable(), policyHash: hash,
  originalAnalysisHash: hash, reviewedAnalysisHash: hash,
}).strict();
export type ManualSourceRevisionApprovalProof = z.output<typeof proofSchema>;

/** Validate content against an already loaded durable receipt, NOT authority to
 * approve. Persistence must authenticate request/full lease, create the receipt,
 * and commit actual apply atomically. Never accept this proof from web/outbox.
 * Keep the automatic SAFE predicate independent and byte-compatible. */
export function assertManualSourceRevisionApproval(revision: {
  organizationId: string; projectId: string; sourceId: string; id: string;
  sourceVersion: number; safetyPolicyVersion: number | null;
  baseLastGoodRevisionId: string | null; recordCount: number; invalidRecordCount: number;
  safetyPolicy: unknown; safetyAnalysis: unknown;
}, previousGoodRecordCount: number | null, rawProof: unknown) {
  try {
    const proof = proofSchema.parse(rawProof);
    if (proof.organizationId !== revision.organizationId || proof.projectId !== revision.projectId
      || proof.sourceId !== revision.sourceId || proof.revisionId !== revision.id
      || proof.sourceVersion !== revision.sourceVersion || proof.safetyPolicyVersion !== revision.safetyPolicyVersion
      || proof.baseLastGoodRevisionId !== revision.baseLastGoodRevisionId
      || proof.previousGoodRecordCount !== previousGoodRecordCount
      || revision.invalidRecordCount !== 0) throw new Error("INVALID_MANUAL_PROOF");
    const policy = sourceSafetyPolicySchema.parse(revision.safetyPolicy);
    const original = analyzeImportSafety({ recordCount: revision.recordCount, invalidRecordCount: 0,
      previousGoodRecordCount, issues: [] }, policy);
    if (original.disposition !== "SUSPICIOUS" || original.metrics.criticalIssueCount !== 0
      || normalizedContentHash(policy) !== proof.policyHash
      || normalizedContentHash(original) !== proof.originalAnalysisHash) throw new Error("INVALID_MANUAL_PROOF");
    const review = z.object({ reviewedBy: z.string().trim().min(1).max(128),
      reviewedAt: z.string().datetime(), reason: z.string().trim().min(1).max(2000) }).strict()
      .parse(z.object({ review: z.unknown() }).parse(revision.safetyAnalysis).review);
    const reviewed = reviewSuspiciousImport(original, { decision: "APPROVE", ...review });
    if (normalizedContentHash(reviewed) !== normalizedContentHash(revision.safetyAnalysis)
      || normalizedContentHash(reviewed) !== proof.reviewedAnalysisHash) throw new Error("INVALID_MANUAL_PROOF");
    return { version: 1 as const, disposition: "APPROVED" as const,
      requestId: proof.requestId, requestHash: proof.requestHash,
      policyHash: proof.policyHash, analysisHash: proof.reviewedAnalysisHash, previousGoodRecordCount };
  } catch { throw new Error("SOURCE_REVISION_MANUAL_APPROVAL_INVALID"); }
}
