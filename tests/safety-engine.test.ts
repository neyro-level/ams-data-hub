import { describe, expect, it } from "vitest";
import {
  analyzeImportSafety,
  BOOTSTRAP_SOURCE_SAFETY_POLICY,
  reviewSuspiciousImport,
} from "../src/modules/ingestion-core/index.ts";

describe("source safety engine", () => {
  it("ships conservative bootstrap defaults without invented calibration thresholds", () => {
    expect(BOOTSTRAP_SOURCE_SAFETY_POLICY).toEqual({
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
  });

  it("rejects empty and critical imports before apply", () => {
    expect(analyzeImportSafety({ recordCount: 0, previousGoodRecordCount: 100, invalidRecordCount: 0, issues: [] }))
      .toMatchObject({ disposition: "REJECTED", reasonCodes: expect.arrayContaining(["EMPTY_FEED_REJECTED", "DROP_THRESHOLD_EXCEEDED"]) });
    expect(analyzeImportSafety({ recordCount: 100, previousGoodRecordCount: 100, invalidRecordCount: 0, issues: [{ severity: "CRITICAL", code: "PRIVATE_FIELD_LEAK" }] }))
      .toMatchObject({ disposition: "REJECTED", reasonCodes: ["CRITICAL_ISSUE"] });
  });

  it("holds a mass drop as SUSPICIOUS until an explicit review", () => {
    const suspicious = analyzeImportSafety({ recordCount: 70, previousGoodRecordCount: 100, invalidRecordCount: 0, issues: [] });
    expect(suspicious).toMatchObject({ disposition: "SUSPICIOUS", reasonCodes: ["DROP_THRESHOLD_EXCEEDED"], metrics: { dropPercent: 30 } });
    const approved = reviewSuspiciousImport(suspicious, {
      decision: "APPROVE",
      reviewedBy: "owner-fixture",
      reviewedAt: "2026-10-05T04:00:00.000Z",
      reason: "Synthetic fixture verified",
    });
    expect(approved).toMatchObject({ disposition: "APPROVED", review: { reviewedBy: "owner-fixture" } });
    expect(() => reviewSuspiciousImport(approved, {
      decision: "APPROVE", reviewedBy: "owner-fixture", reviewedAt: "2026-10-05T04:01:00.000Z", reason: "repeat",
    })).toThrow("SOURCE_SAFETY_REVIEW_NOT_PENDING");
  });

  it("enforces calibrated thresholds only when explicitly configured", () => {
    const policy = { ...BOOTSTRAP_SOURCE_SAFETY_POLICY, maxInvalidPercent: 5, maxGrowthPercent: 25 };
    expect(analyzeImportSafety({ recordCount: 110, previousGoodRecordCount: 100, invalidRecordCount: 11, issues: [] }, policy))
      .toMatchObject({ disposition: "SUSPICIOUS", reasonCodes: ["INVALID_THRESHOLD_EXCEEDED"] });
    expect(analyzeImportSafety({ recordCount: 130, previousGoodRecordCount: 100, invalidRecordCount: 0, issues: [] }, policy))
      .toMatchObject({ disposition: "SUSPICIOUS", reasonCodes: ["GROWTH_THRESHOLD_EXCEEDED"] });
  });
});
