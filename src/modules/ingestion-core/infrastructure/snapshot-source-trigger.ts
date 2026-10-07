import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction,
  type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { sourceGoodSnapshotBuildRequestSchema, type SourceGoodSnapshotBuildRequest } from "../../snapshot-delivery/contracts.ts";

/** GOOD trigger membership, not current-head equality or proof of canonical enqueue provenance. */
export function createSnapshotSourceGoodTriggerReader(tx: DatabaseTransaction) {
  return async (raw: SourceGoodSnapshotBuildRequest): Promise<void> => {
    const input = sourceGoodSnapshotBuildRequestSchema.parse(raw);
    const access = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`
      SELECT snapshot_publication_scope(${input.organizationId}, ${input.projectId}) AS allowed`);
    if (access.length !== 1 || !access[0]!.allowed) throw new Error("SNAPSHOT_BUILD_REQUEST_INVALID");
    const revision = await tx.sourceRevision.findFirst({ where: { organizationId: input.organizationId, projectId: input.projectId,
      sourceId: input.sourceId, id: input.sourceRevisionId, sequence: input.sourceRevisionSequence, status: "GOOD" }, select: { id: true } });
    if (!revision) throw new Error("SNAPSHOT_BUILD_REQUEST_INVALID");
  };
}

/** Narrow short read with existing publication SELECT scope; no rows/payloads returned. */
export async function assertSnapshotSourceGoodTrigger(principal: PrincipalContext, input: SourceGoodSnapshotBuildRequest): Promise<void> {
  const parsed = sourceGoodSnapshotBuildRequestSchema.parse(input);
  if (principal.kind !== "project-job" || principal.jobName !== "snapshot-input"
    || principal.organizationId !== parsed.organizationId || principal.projectId !== parsed.projectId) {
    throw new Error("SNAPSHOT_BUILD_REQUEST_INVALID");
  }
  const publication = createProjectJobPrincipal({ organizationId: parsed.organizationId, projectId: parsed.projectId,
    jobName: "snapshot-publication", correlationId: principal.correlationId });
  await runInAuthorizedDatabaseTransaction(createDatabaseAuthorizationContext(publication),
    (tx) => createSnapshotSourceGoodTriggerReader(tx)(parsed), { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
}
