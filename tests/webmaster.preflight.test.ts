import { describe, expect, it } from "vitest";
import { createWebmasterClient } from "../collector/sources/yandex-webmaster/client.ts";
import { WebmasterSafeError } from "../collector/sources/yandex-webmaster/http.ts";

function createJsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: init?.status ?? 200,
  });
}

describe("webmaster preflight", () => {
  it("matches exact verified host by normalized URL", async () => {
    const responses = [
      createJsonResponse({ user_id: 77 }),
      createJsonResponse({
        hosts: [
          { host_id: "http:other.ru:80", ascii_host_url: "https://other.ru", verified: true },
          { host_id: "https:alpha.example.test:443", ascii_host_url: "https://alpha.example.test/", verified: true },
        ],
      }),
    ];

    const client = createWebmasterClient(
      {
        token: "token",
        baseUrl: "https://api.webmaster.yandex.net/v4",
        targetSiteUrl: "https://alpha.example.test",
        tokenStatus: "ACTIVE",
      },
      {
        fetchImpl: async () => responses.shift() ?? createJsonResponse({}, { status: 500 }),
      },
    );

    await expect(client.preflight()).resolves.toEqual({
      userId: "77",
      hostId: "https:alpha.example.test:443",
      matchedHostUrl: "https://alpha.example.test/",
      targetSiteUrl: "https://alpha.example.test",
      verified: true,
    });
  });

  it("fails when exact site is not available", async () => {
    const responses = [
      createJsonResponse({ user_id: 77 }),
      createJsonResponse({
        hosts: [{ host_id: "https:other.ru:443", ascii_host_url: "https://other.ru", verified: true }],
      }),
    ];

    const client = createWebmasterClient(
      {
        token: "token",
        baseUrl: "https://api.webmaster.yandex.net/v4",
        targetSiteUrl: "https://alpha.example.test",
        tokenStatus: "ACTIVE",
      },
      {
        fetchImpl: async () => responses.shift() ?? createJsonResponse({}, { status: 500 }),
      },
    );

    await expect(client.preflight()).rejects.toMatchObject({
      code: "TARGET_SITE_MISSING",
    } satisfies Partial<WebmasterSafeError>);
  });
});
