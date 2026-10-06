import { serializePublicDto } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";
import { createInventoryPublicProjectionService } from "../src/modules/ingestion-core/application/inventory-public-projection.ts";
import type { PrincipalContext } from "../src/platform/authorization/principal.ts";
import type { InventoryMediaProjectionResult } from "../src/modules/media-assets/index.ts";
import { syntheticCanonicalInventory } from "./fixtures/canonical-inventory.ts";

const principal: PrincipalContext = { kind: "project-job", organizationId: "org", projectId: "project", jobName: "snapshot", correlationId: "synthetic" };
const ref = "a".repeat(64);
function harness(result: InventoryMediaProjectionResult) {
  const projectMedia = vi.fn(async () => result);
  return { projectMedia, project: createInventoryPublicProjectionService({ projectMedia }) };
}
describe("inventory public projection", () => {
  it("pins trusted entity scope UID/hash and excludes all private source media", async () => {
    const entity = syntheticCanonicalInventory(); const h = harness({ media: [{ ref, position: 0, kind: "IMAGE" }], warnings: [] });
    const projected = await h.project(principal, { entity, sourceRevisionId: "good" });
    expect(h.projectMedia).toHaveBeenCalledWith(principal, { organizationId: entity.organizationId, projectId: entity.projectId,
      sourceId: entity.sourceId, inventoryUid: entity.uid, sourceRevisionId: "good", expectedRecordHash: entity.normalizedHash });
    const dto = JSON.parse(serializePublicDto(projected.inventory));
    expect(dto.media).toEqual([{ ref, position: 0, kind: "IMAGE" }]);
    expect(JSON.stringify(dto)).not.toMatch(/https:|sourceUrl|sourceId|normalizedHash/u);
    expect(entity.media[0]!.sourceUrl).toContain("producer");
  });
  it("orders relations and deduplicates position/ref, not asset across positions", async () => {
    const media = [{ ref, position: 2, kind: "IMAGE" as const }, { ref, position: 0, kind: "IMAGE" as const }, { ref, position: 0, kind: "IMAGE" as const }];
    const entity = syntheticCanonicalInventory();
    const first = await harness({ media, warnings: [] }).project(principal, { entity, sourceRevisionId: "good" });
    const second = await harness({ media: [...media].reverse(), warnings: [] }).project(principal, { entity, sourceRevisionId: "good" });
    expect(serializePublicDto(first.inventory)).toBe(serializePublicDto(second.inventory));
    expect(JSON.parse(serializePublicDto(first.inventory)).media.map((item: { position: number }) => item.position)).toEqual([0, 2]);
  });
  it("omits ambiguous positions rather than choosing a random mirror", async () => {
    const h = harness({ media: [{ ref, position: 0, kind: "IMAGE" }, { ref: "b".repeat(64), position: 0, kind: "IMAGE" }], warnings: [] });
    const projected = await h.project(principal, { entity: syntheticCanonicalInventory(), sourceRevisionId: "good" });
    expect(JSON.parse(serializePublicDto(projected.inventory)).media).toEqual([]);
    expect(projected.warnings).toEqual(["MEDIA_RELATION_AMBIGUOUS"]);
  });
  it("never falls back to producer media when no projected mirror is available", async () => {
    const h = harness({ media: [], warnings: ["MEDIA_OBJECT_UNAVAILABLE"] });
    const projected = await h.project(principal, { entity: syntheticCanonicalInventory(), sourceRevisionId: "good" });
    expect(JSON.parse(serializePublicDto(projected.inventory)).media).toEqual([]);
    expect(projected.warnings).toEqual(["MEDIA_OBJECT_UNAVAILABLE"]);
  });
  it("does not swallow a stale fact pin and publish mixed revisions", async () => {
    const h = harness({ media: [], warnings: [] }); h.projectMedia.mockRejectedValue(new Error("MEDIA_PROJECTION_REVISION_NOT_FOUND"));
    await expect(h.project(principal, { entity: syntheticCanonicalInventory(), sourceRevisionId: "good" })).rejects.toThrow("MEDIA_PROJECTION_REVISION_NOT_FOUND");
  });
});
