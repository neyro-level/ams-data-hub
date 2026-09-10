import { describe, expect, it } from "vitest";
import {
  buildQueryOpportunities,
  mergeWebmasterQueryCollections,
} from "../src/modules/ranking-analytics/index.ts";
import type { WebmasterQueryCollection } from "../src/shared/schemas/webmaster-source.ts";

const baseQuery = {
  queryId: "q-1",
  queryText: "квартиры север новостройки",
  device: "ALL" as const,
  shows: 120,
  clicks: 4,
  ctrPercent: 3.33,
  avgShowPosition: 6.2,
  avgClickPosition: 5.8,
};

describe("Webmaster query pool analytics", () => {
  it("deduplicates show/click pools by query and device", () => {
    const collections: WebmasterQueryCollection[] = [
      {
        orderBy: "TOTAL_SHOWS",
        device: "ALL",
        requestedLimit: 500,
        dateFrom: "2026-08-01",
        dateTo: "2026-08-07",
        totalAvailable: 1000,
        queries: [{ ...baseQuery, orderBy: "TOTAL_SHOWS" }],
      },
      {
        orderBy: "TOTAL_CLICKS",
        device: "ALL",
        requestedLimit: 500,
        dateFrom: "2026-08-01",
        dateTo: "2026-08-07",
        totalAvailable: 1000,
        queries: [{ ...baseQuery, orderBy: "TOTAL_CLICKS", clicks: 5 }],
      },
    ];

    const merged = mergeWebmasterQueryCollections(collections);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      queryId: "q-1",
      shows: 120,
      clicks: 5,
      ctrPercent: 4.17,
      observedBy: ["TOTAL_SHOWS", "TOTAL_CLICKS"],
    });
  });

  it("creates deterministic opportunities from configured thresholds", () => {
    const opportunities = buildQueryOpportunities(
      [
        {
          ...baseQuery,
          ctrPercent: 3.33,
          observedBy: ["TOTAL_SHOWS"],
        },
      ],
      {
        minimumShows: 30,
        maximumCtrPercent: 5,
        maximumAveragePosition: 10,
      },
    );

    expect(opportunities.map((item) => item.type)).toEqual([
      "high_impressions_low_ctr",
      "positions_4_10",
    ]);
  });

  it("keeps the same query separate across devices", () => {
    const collections: WebmasterQueryCollection[] = [
      {
        orderBy: "TOTAL_SHOWS",
        device: "ALL",
        requestedLimit: 500,
        dateFrom: "2026-08-01",
        dateTo: "2026-08-07",
        totalAvailable: 1000,
        queries: [{ ...baseQuery, orderBy: "TOTAL_SHOWS" }],
      },
      {
        orderBy: "TOTAL_SHOWS",
        device: "MOBILE",
        requestedLimit: 500,
        dateFrom: "2026-08-01",
        dateTo: "2026-08-07",
        totalAvailable: 600,
        queries: [
          {
            ...baseQuery,
            orderBy: "TOTAL_SHOWS",
            device: "MOBILE",
            shows: 80,
          },
        ],
      },
    ];

    expect(mergeWebmasterQueryCollections(collections)).toHaveLength(2);
  });
});
