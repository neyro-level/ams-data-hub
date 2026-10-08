import { describe, expect, it } from "vitest";
import { planRawArtifactRetention, rawArtifactRetentionPolicySchema,
  type RawArtifactRetentionReference } from "../src/modules/ingestion-core/domain/raw-artifact-retention.ts";

const now = new Date("2026-10-08T12:00:00Z");
function reference(index: number, overrides: Partial<RawArtifactRetentionReference> = {}): RawArtifactRetentionReference {
  const hash = index.toString(16).padStart(64, "0");
  return { organizationId: "org", projectId: "project", sourceId: "source", revisionId: `revision-${index}`,
    rawArtifactHash: hash, storageKey: `source-artifacts/${hash}`, status: "GOOD", sequence: index,
    startedAt: new Date("2001-01-01"), completedAt: new Date("2001-01-02"), ...overrides };
}
function plan(references: RawArtifactRetentionReference[], options: Partial<Parameters<typeof planRawArtifactRetention>[0]> = {}) {
  return planRawArtifactRetention({ organizationId: "org", projectId: "project", now, references,
    pinnedRevisionIds: [], coverage: "COMPLETE", jobsFrozen: false, ...options });
}
describe("raw artifact retention union and project-wide dedup safety", () => {
  it("keeps last three old GOOD revisions AND a recent fourth, not an intersection", () => {
    const recent = new Date(now.getTime() - 10 * 86_400_000);
    const result = plan([reference(1), reference(2, { startedAt: recent, completedAt: recent }), reference(3), reference(4), reference(5)]);
    expect(result.filter((row) => row.eligible).map((row) => row.rawArtifactHash)).toEqual([reference(1).rawArtifactHash]);
    expect(result[1]!.reasons).toContain("RECENT_REFERENCE");
    for (const row of result.slice(2)) expect(row.reasons).toContain("LAST_GOOD_WINDOW");
  });
  it("retains a shared key when ANY other Source needs it; ranks GOOD per Source", () => {
    const old = reference(1);
    const result = plan([old, reference(2), reference(3), reference(4), reference(5, { sourceId: "other",
      rawArtifactHash: old.rawArtifactHash, storageKey: old.storageKey })]);
    expect(result.find((row) => row.rawArtifactHash === old.rawArtifactHash)).toMatchObject({ eligible: false, referenceCount: 2 });
    expect(result).toHaveLength(4);
  });
  it.each(["PENDING", "STAGED", "SUSPICIOUS"] as const)("retains old unsettled %s evidence", (status) => {
    expect(plan([reference(1, { status, sequence: null })])[0]).toMatchObject({ eligible: false, reasons: ["UNSETTLED_REFERENCE"] });
  });
  it("keeps LastGood/active/capture/rollback pins even outside both windows", () => {
    const result = plan([reference(1), reference(2), reference(3), reference(4)], { pinnedRevisionIds: ["revision-1"] });
    expect(result[0]).toMatchObject({ eligible: false, reasons: ["PINNED_REVISION"] });
  });
  it.each(["FAILED", "REJECTED"] as const)("allows old settled %s raw only without other references", (status) => {
    expect(plan([reference(1, { status, sequence: null })])[0]).toMatchObject({ eligible: true, reasons: [] });
  });
  it("retains exact 30-day boundary, late completions and future clock values", () => {
    const boundary = new Date(now.getTime() - 30 * 86_400_000);
    const result = plan([reference(1, { status: "FAILED", startedAt: boundary, completedAt: boundary }),
      reference(2, { status: "FAILED", completedAt: now }), reference(3, { status: "FAILED", completedAt: new Date("2099-01-01") })]);
    expect(result.every((row) => !row.eligible && row.reasons.includes("RECENT_REFERENCE"))).toBe(true);
  });
  it.each([{ coverage: "INCOMPLETE" as const }, { jobsFrozen: true }])("fails closed on incomplete cuts or freeze", (options) => {
    expect(plan([reference(1, { status: "FAILED" })], options)[0]!.eligible).toBe(false);
  });
  it("rejects foreign scope, key/hash disagreement, duplicate revisions and sequences", () => {
    expect(() => plan([reference(1, { projectId: "foreign" })])).toThrow("RAW_RETENTION_FOREIGN_REFERENCE");
    expect(() => plan([reference(1, { storageKey: "source-artifacts/foreign" })])).toThrow();
    expect(() => plan([reference(1), reference(1)])).toThrow("RAW_RETENTION_DUPLICATE_REVISION");
    expect(() => plan([reference(1), reference(2, { sequence: 1 })])).toThrow("RAW_RETENTION_DUPLICATE_GOOD_SEQUENCE");
  });
  it("rejects invalid clocks and malformed GOOD identities rather than dropping evidence", () => {
    expect(() => plan([reference(1, { completedAt: new Date(NaN) })])).toThrow();
    expect(() => plan([reference(1, { sequence: null })])).toThrow();
    expect(() => plan([reference(1, { completedAt: new Date("2000-01-01") })])).toThrow();
  });
  it("requires documented purpose for every deployment override, including shorter retention", () => {
    expect(() => rawArtifactRetentionPolicySchema.parse({ lastGoodRevisions: 3, recentDays: 60, documentedPurpose: null })).toThrow();
    expect(() => rawArtifactRetentionPolicySchema.parse({ lastGoodRevisions: 1, recentDays: 1, documentedPurpose: null })).toThrow();
    expect(rawArtifactRetentionPolicySchema.parse({ lastGoodRevisions: 3, recentDays: 60, documentedPurpose: "approved synthetic policy" }).recentDays).toBe(60);
  });
});
