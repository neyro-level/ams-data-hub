import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWebmasterClient } from "../collector/sources/yandex-webmaster/client.ts";

function fixturePath(name: string) {
  return path.join(process.cwd(), "tests", "fixtures", "yandex-webmaster", name);
}

async function loadFixture(name: string) {
  return JSON.parse(await readFile(fixturePath(name), "utf8"));
}

function createJsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

describe("webmaster normalized dto", () => {
  it("collects summary, diagnostics, sitemaps and utf-8 queries into normalized DTO", async () => {
    const responses = [
      createJsonResponse(await loadFixture("user.json")),
      createJsonResponse(await loadFixture("hosts.json")),
      createJsonResponse(await loadFixture("summary.json")),
      createJsonResponse(await loadFixture("diagnostics.json")),
      createJsonResponse(await loadFixture("sitemaps.json")),
      createJsonResponse(await loadFixture("indexing-history.json")),
      createJsonResponse(await loadFixture("sqi-history.json")),
      createJsonResponse(await loadFixture("pages-in-search-history.json")),
      createJsonResponse(await loadFixture("search-events-history.json")),
      createJsonResponse(await loadFixture("internal-links-history.json")),
      createJsonResponse(await loadFixture("external-links-history.json")),
      createJsonResponse({ text_indicator_to_statistics: [] }),
      createJsonResponse({ text_indicator_to_statistics: [] }),
      createJsonResponse({ text_indicator_to_statistics: [] }),
      createJsonResponse(await loadFixture("queries-total-shows-all.json")),
      createJsonResponse(await loadFixture("queries-total-shows-desktop.json")),
      createJsonResponse(await loadFixture("queries-total-shows-mobile.json")),
      createJsonResponse(await loadFixture("queries-total-clicks-all.json")),
      createJsonResponse(await loadFixture("queries-total-clicks-desktop.json")),
      createJsonResponse(await loadFixture("queries-total-clicks-mobile.json")),
      createJsonResponse(await loadFixture("all-query-history.json")),
    ];

    const client = createWebmasterClient(
      {
        token: "token",
        baseUrl: "https://api.webmaster.yandex.net/v4",
        targetSiteUrl: "https://alpha.example.test",
        tokenStatus: "ACTIVE",
      },
      {
        fetchImpl: async () => responses.shift() ?? createJsonResponse({}),
        now: () => "2026-08-27T10:00:00.000Z",
      },
    );

    const dto = await client.collectSiteData({ queryLimit: 2 });

    expect(dto.access.hostId).toBe("https:alpha.example.test:443");
    expect(dto.summary.sqi).toBe(230);
    expect(dto.summary.searchablePages).toBe(2123);
    expect(dto.diagnostics[0]?.code).toBe("NO_SITEMAPS");
    expect(dto.sitemaps[0]?.urlsTotal).toBe(1099);
    expect(dto.queryCollections).toHaveLength(6);
    expect(dto.queryCollections[0]?.queries[0]?.queryText).toBe("квартиры север новостройки");
    expect(dto.queryCollections[0]?.queries[0]?.ctrPercent).toBe(10.95);
    expect(dto.allQueryHistory.find((item) => item.indicator === "TOTAL_SHOWS")?.points[0]?.value).toBe(
      12000,
    );
    expect(dto.indexingHistory[0]?.indicator).toBe("HTTP_2XX");
    expect(dto.sqiHistory.map((point) => point.value)).toEqual([210, 230]);
    expect(dto.pagesInSearchHistory[0]?.value).toBe(2123);
    expect(dto.searchEventsHistory).toHaveLength(2);
    expect(dto.brokenInternalLinksHistory[0]?.points[0]?.value).toBe(2);
    expect(dto.externalLinksHistory[0]?.points[0]?.value).toBe(184);
    expect(dto.partial).toBe(false);
    expect(dto.endpointErrors).toEqual([]);
  });
});
