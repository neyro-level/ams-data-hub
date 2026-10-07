import "server-only";
import { z } from "zod";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction,
  type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { createProjectSnapshotKey } from "../../../platform/storage/object-storage.ts";
import type { SnapshotBuildInputReceipt } from "../application/snapshot-build-input.ts";
import { PrismaSnapshotInputRepository } from "./prisma-snapshot-input-repository.ts";
import { PrismaSnapshotDeliveryRepository } from "./prisma-snapshot-delivery-repository.ts";
import { lockSnapshotPublication } from "./snapshot-publication-lock.ts";

export const snapshotPublicationLookupSchema = z.object({ idempotencyKeyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();

export type SnapshotPublicationReceiptHeader = Pick<SnapshotBuildInputReceipt,
  "id" | "organizationId" | "projectId" | "inputHash" | "publishSequence" | "capturedAt">;

/** Internal caller owns global -> publication locks, using an actual persisted receipt. */
export async function readCommittedSnapshotRun(tx: DatabaseTransaction,
  scope: { organizationId: string; projectId: string }, receipt: SnapshotPublicationReceiptHeader) {
  const run = await new PrismaSnapshotDeliveryRepository(tx).getRun(scope.organizationId, scope.projectId, receipt.publishSequence);
  if (!run) return null;
  const binding = await tx.snapshotPublicationBinding.findUnique({ where: {
    organizationId_projectId_buildInputId: { ...scope, buildInputId: receipt.id } } });
  if (receipt.organizationId !== scope.organizationId || receipt.projectId !== scope.projectId
    || !binding || binding.inputHash !== receipt.inputHash || binding.publishSequence !== receipt.publishSequence
    || run.manifestSha256 !== binding.manifestSha256
    || run.manifestKey !== createProjectSnapshotKey(scope.projectId, binding.manifestSha256)
    || run.publishedAt.getTime() !== receipt.capturedAt.getTime()) {
    throw new Error("SNAPSHOT_PUBLICATION_COMMITTED_CONFLICT");
  }
  return run;
}

/** Config-free server seam: replay before fresh capture or resolving any secrets/storage. */
export async function inspectSnapshotPublicationServer(principal: PrincipalContext,
  rawLookup: z.input<typeof snapshotPublicationLookupSchema>) {
  if (principal.kind !== "project-job" || principal.jobName !== "snapshot-input") throw new Error("SNAPSHOT_INPUT_ACCESS_DENIED");
  const scope = { organizationId: principal.organizationId, projectId: principal.projectId };
  const lookup = snapshotPublicationLookupSchema.parse(rawLookup);
  const receipt = await runInAuthorizedDatabaseTransaction(createDatabaseAuthorizationContext(principal),
    (tx) => new PrismaSnapshotInputRepository(tx).find(scope.organizationId, scope.projectId,
      lookup.idempotencyKeyHash, lookup.requestHash), { isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 30_000 });
  if (!receipt) return { receipt: null, run: null };
  const context = createDatabaseAuthorizationContext(createProjectJobPrincipal({ ...scope,
    jobName: "snapshot-publication", correlationId: principal.correlationId }));
  const run = await runInAuthorizedDatabaseTransaction(context, async (tx) => {
    await lockSnapshotPublication(tx, scope); return readCommittedSnapshotRun(tx, scope, receipt);
  }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
  return { receipt, run };
}
