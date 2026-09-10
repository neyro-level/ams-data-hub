import { describe, expect, it } from "vitest";
import { createWebmasterClient } from "../collector/sources/yandex-webmaster/client.ts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("Webmaster endpoint-level partial collection", () => {
  it("keeps collecting when one non-access endpoint fails", async () => {
    const client = createWebmasterClient(
      {
        token: "token",
        baseUrl: "https://api.webmaster.yandex.net/v4",
        targetSiteUrl: "https://alpha.example.test",
        tokenStatus: "ACTIVE",
      },
      {
        fetchImpl: async (input) => {
          const url = new URL(typeof input === "string" ? input : String(input));
          if (url.pathname.endsWith("/user")) {
            return jsonResponse({ user_id: 77 });
          }
          if (url.pathname.endsWith("/user/77/hosts")) {
            return jsonResponse({
              hosts: [
                {
                  host_id: "https:alpha.example.test:443",
                  ascii_host_url: "https://alpha.example.test/",
                  verified: true,
                },
              ],
            });
          }
          if (url.pathname.endsWith("/summary")) {
            return jsonResponse({ error_code: "INTERNAL_ERROR" }, 500);
          }
          if (url.pathname.endsWith("/search-urls/in-search/history")) {
            return jsonResponse({ history: [{ date: "2026-08-27", value: 10 }] });
          }
          if (url.pathname.endsWith("/search-queries/popular")) {
            return jsonResponse({
              queries: [],
              date_from: "2026-08-17",
              date_to: "2026-08-23",
              count: 0,
            });
          }
          return jsonResponse({});
        },
        now: () => "2026-08-27T10:00:00.000Z",
      },
    );

    const result = await client.collectSiteData({ queryLimit: 1 });

    expect(result.partial).toBe(true);
    expect(result.endpointErrors).toEqual([
      {
        endpoint: "/user/77/hosts/https:alpha.example.test:443/summary",
        code: "SERVER_ERROR",
        status: 500,
      },
    ]);
    expect(result.summary.sqi).toBeNull();
    expect(result.pagesInSearchHistory[0]?.value).toBe(10);
    expect(result.queryCollections).toHaveLength(6);
  });
});
