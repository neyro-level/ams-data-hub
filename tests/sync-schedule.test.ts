import { describe, expect, it } from "vitest";
import { shouldCollectTopvisor } from "../src/modules/data-ingestion/application/sync-service.ts";

describe("Topvisor schedule", () => {
  it("collects daily positions only on Monday", () => {
    expect(shouldCollectTopvisor("daily", "2026-09-07T01:00:00.000Z")).toBe(true);
    expect(shouldCollectTopvisor("daily", "2026-09-08T01:00:00.000Z")).toBe(false);
  });

  it("keeps explicit/manual and backfill runs available", () => {
    expect(shouldCollectTopvisor("manual", "2026-09-08T01:00:00.000Z")).toBe(true);
    expect(shouldCollectTopvisor("backfill", "2026-09-08T01:00:00.000Z")).toBe(true);
  });
});
