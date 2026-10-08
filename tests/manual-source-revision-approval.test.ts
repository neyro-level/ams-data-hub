import { describe, expect, it } from "vitest";
import { assertManualSourceRevisionApproval } from "../src/modules/ingestion-core/application/manual-source-revision-approval.ts";
import { assertSourceRevisionApproval } from "../src/modules/ingestion-core/application/source-revision-approval.ts";
import { normalizedContentHash } from "../src/modules/ingestion-core/application/import-pipeline.ts";
import { analyzeImportSafety, BOOTSTRAP_SOURCE_SAFETY_POLICY, reviewSuspiciousImport } from "../src/modules/ingestion-core/domain/safety-engine.ts";

function fixture() {
  const policy = { ...BOOTSTRAP_SOURCE_SAFETY_POLICY };
  const original = analyzeImportSafety({ recordCount: 1, invalidRecordCount: 0, previousGoodRecordCount: 10, issues: [] }, policy);
  const reviewed = reviewSuspiciousImport(original, { decision: "APPROVE", reviewedBy: "synthetic-reviewer",
    reviewedAt: "2026-10-08T00:00:00.000Z", reason: "Synthetic private reason" });
  const revision = { organizationId: "org", projectId: "project", sourceId: "source", id: "revision",
    sourceVersion: 3, safetyPolicyVersion: 2, baseLastGoodRevisionId: "baseline", recordCount: 1,
    invalidRecordCount: 0, safetyPolicy: policy, safetyAnalysis: reviewed };
  const proof = { organizationId: "org", projectId: "project", sourceId: "source", revisionId: "revision",
    requestId: "accepted-request", requestHash: "a".repeat(64), sourceVersion: 3, safetyPolicyVersion: 2,
    baseLastGoodRevisionId: "baseline", previousGoodRecordCount: 10, policyHash: normalizedContentHash(policy),
    originalAnalysisHash: normalizedContentHash(original), reviewedAnalysisHash: normalizedContentHash(reviewed) };
  return { revision, proof, original };
}

describe("manual revision content validation is separate from durable approval authority", () => {
  it("recomputes pinned SUSPICIOUS and returns value-free proof without private review", () => {
    const { revision, proof } = fixture(); const before = structuredClone(revision);
    const result = assertManualSourceRevisionApproval(revision, 10, proof);
    expect(result).toEqual({ version: 1, disposition: "APPROVED", requestId: proof.requestId,
      requestHash: proof.requestHash, policyHash: proof.policyHash, analysisHash: proof.reviewedAnalysisHash,
      previousGoodRecordCount: 10 });
    expect(JSON.stringify(result)).not.toMatch(/synthetic-reviewer|Synthetic private reason/);
    expect(revision).toEqual(before);
    expect(() => assertSourceRevisionApproval(revision, 10)).toThrow("SOURCE_REVISION_SAFETY_INVALID");
  });
  it.each(["organizationId", "projectId", "sourceId", "revisionId", "baseLastGoodRevisionId",
    "sourceVersion", "safetyPolicyVersion", "previousGoodRecordCount", "policyHash", "originalAnalysisHash", "reviewedAnalysisHash"] as const)
  ("denies mismatched durable pin: %s", (key) => {
    const { revision, proof } = fixture();
    expect(() => assertManualSourceRevisionApproval(revision, 10, { ...proof,
      [key]: typeof proof[key] === "number" ? proof[key] + 1 : "foreign" })).toThrow("SOURCE_REVISION_MANUAL_APPROVAL_INVALID");
  });
  it("denies missing proof, private extra fields, forged review and unsafe content", () => {
    const { revision, proof, original } = fixture();
    for (const value of [null, {}, { ...proof, reviewedBy: "synthetic-reviewer" }])
      expect(() => assertManualSourceRevisionApproval(revision, 10, value)).toThrow("SOURCE_REVISION_MANUAL_APPROVAL_INVALID");
    for (const value of [{ ...revision, invalidRecordCount: 1 }, { ...revision, safetyAnalysis: original },
      { ...revision, safetyAnalysis: { ...revision.safetyAnalysis, disposition: "REJECTED" } },
      { ...revision, safetyAnalysis: { ...revision.safetyAnalysis, review: { ...revision.safetyAnalysis.review, reason: "forged" } } },
      { ...revision, safetyPolicy: { ...revision.safetyPolicy, requireManualApprovalAboveDrop: false } },
      { ...revision, recordCount: 0 }, { ...revision, recordCount: 10 }])
      expect(() => assertManualSourceRevisionApproval(value, 10, proof)).toThrow("SOURCE_REVISION_MANUAL_APPROVAL_INVALID");
  });
});
