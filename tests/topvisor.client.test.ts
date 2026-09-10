import { describe, expect, it, vi } from "vitest";
import {
  createTopvisorClient,
  normalizeTopvisorHistory,
  readTopvisorEnvironment,
  TopvisorSafeError,
} from "../collector/sources/topvisor/client.ts";
import { getClientBySlug } from "./helpers/example-registry.ts";

function getTopvisorSite() {
  const site = getClientBySlug("alpha")?.sites.find(
    (item) => item.siteSlug === "north",
  );
  if (!site) throw new Error("Missing North site");
  return {
    ...site,
    topvisor: {
      enabled: true,
      projectId: 700004,
      regionIndex: 0,
    },
  };
}

describe("Topvisor source", () => {
  it("fails safely when credentials are absent", () => {
    expect(() => readTopvisorEnvironment({})).toThrowError(TopvisorSafeError);
  });

  it.each([
    "http://127.0.0.1/v2/json",
    "https://api.topvisor.com.evil.example/v2/json",
    "https://token@api.topvisor.com/v2/json",
  ])("rejects an untrusted API origin before requests: %s", (baseUrl) => {
    expect(() =>
      readTopvisorEnvironment({
        TOPVISOR_API_BASE_URL: baseUrl,
        TOPVISOR_USER_ID: "user-id",
        TOPVISOR_API_KEY: "api-key",
      }),
    ).toThrow("TOPVISOR_API_BASE_URL is not allowlisted");
  });

  it("normalizes exact positions for every capture date", () => {
    const data = normalizeTopvisorHistory({
      payload: {
        result: {
          rows: [
            {
              name: "купить квартиру в Севере",
              positionsData: [{ position: 12 }, { position: 5 }],
            },
            {
              name: "квартира Север",
              positionsData: [{ position: null }, { position: 3 }],
            },
          ],
        },
      },
      dates: ["2026-08-01", "2026-08-22"],
      fetchedAt: "2026-08-23T10:00:00.000Z",
      projectId: 700004,
      regionIndex: 0,
    });

    expect(data.snapshots).toEqual([
      {
        capturedAt: "2026-08-01",
        queries: [
          { query: "купить квартиру в Севере", position: 12 },
          { query: "квартира Север", position: null },
        ],
      },
      {
        capturedAt: "2026-08-22",
        queries: [
          { query: "купить квартиру в Севере", position: 5 },
          { query: "квартира Север", position: 3 },
        ],
      },
    ]);
  });

  it("reads all configured engine/device targets", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      if (String(input).endsWith("/get/positions_2/summary/chart")) {
        return new Response(
          JSON.stringify({ result: { dates: ["2026-08-01", "2026-08-22"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          result: {
            rows: [
              {
                name: "купить квартиру в Севере",
                positionsData: [{ position: 12 }, { position: 5 }],
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const client = createTopvisorClient(
      {
        baseUrl: "https://api.topvisor.test/v2/json",
        userId: "user-id",
        apiKey: "api-key",
      },
      fetchImpl as typeof fetch,
    );

    const site = getTopvisorSite();
    const result = await client.collectSiteData({ ...site, topvisor: { ...site.topvisor, targets: [
      { engine: "YANDEX", device: "DESKTOP", regionKey: 225, regionIndex: 0 },
      { engine: "GOOGLE", device: "MOBILE", regionKey: 225, regionIndex: 3 },
    ] } }, {
      dateFrom: "2026-08-01",
      dateTo: "2026-08-22",
    });

    expect(result.snapshots).toHaveLength(4);
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.topvisor.test/v2/json/get/positions_2/summary/chart",
      "https://api.topvisor.test/v2/json/get/positions_2/history",
      "https://api.topvisor.test/v2/json/get/positions_2/summary/chart",
      "https://api.topvisor.test/v2/json/get/positions_2/history",
    ]);
    expect(requests.every((request) => request.url.includes("/get/"))).toBe(true);
  });
});
