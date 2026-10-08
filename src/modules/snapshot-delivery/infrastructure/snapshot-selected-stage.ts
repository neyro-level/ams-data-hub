import "server-only";
import { z } from "zod";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction,
  type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { PrismaSnapshotInputRepository } from "./prisma-snapshot-input-repository.ts";
import { PrismaSnapshotDeliveryRepository } from "./prisma-snapshot-delivery-repository.ts";
import { readCommittedSnapshotRun } from "./snapshot-publication-replay.ts";
import { lockSnapshotPublication } from "./snapshot-publication-lock.ts";

export const selectedSnapshotStageLookupSchema = z.object({
  buildInputId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
}).strict();
type Lookup = z.input<typeof selectedSnapshotStageLookupSchema>;

function ownedContext(principal: PrincipalContext) {
  if (principal.kind !== "project-job" || principal.jobName !== "snapshot-input") throw new Error("SNAPSHOT_INPUT_ACCESS_DENIED");
  const scope = { organizationId: principal.organizationId, projectId: principal.projectId };
  // Reuse the snapshot-owned publication read purpose. Binding is deliberately
  // NOT readable by snapshot-input or operations-executor; grants stay unchanged.
  const context = createDatabaseAuthorizationContext(createProjectJobPrincipal({ ...scope,
    jobName: "snapshot-publication", correlationId: principal.correlationId }));
  return { scope, context };
}

async function readSelectedStage(tx: DatabaseTransaction,
  scope: { organizationId: string; projectId: string }, lookup: Lookup) {
  const input = await tx.snapshotBuildInput.findFirst({ where: { ...scope, id: lookup.buildInputId }, select: {
    id: true, organizationId: true, projectId: true, idempotencyKeyHash: true, requestHash: true,
    inputHash: true, publishSequence: true, capturedAt: true,
  } });
  if (!input) return null;
  const where = { organizationId_projectId_buildInputId: { ...scope, buildInputId: input.id } };
  const stage = await tx.snapshotArtifactStageReceipt.findUnique({ where });
  if (!stage) return null; // Binding alone proves identity, not completed staging.
  const binding = await tx.snapshotPublicationBinding.findUnique({ where });
  if (!binding || stage.inputHash !== input.inputHash || binding.inputHash !== input.inputHash
    || stage.publishSequence !== input.publishSequence || binding.publishSequence !== input.publishSequence
    || stage.idempotencyKeyHash !== input.idempotencyKeyHash
    || (stage.requestHash !== null && stage.requestHash !== input.requestHash)
    || stage.manifestSha256 !== binding.manifestSha256) throw new Error("SNAPSHOT_STAGE_RECEIPT_INVALID");
  return { input, stage, binding };
}

/** Config-free selected-stage metadata/replay. No captured-part reads, fresh
 * admission, credential resolution, storage IO or current-pointer rewrite. */
export async function inspectSelectedSnapshotStageServer(principal: PrincipalContext, rawLookup: Lookup) {
  const { scope, context } = ownedContext(principal); const lookup = selectedSnapshotStageLookupSchema.parse(rawLookup);
  return runInAuthorizedDatabaseTransaction(context, async (tx) => {
    await lockSnapshotPublication(tx, scope);
    const selected = await readSelectedStage(tx, scope, lookup);
    if (!selected) return null;
    const run = await readCommittedSnapshotRun(tx, scope, selected.input);
    const current = await new PrismaSnapshotDeliveryRepository(tx).getCurrentManifest(scope.organizationId, scope.projectId);
    return { ...selected, run, current };
  }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
}

/** Snapshot-private immutable capture, read only when a new PUBLISH needs
 * admission. IDs-only Operations intent does not receive these facts. */
export async function loadSelectedSnapshotCaptureServer(principal: PrincipalContext, rawLookup: Lookup) {
  const { scope, context } = ownedContext(principal); const lookup = selectedSnapshotStageLookupSchema.parse(rawLookup);
  return runInAuthorizedDatabaseTransaction(context, async (tx) => {
    const selected = await readSelectedStage(tx, scope, lookup);
    if (!selected) throw new Error("SNAPSHOT_STAGE_NOT_FOUND");
    const receipt = await new PrismaSnapshotInputRepository(tx).find(scope.organizationId, scope.projectId,
      selected.input.idempotencyKeyHash, selected.input.requestHash);
    if (!receipt || receipt.id !== lookup.buildInputId || receipt.inputHash !== selected.input.inputHash
      || receipt.publishSequence !== selected.input.publishSequence
      || receipt.capturedAt.getTime() !== selected.input.capturedAt.getTime()) throw new Error("SNAPSHOT_STAGE_RECEIPT_INVALID");
    return { receipt, stage: selected.stage, binding: selected.binding };
  }, { isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 30_000 });
}
