import { canonicalJson, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { publicInventoryDtoSchema } from "@ams-data-hub/realty-contracts";
import type { VerifySnapshotResult } from "@ams-data-hub/snapshot-verifier";
import { prepareSnapshotPublicationSourceAnchors } from "../../ingestion-core/index.ts";
import { prepareSnapshotPublicationMediaPins, selectSnapshotPublicationMediaAnchors } from "../../media-assets/index.ts";
import { prepareSnapshotPublicationProjectAnchors, prepareSnapshotRollbackAgentContactPins } from "../../project-state/index.ts";
import { prepareSnapshotPublicationCatalogAnchors } from "../../shared-catalog/index.ts";
import type { SnapshotBuildInputReceipt, SnapshotInputPartKind } from "./snapshot-build-input.ts";
import { prepareSnapshotInventoryInput } from "./snapshot-inventory-input.ts";
import { selectSnapshotCatalog } from "./snapshot-catalog-selection.ts";
import { projectSnapshotCatalog } from "./snapshot-catalog-projector.ts";
import { prepareSnapshotAgentBindings } from "./snapshot-agent-bindings.ts";
import { assertSnapshotProjectContact, snapshotRequiresProjectContact } from "./snapshot-project-contact.ts";
import { prepareSnapshotMediaProjectionInput, projectSnapshotMedia, snapshotMediaPublicSchema } from "./snapshot-media-projector.ts";
import { projectSnapshotProjectState } from "./snapshot-project-state-projector.ts";

type Accepted = Extract<VerifySnapshotResult, { accepted: true }>;
const invalid = (): never => { throw new Error("SNAPSHOT_SELECTED_ADMISSION_INVALID"); };
const json = (value: unknown) => canonicalJson(value as CanonicalJsonValue);
// Multiset, not set: distinct private price/event IDs may project equal values.
function sameValues(expected: readonly unknown[], actual: readonly unknown[]) {
  if (expected.length !== actual.length) invalid();
  const left = expected.map(json).sort(); const right = actual.map(json).sort();
  if (left.some((value, index) => value !== right[index])) invalid();
}

/** Internal persisted capture + fixed-policy authenticated artifacts only.
 * Pure attribution/preparation, NOT fresh authorization or publication. No GOOD
 * resolution, re-signing, HEAD/PUT, database reads or private-ID reconstruction. */
export function prepareSelectedSnapshotAdmission(receipt: SnapshotBuildInputReceipt, verified: Accepted) {
  const captured = prepareSnapshotInventoryInput(receipt); // Validates bounded receipt/hash before projection.
  const { manifest, datasets } = verified;
  if (!verified.accepted || manifest.projectId !== receipt.projectId || manifest.schemaMajor !== 1
    || manifest.schemaMinor !== receipt.schemaMinor || manifest.publishSequence !== receipt.publishSequence
    || manifest.generatedAt !== receipt.capturedAt.toISOString() || manifest.publishedAt !== receipt.capturedAt.toISOString()
    || manifest.catalogRevision !== receipt.catalogRevision) invalid();
  if (json(manifest.sourceRevisions) !== json(captured.sourceRevisions)) invalid();
  const rows = (kind: SnapshotInputPartKind) => receipt.parts.filter((part) => part.kind === kind).flatMap((part) => part.payload);
  const sourceAnchors = prepareSnapshotPublicationSourceAnchors({ sources: rows("sources"), inventory: rows("inventory") });
  const selection = selectSnapshotCatalog(receipt);
  const catalog = projectSnapshotCatalog(receipt, selection);
  for (const dataset of catalog) sameValues(dataset.records.map((row) => row.value), datasets[dataset.kind]);
  const catalogAnchors = prepareSnapshotPublicationCatalogAnchors({ projectId: receipt.projectId,
    subscriptions: rows("subscription"), catalog: rows("catalog"),
    publishedDevelopers: new Set(catalog.find((dataset) => dataset.kind === "developers")!.records.map((row) => row.key)),
    publishedDevelopments: selection.developmentUids, publishedBuildings: selection.buildingUids });

  const attachments = datasets.media.map((row) => snapshotMediaPublicSchema.parse(row));
  const preparedMedia = prepareSnapshotMediaProjectionInput(receipt, selection);
  const slots = new Map<string, number>();
  for (const { candidate } of preparedMedia.candidates) {
    const key = `${candidate.entityType}/${candidate.entityUid}/${candidate.position}`;
    slots.set(key, (slots.get(key) ?? 0) + 1);
  }
  for (const row of attachments) {
    if (slots.get(`${row.entityType}/${row.entityUid}/${row.media.position}`) !== 1
      || json(row.media) !== json({ ref: row.media.ref, kind: "IMAGE", position: row.media.position })) invalid();
  }
  // Missing BUILD HEAD results remain omitted; added/ambiguous/unsupported slots
  // cannot acquire anchors merely by appearing in a signed public dataset.
  const mediaAnchors = selectSnapshotPublicationMediaAnchors(receipt.projectId,
    prepareSnapshotPublicationMediaPins(preparedMedia), attachments);
  const media = projectSnapshotMedia(attachments);
  const projectState = projectSnapshotProjectState(receipt, media.agentMedia, selection);
  for (const dataset of projectState) sameValues(dataset.records.map((row) => row.value), datasets[dataset.kind]);
  const eligibleAgents = new Set(projectState.find((dataset) => dataset.kind === "agents")!.records.map((row) => row.key));
  const agents = prepareSnapshotAgentBindings(receipt, captured.rows, eligibleAgents);
  const inventory = datasets.inventory.map((row) => publicInventoryDtoSchema.parse(row));
  sameValues(captured.rows.map((row) => row.pin.uid), inventory.map((row) => row.uid));
  const byUid = new Map(captured.rows.map((row) => [row.pin.uid, row]));
  for (const row of inventory) {
    const pin = byUid.get(row.uid);
    if (!pin || row.publicUrlId !== pin.url.publicUrlId || row.agentUid !== agents.get(row.uid)) invalid();
  }
  const requiresProjectContact = snapshotRequiresProjectContact(captured.rows.map((row) => row.pin.uid), agents);
  assertSnapshotProjectContact(projectState, receipt.projectId, requiresProjectContact);
  const projectAnchors = prepareSnapshotPublicationProjectAnchors({ project: rows("project"), contacts: rows("contacts"),
    agents: rows("agents"), links: rows("listing-links"), publishedAgentUids: eligibleAgents,
    publishedBindings: agents, requiresContact: requiresProjectContact });
  const rollbackAgentContacts = prepareSnapshotRollbackAgentContactPins(datasets.agents);
  return { sourceAnchors, catalogAnchors, projectAnchors, mediaAnchors, requiresProjectContact, rollbackAgentContacts };
}
