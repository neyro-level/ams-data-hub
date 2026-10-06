import { describe, expect, it } from "vitest";
import { sourceGoodSnapshotBuildRequestSchema } from "../src/modules/snapshot-delivery/contracts.ts";

const request = { schemaVersion: 1, organizationId: "org", projectId: "project", sourceId: "source",
  sourceRevisionId: "revision", sourceRevisionSequence: 1 };
describe("source GOOD snapshot outbox contract", () => {
  it("accepts scoped IDs and a positive revision sequence only", () => {
    expect(sourceGoodSnapshotBuildRequestSchema.parse(request)).toEqual(request);
  });
  it("rejects unknown versions, endpoint payloads and invalid IDs/sequences", () => {
    for (const invalid of [{ ...request, schemaVersion: 2 }, { ...request, endpoint: "https://synthetic.test/" },
      { ...request, sourceId: "https://synthetic.test/" }, { ...request, sourceRevisionSequence: 0 }]) {
      expect(sourceGoodSnapshotBuildRequestSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
