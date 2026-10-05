import { z } from "zod";

export const importIssueSeveritySchema = z.enum(["INFO", "WARNING", "ERROR", "CRITICAL"]);
export const importIssueSchema = z.object({
  severity: importIssueSeveritySchema,
  code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,100}$/u),
  recordKey: z.string().trim().min(1).max(240).optional(),
  safeContext: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}).strict();

export type ImportIssue = z.infer<typeof importIssueSchema>;

export interface SourceSafetyPolicy {
  allowEmpty: boolean;
  maxDropPercent: number;
  requireManualApprovalAboveDrop: boolean;
  deactivationEnabled: boolean;
  inactiveAfterMissingGoodRuns: number;
  inactiveAfterMissingHours: number;
  sourceOverdueAfterHours: number;
  ackStaleAfterHours: number;
  minRecordCount: number | null;
  maxRecordCount: number | null;
  maxGrowthPercent: number | null;
  maxInvalidPercent: number | null;
}

export const BOOTSTRAP_SOURCE_SAFETY_POLICY: Readonly<SourceSafetyPolicy> = Object.freeze({
  allowEmpty: false,
  maxDropPercent: 20,
  requireManualApprovalAboveDrop: true,
  deactivationEnabled: false,
  inactiveAfterMissingGoodRuns: 2,
  inactiveAfterMissingHours: 24,
  sourceOverdueAfterHours: 24,
  ackStaleAfterHours: 24,
  minRecordCount: null,
  maxRecordCount: null,
  maxGrowthPercent: null,
  maxInvalidPercent: null,
});

export type SafetyDisposition = "SAFE" | "SUSPICIOUS" | "APPROVED" | "REJECTED";

export interface SafetyAnalysisResult {
  disposition: SafetyDisposition;
  reasonCodes: readonly string[];
  metrics: {
    recordCount: number;
    previousGoodRecordCount: number | null;
    invalidPercent: number;
    dropPercent: number;
    growthPercent: number;
    criticalIssueCount: number;
  };
  review?: { reviewedBy: string; reviewedAt: string; reason: string };
}

function percent(part: number, total: number): number {
  return total <= 0 ? 0 : (part / total) * 100;
}

export function analyzeImportSafety(input: {
  recordCount: number;
  previousGoodRecordCount: number | null;
  invalidRecordCount: number;
  issues: readonly ImportIssue[];
}, policy: SourceSafetyPolicy = BOOTSTRAP_SOURCE_SAFETY_POLICY): SafetyAnalysisResult {
  if (![input.recordCount, input.invalidRecordCount].every((value) => Number.isInteger(value) && value >= 0)) {
    throw new Error("SOURCE_SAFETY_METRICS_INVALID");
  }
  const issues = input.issues.map((issue) => importIssueSchema.parse(issue));
  const previous = input.previousGoodRecordCount;
  if (previous !== null && (!Number.isInteger(previous) || previous < 0)) throw new Error("SOURCE_SAFETY_METRICS_INVALID");
  const dropPercent = previous && input.recordCount < previous ? percent(previous - input.recordCount, previous) : 0;
  const growthPercent = previous && input.recordCount > previous ? percent(input.recordCount - previous, previous) : 0;
  const invalidPercent = percent(input.invalidRecordCount, Math.max(input.recordCount, input.invalidRecordCount));
  const criticalIssueCount = issues.filter((issue) => issue.severity === "CRITICAL").length;
  const reasonCodes = new Set<string>();
  let disposition: SafetyDisposition = "SAFE";

  if (criticalIssueCount > 0) {
    disposition = "REJECTED";
    reasonCodes.add("CRITICAL_ISSUE");
  }
  if (!policy.allowEmpty && input.recordCount === 0) {
    disposition = "REJECTED";
    reasonCodes.add("EMPTY_FEED_REJECTED");
  }
  if (dropPercent > policy.maxDropPercent) {
    reasonCodes.add("DROP_THRESHOLD_EXCEEDED");
    if (disposition !== "REJECTED") disposition = policy.requireManualApprovalAboveDrop ? "SUSPICIOUS" : "REJECTED";
  }
  const calibratedBreaches = [
    policy.minRecordCount !== null && input.recordCount < policy.minRecordCount ? "MIN_RECORD_COUNT_BREACHED" : null,
    policy.maxRecordCount !== null && input.recordCount > policy.maxRecordCount ? "MAX_RECORD_COUNT_BREACHED" : null,
    policy.maxGrowthPercent !== null && growthPercent > policy.maxGrowthPercent ? "GROWTH_THRESHOLD_EXCEEDED" : null,
    policy.maxInvalidPercent !== null && invalidPercent > policy.maxInvalidPercent ? "INVALID_THRESHOLD_EXCEEDED" : null,
  ].filter((value): value is string => value !== null);
  calibratedBreaches.forEach((code) => reasonCodes.add(code));
  if (calibratedBreaches.length > 0 && disposition === "SAFE") disposition = "SUSPICIOUS";

  return {
    disposition,
    reasonCodes: [...reasonCodes].sort(),
    metrics: { recordCount: input.recordCount, previousGoodRecordCount: previous, invalidPercent, dropPercent, growthPercent, criticalIssueCount },
  };
}

export function reviewSuspiciousImport(
  analysis: SafetyAnalysisResult,
  input: { decision: "APPROVE" | "REJECT"; reviewedBy: string; reviewedAt: string; reason: string },
): SafetyAnalysisResult {
  if (analysis.disposition !== "SUSPICIOUS") throw new Error("SOURCE_SAFETY_REVIEW_NOT_PENDING");
  const reviewedBy = input.reviewedBy.trim();
  const reason = input.reason.trim();
  if (!reviewedBy || !reason || !Number.isFinite(Date.parse(input.reviewedAt))) throw new Error("SOURCE_SAFETY_REVIEW_INVALID");
  return {
    ...analysis,
    disposition: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
    review: { reviewedBy, reviewedAt: input.reviewedAt, reason },
  };
}

export function assertSafetyApprovalEvidence(analysis: SafetyAnalysisResult): void {
  if (analysis.disposition !== "APPROVED") return;
  const reviewedBy = analysis.review?.reviewedBy.trim() ?? "";
  const reason = analysis.review?.reason.trim() ?? "";
  const reviewedAt = analysis.review?.reviewedAt ?? "";
  if (!reviewedBy || !reason || !Number.isFinite(Date.parse(reviewedAt))) {
    throw new Error("IMPORT_APPROVAL_EVIDENCE_INVALID");
  }
}
