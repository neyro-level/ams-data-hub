import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import { prepareSnapshotPublicationSourceAnchors } from "../src/modules/ingestion-core/index.ts";

function sections() {
  const source = { entityType: "source", sourceId: "synthetic-source", datasetType: "RESALE", sharingPolicy: "PROJECT_ONLY",
    enabled: true, sourceVersion: 99, privateMarker: "synthetic-private", approvedHead: {
      id: "head", status: "GOOD", sequence: 2, normalizedContentHash: "a".repeat(64), safetyAnalysis: "private" } };
  const inventory = { uid: createUlid(), sourceId: source.sourceId, status: "ACTIVE", normalizedHash: "b".repeat(64),
    factRevisionId: "historical", factRevisionSequence: 1, factProfileKey: "profile", factProfileVersion: "1.0.0",
    approvedHeadId: "head", approvedHeadSequence: 2, externalOfferId: "synthetic-private-external", payload: "private" };
  return { source, row: inventory, sources: [source], inventory: [inventory] };
}
describe("value-free captured publication source anchors", () => {
  it("owns metadata only and supports historical GOOD without volatile producer fields", () => {
    const input = sections(); const result = prepareSnapshotPublicationSourceAnchors({
      sources: [...input.sources, { entityType: "profile", configuration: "private" }], inventory: input.inventory });
    expect(result.sources).toEqual([{ sourceId: "synthetic-source", datasetType: "RESALE", sharingPolicy: "PROJECT_ONLY",
      approvedHead: { id: "head", sequence: 2, normalizedContentHash: "a".repeat(64) } }]);
    expect(JSON.stringify(result)).not.toMatch(/private|enabled|sourceVersion|externalOfferId|payload|safetyAnalysis/u);
    input.source.approvedHead.normalizedContentHash = "f".repeat(64);
    expect(result.sources[0]!.approvedHead!.normalizedContentHash).toBe("a".repeat(64));
  });
  it.each(["hash", "head", "future", "duplicate-source", "duplicate-inventory"])("rejects %s anchors", (mode) => {
    const input = sections();
    if (mode === "hash") input.source.approvedHead.normalizedContentHash = "bad";
    if (mode === "head") input.row.approvedHeadId = "foreign-head";
    if (mode === "future") input.row.factRevisionSequence = 3;
    if (mode === "duplicate-source") input.sources.push(input.source);
    if (mode === "duplicate-inventory") input.inventory.push(input.row);
    expect(() => prepareSnapshotPublicationSourceAnchors(input)).toThrow("SNAPSHOT_PUBLICATION_SOURCE_ANCHORS_INVALID");
  });
  it("keeps null-head sources and omits inactive private inventory", () => {
    expect(prepareSnapshotPublicationSourceAnchors({ sources: [{ entityType: "source", sourceId: "empty", datasetType: "AGENT",
      sharingPolicy: "PROJECT_ONLY", approvedHead: null }], inventory: [{ status: "INACTIVE", payload: "private" }] }))
      .toEqual({ sources: [{ sourceId: "empty", datasetType: "AGENT", sharingPolicy: "PROJECT_ONLY", approvedHead: null }], inventory: [] });
  });
  it("rejects combined overflow without truncation", () => {
    expect(() => prepareSnapshotPublicationSourceAnchors({ sources: Array(50_000).fill({ entityType: "profile" }), inventory: sections().inventory }))
      .toThrow("SNAPSHOT_PUBLICATION_SOURCE_ANCHORS_INVALID");
  });
});
