import { describe, expect, it } from "vitest";
import { rawArtifactRemovalAvailability } from "../src/modules/ingestion-core/domain/raw-artifact-removal-availability.ts";
const date = (offset: number) => new Date(1_000 + offset);
const deletion = { requestedAt: date(10), completedAt: date(20) };
describe("strict raw resurrection ordering without rewriting immutable journals", () => {
  it("has no removal evidence without a terminal deletion", () => {
    expect(rawArtifactRemovalAvailability(null, { createdAt: date(30), storedAt: date(40) })).toBeNull();
    expect(() => rawArtifactRemovalAvailability({ ...deletion, completedAt: null }, null)).toThrow("RAW_RETENTION_JOURNAL_INVALID");
  });
  it("classifies no PUT or a definitively prior settled PUT as removed", () => {
    expect(rawArtifactRemovalAvailability(deletion, null)).toBe("REMOVED");
    expect(rawArtifactRemovalAvailability(deletion, { createdAt: date(0), storedAt: date(9) })).toBe("REMOVED");
  });
  it("requires strict post-terminal intent and consistent settled receipt for PRESENT", () => {
    expect(rawArtifactRemovalAvailability(deletion, { createdAt: date(21), storedAt: date(21) })).toBe("PRESENT");
  });
  it.each([
    { name: "equal intent clock", created: 20, stored: 30 },
    { name: "late pre-delete receipt", created: 0, stored: 30 },
    { name: "receipt at delete admission", created: 0, stored: 10 },
    { name: "contradictory post-delete receipt", created: 30, stored: 29 },
    { name: "unfinished later PUT", created: 30, stored: null },
  ])("holds $name as UNKNOWN", ({ created, stored }) => {
    expect(rawArtifactRemovalAvailability(deletion, { createdAt: date(created), storedAt: stored === null ? null : date(stored) })).toBe("UNKNOWN");
  });
});
