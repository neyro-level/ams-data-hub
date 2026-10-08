import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { Prisma } from "../../../generated/prisma/client.ts";
import { assertSourceRevisionApproval } from "../application/source-revision-approval.ts";
import { assertManualSourceRevisionApproval } from "../application/manual-source-revision-approval.ts";
import { normalizedContentHash } from "../application/import-pipeline.ts";

interface Pin { sourceId: string; revisionId: string; sequence: number }
type Approval = (ReturnType<typeof assertSourceRevisionApproval> | ReturnType<typeof assertManualSourceRevisionApproval>) & Pin & { baseRevisionId: string | null };

/** Scoped immutable revision/baseline proof; cache belongs only to this MVCC cut. */
export function createSnapshotRevisionApprovalReader(transaction: DatabaseTransaction,
  scope: { organizationId: string; projectId: string }) {
  const cache = new Map<string, Approval>();
  return async (pins: readonly Pin[]): Promise<ReadonlyMap<string, Approval>> => {
    if (pins.length > 200) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
    const requested = new Map<string, Pin>();
    for (const pin of pins) {
      const previous = requested.get(pin.revisionId) ?? cache.get(pin.revisionId);
      if (!pin.sourceId || !pin.revisionId || !Number.isSafeInteger(pin.sequence) || pin.sequence < 1
        || (previous && (previous.sourceId !== pin.sourceId || previous.sequence !== pin.sequence))) {
        throw new Error("SNAPSHOT_INPUT_SOURCE_APPROVAL_INVALID");
      }
      requested.set(pin.revisionId, pin);
    }
    const missing = [...requested.values()].filter((pin) => !cache.has(pin.revisionId));
    if (cache.size + missing.length > 50_000) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
    if (missing.length) {
      // Bound JSON bytes in PostgreSQL before Prisma can transfer private siblings.
      // Immutable GOOD rows and this same MVCC cut make the following read safe.
      const oversized = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "SourceRevision"
        WHERE "organizationId" = ${scope.organizationId} AND "projectId" = ${scope.projectId}
          AND "status" = 'GOOD' AND (${Prisma.join(missing.map((pin) => Prisma.sql`
            ("id" = ${pin.revisionId} AND "sourceId" = ${pin.sourceId} AND "sequence" = ${pin.sequence})`), " OR ")})
          AND (octet_length("safetyPolicy"::text) > 4096 OR octet_length("safetyAnalysis"::text) > 4096)
        LIMIT 1
      `);
      if (oversized.length) throw new Error("SNAPSHOT_INPUT_SOURCE_APPROVAL_INVALID");
      const revisions = await transaction.sourceRevision.findMany({ where: { organizationId: scope.organizationId, projectId: scope.projectId, status: "GOOD",
        OR: missing.map((pin) => ({ id: pin.revisionId, sourceId: pin.sourceId, sequence: pin.sequence })) }, take: 201,
      select: { id: true, organizationId: true,projectId: true,sourceId: true,sequence: true,sourceVersion: true,safetyPolicyVersion: true,baseLastGoodRevisionId: true,
        safetyPolicy: true, safetyAnalysis: true, recordCount: true, invalidRecordCount: true } });
      if (revisions.length !== missing.length) throw new Error("SNAPSHOT_INPUT_SOURCE_APPROVAL_INVALID");
      const baseIds = [...new Set(revisions.flatMap((row) => row.baseLastGoodRevisionId ? [row.baseLastGoodRevisionId] : []))];
      const baselines = baseIds.length ? await transaction.sourceRevision.findMany({ where: { organizationId: scope.organizationId, projectId: scope.projectId,
        status: "GOOD", id: { in: baseIds } }, take: 201,
      select: { id: true, sourceId: true, sequence: true, recordCount: true } }) : [];
      const bases = new Map(baselines.map((row) => [row.id, row]));
      for (const row of revisions) {
        const pin = requested.get(row.id)!; const base = row.baseLastGoodRevisionId ? bases.get(row.baseLastGoodRevisionId) : null;
        if (!pin || row.sourceId !== pin.sourceId || row.sequence !== pin.sequence || !row.sequence || (row.baseLastGoodRevisionId
          ? !base || base.sourceId !== row.sourceId || base.sequence !== row.sequence - 1
          : row.sequence !== 1)) throw new Error("SNAPSHOT_INPUT_SOURCE_APPROVAL_INVALID");
        try {
          let approval: ReturnType<typeof assertSourceRevisionApproval> | ReturnType<typeof assertManualSourceRevisionApproval>;
          if (row.safetyAnalysis && typeof row.safetyAnalysis === "object" && !Array.isArray(row.safetyAnalysis) && row.safetyAnalysis.disposition === "APPROVED") {
            const receipt = await transaction.sourceManualApprovalReceipt.findFirst({ where: { organizationId: scope.organizationId,projectId: scope.projectId,sourceId: row.sourceId,revisionId: row.id } });
            if (!receipt || receipt.sequence !== row.sequence) throw new Error("SNAPSHOT_INPUT_SOURCE_APPROVAL_INVALID");
            approval = assertManualSourceRevisionApproval(row,base?.recordCount ?? null,{ organizationId: receipt.organizationId,
              projectId: receipt.projectId,sourceId: receipt.sourceId,revisionId: receipt.revisionId,requestId: receipt.requestId,
              requestHash: receipt.requestHash,sourceVersion: receipt.sourceVersion,safetyPolicyVersion: receipt.safetyPolicyVersion,
              baseLastGoodRevisionId: receipt.baseLastGoodRevisionId,previousGoodRecordCount: receipt.previousGoodRecordCount,
              policyHash: normalizedContentHash(receipt.policy),originalAnalysisHash: normalizedContentHash(receipt.originalAnalysis),reviewedAnalysisHash: normalizedContentHash(receipt.reviewedAnalysis) });
          } else approval = assertSourceRevisionApproval(row, base?.recordCount ?? null);
          cache.set(row.id, { ...approval, ...pin, baseRevisionId: row.baseLastGoodRevisionId });
        } catch { throw new Error("SNAPSHOT_INPUT_SOURCE_APPROVAL_INVALID"); }
      }
    }
    return new Map([...requested.keys()].map((id) => [id, cache.get(id)!]));
  };
}
