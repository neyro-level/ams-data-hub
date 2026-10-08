import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";

/** The outer capture owns global. Never reacquire it on this fresh RC connection. */
export function createRawPinAdmissionReader(tx: DatabaseTransaction) {
  return {
    async assertAvailable(scope: { organizationId: string; projectId: string },
      revisionIds: readonly string[], capturedHashes: readonly string[]) {
      const access = await tx.$queryRaw<{ allowed: boolean; isolation: string }[]>(Prisma.sql`
        SELECT public.snapshot_input_scope(${scope.organizationId},${scope.projectId}) AS allowed,
          current_setting('transaction_isolation') AS isolation`);
      if (access.length !== 1 || access[0]!.allowed !== true || access[0]!.isolation !== "read committed") {
        throw new Error("RAW_PIN_ADMISSION_ACCESS_DENIED");
      }
      if (revisionIds.length > 50_000 || capturedHashes.length > 50_000) throw new Error("RAW_PIN_ADMISSION_LIMIT");
      const hashes = new Set(capturedHashes); const ids = [...new Set(revisionIds)];
      for (let start = 0; start < ids.length; start += 200) {
        const page = ids.slice(start, start + 200);
        const revisions = await tx.sourceRevision.findMany({ where: { ...scope, id: { in: page }, status: "GOOD" },
          select: { id: true, rawArtifactHash: true } });
        if (revisions.length !== page.length) throw new Error("RAW_PIN_ADMISSION_PROVENANCE_INVALID");
        for (const revision of revisions) if (revision.rawArtifactHash) hashes.add(revision.rawArtifactHash);
      }
      for (const rawArtifactHash of hashes) if (!/^[a-f0-9]{64}$/u.test(rawArtifactHash)) {
        throw new Error("RAW_PIN_ADMISSION_PROVENANCE_INVALID");
      }
      const pending = await tx.$queryRaw<{ blocked: boolean }[]>(Prisma.sql`
        SELECT EXISTS (SELECT 1 FROM public."RawArtifactDeletion" d
          WHERE d."organizationId"=${scope.organizationId} AND d."projectId"=${scope.projectId}
            AND d.status IN ('PENDING','ACKNOWLEDGED')
            AND d."rawArtifactHash" IN (SELECT jsonb_array_elements_text(${JSON.stringify([...hashes])}::jsonb))) AS blocked`);
      if (pending.length !== 1) throw new Error("RAW_PIN_ADMISSION_READ_INVALID");
      if (pending[0]!.blocked) throw Object.assign(new Error("RAW_RETENTION_IN_PROGRESS"), { retryable: true });
    },
  };
}
