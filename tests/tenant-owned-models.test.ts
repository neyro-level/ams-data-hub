import { describe, expect, it } from "vitest";
import {
  TENANT_OWNED_MODELS,
  isTenantOwnedModel,
} from "../src/platform/database/tenant-owned-models.ts";

describe("tenant-owned models registry", () => {
  it("registers current report, metric and reliability records for Workstream 3 enforcement", () => {
    expect(TENANT_OWNED_MODELS).toEqual(
      expect.arrayContaining([
        "Project",
        "Site",
        "ReportSnapshot",
        "SyncRun",
        "OutboxEvent",
        "JobRun",
      ]),
    );
    expect(isTenantOwnedModel("ReportSnapshot")).toBe(true);
    expect(isTenantOwnedModel("ThresholdProfile")).toBe(false);
  });
});
