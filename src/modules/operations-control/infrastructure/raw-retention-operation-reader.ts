import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";

/** Operations owns pending targets; no reason/result/credential data escapes. */
export function createRawRetentionOperationReader(tx: DatabaseTransaction) {
  return {
    async read(scope: { organizationId: string; projectId: string }) {
      const access = await tx.$queryRaw<{ allowed: boolean; isolation: string }[]>(Prisma.sql`
        SELECT public.raw_artifact_retention_scope(${scope.organizationId},${scope.projectId}) AS allowed,
          current_setting('transaction_isolation') AS isolation`);
      if (access.length !== 1 || access[0]!.allowed !== true) throw new Error("RAW_RETENTION_ACCESS_DENIED");
      if (access[0]!.isolation !== "read committed") throw new Error("RAW_RETENTION_FRESH_CUT_REQUIRED");
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0))::text`);
      const rows = await tx.operationalActionRequest.findMany({ where: { ...scope, status: { in: ["REQUESTED", "RUNNING"] } },
        take: 501, orderBy: { id: "asc" }, select: { action: true, buildInputId: true, sourcePublishSequence: true, sourceRevisionId: true } });
      let complete = rows.length <= 500;
      const buildInputIds = new Set<string>(); const sourcePublishSequences = new Set<number>();
      const sourceRevisionIds = new Set<string>();
      for (const row of rows) {
        if (row.action === "SNAPSHOT_PUBLISH") {
          if (!row.buildInputId) complete = false; else buildInputIds.add(row.buildInputId);
        }
        if (row.action === "SNAPSHOT_ROLLBACK") {
          if (!row.sourcePublishSequence) complete = false; else sourcePublishSequences.add(row.sourcePublishSequence);
        }
        if (row.action === "SUSPICIOUS_APPROVE" || row.action === "SUSPICIOUS_REJECT") {
          if (!row.sourceRevisionId) complete = false; else sourceRevisionIds.add(row.sourceRevisionId);
        }
      }
      return { ...scope, coverage: complete ? "COMPLETE" as const : "INCOMPLETE" as const,
        buildInputIds: [...buildInputIds], sourcePublishSequences: [...sourcePublishSequences], sourceRevisionIds: [...sourceRevisionIds] };
    },
  };
}
