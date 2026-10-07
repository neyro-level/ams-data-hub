import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import { prepareSnapshotPublicationCatalogAnchors } from "../src/modules/shared-catalog/index.ts";

function input() {
  const developer = createUlid(); const development = createUlid(); const building = createUlid(); const city = createUlid();
  return { projectId: "project", subscriptions: [{ mode: "CURATED", version: 1, cityUids: [city], selections: [{ developmentUid: development, decision: "INCLUDE" }] }],
    catalog: [{ entityType: "developer", uid: developer, lifecycle: "ACTIVE", mergedIntoUid: null, name: "private" },
      { entityType: "development", uid: development, lifecycle: "ACTIVE", mergedIntoUid: null, developerUid: developer, cityUid: city, districtUid: null, name: "private" },
      { entityType: "building", uid: building, lifecycle: "ACTIVE", mergedIntoUid: null, developmentUid: development, label: "private" }],
    publishedDevelopers: new Set([developer]), publishedDevelopments: new Set([development]), publishedBuildings: new Set([building]) };
}
describe("value-free selected catalog publication anchors", () => {
  it("copies only selected permission metadata and owns subscription membership", () => {
    const raw = input(); const result = prepareSnapshotPublicationCatalogAnchors(raw);
    expect(result.developments).toHaveLength(1); expect(result.buildings).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/private|name|label/u);
    raw.subscriptions[0]!.selections[0]!.decision = "EXCLUDE";
    expect(result.subscription.selections[0]!.decision).toBe("INCLUDE");
  });
  it.each(["duplicate-city", "duplicate-selection", "inactive", "merge", "missing-parent", "missing-row", "excluded", "all-shared-city", "duplicate-row"])("rejects %s", (mode) => {
    const raw = input();
    if (mode === "duplicate-city") raw.subscriptions[0]!.cityUids.push(raw.subscriptions[0]!.cityUids[0]!);
    if (mode === "duplicate-selection") raw.subscriptions[0]!.selections.push(raw.subscriptions[0]!.selections[0]!);
    if (mode === "inactive") raw.catalog[1]!.lifecycle = "ARCHIVED";
    if (mode === "merge") Object.assign(raw.catalog[1]!, { mergedIntoUid: createUlid() });
    if (mode === "missing-parent") raw.publishedDevelopers.clear();
    if (mode === "missing-row") raw.publishedBuildings.add(createUlid());
    if (mode === "excluded") raw.subscriptions[0]!.selections[0]!.decision = "EXCLUDE";
    if (mode === "all-shared-city") { raw.subscriptions[0]!.mode = "ALL_SHARED"; raw.subscriptions[0]!.cityUids = []; }
    if (mode === "duplicate-row") raw.catalog.push(raw.catalog[1]!);
    expect(() => prepareSnapshotPublicationCatalogAnchors(raw)).toThrow("SNAPSHOT_PUBLICATION_CATALOG_ANCHORS_INVALID");
  });
  it("ignores unrelated unselected inactive candidates without enriching the public graph", () => {
    const raw = input(); raw.catalog.push({ ...raw.catalog[1]!, uid: createUlid(), lifecycle: "INACTIVE" });
    expect(prepareSnapshotPublicationCatalogAnchors(raw).developments).toHaveLength(1);
  });
});
