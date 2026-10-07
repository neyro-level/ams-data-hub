import { analyzeImportSafety } from "../domain/safety-engine.ts";
import { sourceSafetyPolicySchema } from "../domain/source-safety-policy-schema.ts";
import { normalizedContentHash } from "./import-pipeline.ts";

/** Same revision-bound approval predicate for actual apply and snapshot capture.
 * No current Source policy, review actor/reason or producer data enters the proof. */
export function assertSourceRevisionApproval(revision: {
  safetyPolicy: unknown; safetyAnalysis: unknown; recordCount: number; invalidRecordCount: number;
}, previousGoodRecordCount: number | null) {
  try {
    const policy = sourceSafetyPolicySchema.parse(revision.safetyPolicy);
    const analysis = analyzeImportSafety({ recordCount: revision.recordCount, invalidRecordCount: revision.invalidRecordCount,
      previousGoodRecordCount, issues: revision.invalidRecordCount > 0 ? [{ severity: "CRITICAL", code: "SOURCE_RECORD_INVALID" }] : [],
    }, policy);
    if (analysis.disposition !== "SAFE" || normalizedContentHash(analysis) !== normalizedContentHash(revision.safetyAnalysis)) {
      throw new Error("SOURCE_REVISION_SAFETY_INVALID");
    }
    return { version: 1 as const, disposition: "SAFE" as const, policyHash: normalizedContentHash(policy),
      analysisHash: normalizedContentHash(analysis), previousGoodRecordCount };
  } catch {
    throw new Error("SOURCE_REVISION_SAFETY_INVALID");
  }
}
