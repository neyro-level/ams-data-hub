import { describe, expect, it } from "vitest";
import {
  mergeWebmasterTechnicalData,
  summarizeSourceRun,
} from "../src/modules/data-ingestion/index.ts";
import { getClientBySlug } from "./helpers/example-registry.ts";
import { createWebmasterSourceFixture } from "./helpers/source-dto-fixtures.ts";

function getNorthSite() {
  const site = getClientBySlug("alpha")?.sites.find((item) => item.siteSlug === "north");
  if (!site) throw new Error("Missing Alpha North fixture site");
  return site;
}

describe("Sync source-state handling", () => {
  it("preserves technical partial errors without leaking baseline query errors", () => {
    const site = getNorthSite();
    const periodData = createWebmasterSourceFixture(site);
    const baselineData = createWebmasterSourceFixture(site);
    baselineData.partial = true;
    baselineData.diagnostics = [];
    baselineData.endpointErrors = [
      {
        endpoint: "/user/1/hosts/2/diagnostics",
        code: "SERVER_ERROR",
        status: 503,
      },
      {
        endpoint: "/user/1/hosts/2/search-queries/popular",
        code: "SERVER_ERROR",
        status: 503,
      },
    ];

    const merged = mergeWebmasterTechnicalData(periodData, baselineData);

    expect(merged.partial).toBe(true);
    expect(merged.diagnostics).toEqual([]);
    expect(merged.endpointErrors).toEqual([baselineData.endpointErrors[0]]);
  });

  it("summarizes mixed successful and failed periods as one partial source run", () => {
    expect(
      summarizeSourceRun([
        { status: "success", safeErrorCode: null, note: null },
        { status: "failed", safeErrorCode: "SERVER_ERROR", note: "period failed" },
        { status: "success", safeErrorCode: null, note: null },
      ]),
    ).toEqual({
      status: "partial",
      safeErrorCode: "SERVER_ERROR",
      notes: "period failed",
    });
  });
});
