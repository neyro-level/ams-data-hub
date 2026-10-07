import { describe, expect, it } from "vitest";
import { assertSourceRevisionApproval } from "../src/modules/ingestion-core/application/source-revision-approval.ts";
import { analyzeImportSafety, BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../src/modules/ingestion-core/index.ts";

function revision(recordCount = 10, previousGoodRecordCount: number | null = null) {
  return { recordCount, invalidRecordCount: 0, safetyPolicy: { ...BOOTSTRAP_SOURCE_SAFETY_POLICY },
    safetyAnalysis: analyzeImportSafety({ recordCount, previousGoodRecordCount, invalidRecordCount: 0, issues: [] }) };
}
describe("revision-bound source approval predicate", () => {
  it("returns only value-free hashes and pinned baseline for SAFE evidence", () => {
    const value = revision(10, 10); const before = structuredClone(value);
    expect(assertSourceRevisionApproval(value, 10)).toEqual({ version: 1, disposition: "SAFE",
      policyHash: expect.stringMatching(/^[a-f0-9]{64}$/u), analysisHash: expect.stringMatching(/^[a-f0-9]{64}$/u), previousGoodRecordCount: 10 });
    expect(value).toEqual(before);
  });
  it("rejects missing/forged policy, analysis, baseline, invalid counts and suspicious/rejected runs", () => {
    for (const value of [{ ...revision(), safetyPolicy: {} }, { ...revision(), safetyAnalysis: null },
      { ...revision(), invalidRecordCount: 1 }, { ...revision(), recordCount: -1 }, revision(0), revision(1, 10),
      { ...revision(), safetyAnalysis: { ...revision().safetyAnalysis, review: { reviewedBy: "private", reason: "private" } } }]) {
      expect(() => assertSourceRevisionApproval(value, value.safetyAnalysis && "metrics" in value.safetyAnalysis
        ? value.safetyAnalysis.metrics.previousGoodRecordCount : null)).toThrow("SOURCE_REVISION_SAFETY_INVALID");
    }
    expect(() => assertSourceRevisionApproval(revision(), 10)).toThrow("SOURCE_REVISION_SAFETY_INVALID");
  });
});
