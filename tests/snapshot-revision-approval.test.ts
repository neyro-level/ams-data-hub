import { describe, expect, it, vi } from "vitest";
import { createSnapshotRevisionApprovalReader } from "../src/modules/ingestion-core/infrastructure/snapshot-revision-approval.ts";
import { analyzeImportSafety, BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../src/modules/ingestion-core/index.ts";
import type { DatabaseTransaction } from "../src/platform/database/transaction.ts";

const scope = { organizationId: "synthetic-org", projectId: "synthetic-project" };
function revision(id = "good", sequence = 1, baseLastGoodRevisionId: string | null = null, previousGoodRecordCount: number | null = null) {
  return { id, sourceId: "source", sequence, baseLastGoodRevisionId, recordCount: 10, invalidRecordCount: 0,
    safetyPolicy: { ...BOOTSTRAP_SOURCE_SAFETY_POLICY }, safetyAnalysis: analyzeImportSafety({
      recordCount: 10, invalidRecordCount: 0, previousGoodRecordCount, issues: [],
    }) };
}
function reader(rows = [revision()], oversized = false) {
  const queryRaw = vi.fn(async () => oversized ? [{ id: "good" }] : []);
  const findMany = vi.fn(async (query: { where: { organizationId: string; projectId: string; status: string;
    OR?: { id: string; sourceId: string; sequence: number }[]; id?: { in: string[] } }; take: number }) => {
    expect(query.where).toMatchObject({ ...scope, status: "GOOD" }); expect(query.take).toBe(201);
    return rows.filter((row) => query.where.OR ? query.where.OR.some((pin) => pin.id === row.id && pin.sourceId === row.sourceId
      && pin.sequence === row.sequence) : query.where.id!.in.includes(row.id));
  });
  return { findMany, queryRaw, approve: createSnapshotRevisionApprovalReader({ $queryRaw: queryRaw,
    sourceRevision: { findMany } } as unknown as DatabaseTransaction, scope) };
}
describe("scoped immutable snapshot approval reader", () => {
  it("validates exact baseline counts and caches only one capture cut", async () => {
    const value = reader([revision(), revision("head", 2, "good", 10)]);
    const pins = [{ sourceId: "source", revisionId: "head", sequence: 2 }];
    const proof = await value.approve(pins);
    expect(proof.get("head")).toMatchObject({ disposition: "SAFE", baseRevisionId: "good", previousGoodRecordCount: 10 });
    expect(await value.approve(pins)).toEqual(proof); expect(value.findMany).toHaveBeenCalledTimes(2);
    expect(value.queryRaw).toHaveBeenCalledTimes(1);
    await expect(value.approve([{ ...pins[0]!, sourceId: "foreign-source" }])).rejects.toThrow("APPROVAL_INVALID");
  });
  it("rejects oversized SQL markers without transferring either JSON object", async () => {
    const value = reader([revision()], true);
    await expect(value.approve([{ sourceId: "source", revisionId: "good", sequence: 1 }])).rejects.toThrow("APPROVAL_INVALID");
    expect(value.findMany).not.toHaveBeenCalled();
  });
  it("rejects missing/foreign baseline, non-monotonic sequence and forged analysis", async () => {
    for (const rows of [[revision("head", 2)], [revision("head", 2, "missing", 10)],
      [{ ...revision(), sourceId: "foreign" }, revision("head", 2, "good", 10)],
      [revision(), revision("head", 3, "good", 10)],
      [revision(), revision("head", 2, "good", null)],
      [{ ...revision(), safetyAnalysis: { ...revision().safetyAnalysis, disposition: "REJECTED" as const } }]]) {
      const value = reader(rows); const row = rows.at(-1)!;
      await expect(value.approve([{ sourceId: row.sourceId, revisionId: row.id, sequence: row.sequence }])).rejects.toThrow("APPROVAL_INVALID");
    }
  });
  it("admits no rows for empty contributions and bounds each lookup", async () => {
    const value = reader(); expect((await value.approve([])).size).toBe(0); expect(value.findMany).not.toHaveBeenCalled();
    await expect(value.approve(Array.from({ length: 201 }, () => ({ sourceId: "source", revisionId: "good", sequence: 1 }))))
      .rejects.toThrow("LIMIT_EXCEEDED");
  });
});
