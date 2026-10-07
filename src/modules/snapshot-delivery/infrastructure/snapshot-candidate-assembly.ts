import "server-only";
import { z } from "zod";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ObjectStorage } from "../../../platform/storage/object-storage.ts";
import { createSnapshotGoodFactResolver } from "../../ingestion-core/server.ts";
import type { SnapshotDatasetInput, SnapshotRecordInput } from "../contracts.ts";
import { SNAPSHOT_INPUT_PAGE_SIZE } from "../application/snapshot-build-input.ts";
import { SnapshotAssemblyBudget } from "../application/snapshot-assembly-budget.ts";
import { projectSnapshotCatalog } from "../application/snapshot-catalog-projector.ts";
import { selectSnapshotCatalog } from "../application/snapshot-catalog-selection.ts";
import { assertSnapshotDatasetIntegrity } from "../application/snapshot-composer.ts";
import { prepareSnapshotInventoryInput } from "../application/snapshot-inventory-input.ts";
import { projectSnapshotInventory } from "../application/snapshot-inventory-projector.ts";
import { projectSnapshotProjectState } from "../application/snapshot-project-state-projector.ts";
import { PrismaSnapshotInputRepository } from "./prisma-snapshot-input-repository.ts";
import { createSnapshotMediaProjectionServer } from "./snapshot-media-projection.ts";

const lookupSchema = z.object({ idempotencyKeyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();

/** Server-owned candidate assembly from persisted receipts only. Not a publisher. */
export function createSnapshotCandidateAssemblyServer(bound: { organizationId: string; projectId: string; storage: Pick<ObjectStorage, "head"> }) {
  const scope = { organizationId: bound.organizationId, projectId: bound.projectId };
  const projectMedia = createSnapshotMediaProjectionServer(bound);
  return async (principal: PrincipalContext, rawLookup: z.input<typeof lookupSchema>) => {
    if (principal.kind !== "project-job" || principal.jobName !== "snapshot-input"
      || principal.organizationId !== scope.organizationId || principal.projectId !== scope.projectId) {
      throw new Error("SNAPSHOT_INPUT_ACCESS_DENIED");
    }
    const lookup = lookupSchema.parse(rawLookup); const context = createDatabaseAuthorizationContext(principal);
    const options = { isolationLevel: "RepeatableRead" as const, maxWait: 2000, timeout: 30_000 };
    const receipt = await runInAuthorizedDatabaseTransaction(context, (tx) => new PrismaSnapshotInputRepository(tx)
      .find(scope.organizationId, scope.projectId, lookup.idempotencyKeyHash, lookup.requestHash), options);
    if (!receipt) throw new Error("SNAPSHOT_INPUT_NOT_FOUND");
    const captured = prepareSnapshotInventoryInput(receipt);
    const selection = selectSnapshotCatalog(receipt);
    const catalog = projectSnapshotCatalog(receipt, selection);
    projectSnapshotProjectState(receipt, new Map(), selection); // Admission validation before any object IO.
    const media = await projectMedia(receipt, selection); // No transaction remains open here.
    const projectState = projectSnapshotProjectState(receipt, media.agentMedia, selection);
    const budget = new SnapshotAssemblyBudget();
    for (const dataset of [...catalog, ...projectState, media.dataset]) budget.add(dataset.kind, dataset.records);
    const records = await runInAuthorizedDatabaseTransaction(context, async (tx) => {
      const resolve = createSnapshotGoodFactResolver(tx); const output: SnapshotRecordInput[] = [];
      for (let offset = 0; offset < captured.rows.length; offset += SNAPSHOT_INPUT_PAGE_SIZE) {
        const page = captured.rows.slice(offset, offset + SNAPSHOT_INPUT_PAGE_SIZE);
        const facts = await resolve(scope, page.map((row) => row.pin), captured.factProfiles);
        const projected = projectSnapshotInventory(scope, page.map((row, index) => ({ ...row, fact: facts[index]!,
          media: media.inventoryMedia.get(row.pin.uid) ?? [] })));
        budget.add("inventory", projected.records); output.push(...projected.records);
      }
      return output;
    }, options);
    const datasets: SnapshotDatasetInput[] = [...catalog, ...projectState, { kind: "inventory", records }, media.dataset];
    assertSnapshotDatasetIntegrity(datasets);
    return { receiptId: receipt.id, inputHash: receipt.inputHash, datasets, diagnostics: media.diagnostics };
  };
}
