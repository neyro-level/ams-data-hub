import "server-only";
import { z } from "zod";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ObjectStorage } from "../../../platform/storage/object-storage.ts";
import { createSnapshotGoodFactResolver } from "../../ingestion-core/server.ts";
import { prepareSnapshotPublicationSourceAnchors } from "../../ingestion-core/index.ts";
import { prepareSnapshotPublicationProjectAnchors } from "../../project-state/index.ts";
import type { SnapshotDatasetInput, SnapshotRecordInput } from "../contracts.ts";
import { SNAPSHOT_INPUT_PAGE_SIZE } from "../application/snapshot-build-input.ts";
import { SnapshotAssemblyBudget } from "../application/snapshot-assembly-budget.ts";
import { projectSnapshotCatalog } from "../application/snapshot-catalog-projector.ts";
import { selectSnapshotCatalog } from "../application/snapshot-catalog-selection.ts";
import { assertSnapshotDatasetIntegrity } from "../application/snapshot-composer.ts";
import { prepareSnapshotInventoryInput } from "../application/snapshot-inventory-input.ts";
import { prepareSnapshotAgentBindings } from "../application/snapshot-agent-bindings.ts";
import { assertSnapshotProjectContact, snapshotRequiresProjectContact } from "../application/snapshot-project-contact.ts";
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
    const sourceAnchors = prepareSnapshotPublicationSourceAnchors({
      sources: receipt.parts.filter((part) => part.kind === "sources").flatMap((part) => part.payload),
      inventory: receipt.parts.filter((part) => part.kind === "inventory").flatMap((part) => part.payload),
    });
    const selection = selectSnapshotCatalog(receipt);
    const catalog = projectSnapshotCatalog(receipt, selection);
    const preview = projectSnapshotProjectState(receipt, new Map(), selection); // Admission validation before object IO.
    const agents = prepareSnapshotAgentBindings(receipt, captured.rows,
      new Set(preview.find((dataset) => dataset.kind === "agents")!.records.map((record) => record.key)));
    const requiresProjectContact = snapshotRequiresProjectContact(captured.rows.map((row) => row.pin.uid), agents);
    assertSnapshotProjectContact(preview, receipt.projectId, requiresProjectContact);
    const projectAnchors = prepareSnapshotPublicationProjectAnchors({
      project: receipt.parts.filter((part) => part.kind === "project").flatMap((part) => part.payload),
      contacts: receipt.parts.filter((part) => part.kind === "contacts").flatMap((part) => part.payload),
      agents: receipt.parts.filter((part) => part.kind === "agents").flatMap((part) => part.payload),
      links: receipt.parts.filter((part) => part.kind === "listing-links").flatMap((part) => part.payload),
      publishedAgentUids: new Set(preview.find((dataset) => dataset.kind === "agents")!.records.map((record) => record.key)),
      publishedBindings: agents, requiresContact: requiresProjectContact,
    });
    const media = await projectMedia(receipt, selection); // No transaction remains open here.
    const projectState = projectSnapshotProjectState(receipt, media.agentMedia, selection);
    const publicAgents = projectState.find((dataset) => dataset.kind === "agents")!.records;
    const anchoredAgents = new Set(projectAnchors.agents.map((row) => row.uid));
    if (publicAgents.length !== anchoredAgents.size || publicAgents.some((row) => !anchoredAgents.has(row.key))) {
      throw new Error("SNAPSHOT_PUBLICATION_PROJECT_ANCHORS_INVALID");
    }
    const budget = new SnapshotAssemblyBudget();
    for (const dataset of [...catalog, ...projectState, media.dataset]) budget.add(dataset.kind, dataset.records);
    const records = await runInAuthorizedDatabaseTransaction(context, async (tx) => {
      const resolve = createSnapshotGoodFactResolver(tx); const output: SnapshotRecordInput[] = [];
      for (let offset = 0; offset < captured.rows.length; offset += SNAPSHOT_INPUT_PAGE_SIZE) {
        const page = captured.rows.slice(offset, offset + SNAPSHOT_INPUT_PAGE_SIZE);
        const facts = await resolve(scope, page.map((row) => row.pin), captured.factProfiles);
        const projected = projectSnapshotInventory(scope, page.map((row, index) => ({ ...row, fact: facts[index]!,
          ...(agents.has(row.pin.uid) ? { agentUid: agents.get(row.pin.uid)! } : {}),
          media: media.inventoryMedia.get(row.pin.uid) ?? [] })));
        budget.add("inventory", projected.records); output.push(...projected.records);
      }
      return output;
    }, options);
    const datasets: SnapshotDatasetInput[] = [...catalog, ...projectState, { kind: "inventory", records }, media.dataset];
    assertSnapshotDatasetIntegrity(datasets);
    return { receiptId: receipt.id, inputHash: receipt.inputHash, sourceAnchors, projectAnchors, requiresProjectContact, datasets, diagnostics: media.diagnostics,
      manifestMetadata: { projectId: receipt.projectId, schemaMinor: receipt.schemaMinor, publishSequence: receipt.publishSequence,
        generatedAt: receipt.capturedAt.toISOString(), catalogRevision: receipt.catalogRevision, sourceRevisions: captured.sourceRevisions } };
  };
}
