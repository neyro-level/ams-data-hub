import "server-only";
import { z } from "zod";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction } from "../../../platform/database/transaction.ts";
import { PrismaSnapshotDeliveryRepository } from "./prisma-snapshot-delivery-repository.ts";
import { createSnapshotRollbackStagingServer } from "./snapshot-rollback-staging.ts";
import { Prisma } from "../../../generated/prisma/client.ts";

const lookupSchema = z.object({ requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  sourcePublishSequence: z.number().int().positive().max(2_147_483_647) }).strict();
type Proof = { deliveryRunId: string; publishSequence: number; manifestSha256: string };

/** Config/capture/IO-free IDs-only replay. No binding or private facts escape. */
export async function inspectSnapshotRollbackRunServer(principal: PrincipalContext, rawLookup: z.input<typeof lookupSchema>) {
  if (principal.kind !== "project-job" || principal.jobName !== "snapshot-input") throw new Error("SNAPSHOT_INPUT_ACCESS_DENIED");
  const scope = { organizationId: principal.organizationId, projectId: principal.projectId }; const lookup = lookupSchema.parse(rawLookup);
  const context = createDatabaseAuthorizationContext(createProjectJobPrincipal({ ...scope, jobName: "snapshot-publication", correlationId: principal.correlationId }));
  return runInAuthorizedDatabaseTransaction(context, async (tx) => {
    const rows = await tx.$queryRaw<Proof[]>(Prisma.sql`SELECT * FROM snapshot_rollback_operation_proof(${scope.organizationId},${scope.projectId},${lookup.requestId},${lookup.sourcePublishSequence}::integer)`);
    if (!rows.length) return null;
    if (rows.length !== 1) throw new Error("SNAPSHOT_ROLLBACK_COMMITTED_CONFLICT");
    const run = await new PrismaSnapshotDeliveryRepository(tx).getRun(scope.organizationId, scope.projectId, rows[0]!.publishSequence);
    if (!run || run.deliveryRunId !== rows[0]!.deliveryRunId || run.manifestSha256 !== rows[0]!.manifestSha256) throw new Error("SNAPSHOT_ROLLBACK_COMMITTED_CONFLICT");
    return run;
  }, { isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 5000 });
}

/** Public server boundary returns only an owned finish closure, not metadata,
 * root captures, artifact bodies or admission anchors. */
export function createSnapshotRollbackServer(bound: Parameters<typeof createSnapshotRollbackStagingServer>[0]) {
  const stage = createSnapshotRollbackStagingServer(bound);
  return async (...input: Parameters<typeof stage>) => (await stage(...input)).finish;
}
