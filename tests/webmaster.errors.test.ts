import { describe, expect, it } from "vitest";
import { getWebmasterJson, WebmasterSafeError } from "../collector/sources/yandex-webmaster/http.ts";
import { readWebmasterEnvironment } from "../collector/sources/yandex-webmaster/client.ts";

function createJsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("webmaster error handling", () => {
  it("maps 401 to UNAUTHORIZED", async () => {
    await expect(
      getWebmasterJson({
        baseUrl: "https://api.webmaster.yandex.net/v4",
        token: "token",
        endpoint: "/user",
        fetchImpl: async () => createJsonResponse({ error_code: "INVALID_OAUTH_TOKEN" }, 401),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 } satisfies Partial<WebmasterSafeError>);
  });

  it("maps 403 to FORBIDDEN", async () => {
    await expect(
      getWebmasterJson({
        baseUrl: "https://api.webmaster.yandex.net/v4",
        token: "token",
        endpoint: "/user/77/hosts",
        fetchImpl: async () => createJsonResponse({ error_code: "INVALID_USER_ID" }, 403),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 } satisfies Partial<WebmasterSafeError>);
  });

  it("maps 429 to RATE_LIMITED without retry loop", async () => {
    let calls = 0;
    await expect(
      getWebmasterJson({
        baseUrl: "https://api.webmaster.yandex.net/v4",
        token: "token",
        endpoint: "/user/77/hosts/host/search-queries/popular",
        fetchImpl: async () => {
          calls += 1;
          return createJsonResponse({ error_code: "TOO_MANY_REQUESTS_ERROR" }, 429);
        },
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 } satisfies Partial<WebmasterSafeError>);
    expect(calls).toBe(1);
  });

  it("retries one time on 5xx then succeeds", async () => {
    let calls = 0;
    const result = await getWebmasterJson({
      baseUrl: "https://api.webmaster.yandex.net/v4",
      token: "token",
      endpoint: "/user",
      retryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return createJsonResponse({ error_code: "INTERNAL_ERROR" }, 500);
        }
        return createJsonResponse({ user_id: 77 }, 200);
      },
    });

    expect(result).toEqual({ user_id: 77 });
    expect(calls).toBe(2);
  });

  it("fails early on inactive token status", () => {
    expect(() =>
      readWebmasterEnvironment({
        YANDEX_WEBMASTER_OAUTH_TOKEN: "token",
        YANDEX_WEBMASTER_API_BASE_URL: "https://api.webmaster.yandex.net/v4",
        YANDEX_WEBMASTER_SITE_URL: "https://alpha.example.test",
        YANDEX_WEBMASTER_TOKEN_STATUS: "REVOKED",
      }),
    ).toThrow("YANDEX_WEBMASTER_TOKEN_STATUS is not ACTIVE");
  });
  it.each([
    "http://127.0.0.1:8080/v4",
    "https://api.webmaster.yandex.net.evil.example/v4",
    "https://token@api.webmaster.yandex.net/v4",
  ])("rejects an untrusted API origin before requests: %s", (baseUrl) => {
    expect(() =>
      readWebmasterEnvironment({
        YANDEX_WEBMASTER_OAUTH_TOKEN: "token",
        YANDEX_WEBMASTER_API_BASE_URL: baseUrl,
        YANDEX_WEBMASTER_SITE_URL: "https://alpha.example.test",
        YANDEX_WEBMASTER_TOKEN_STATUS: "ACTIVE",
      }),
    ).toThrow("YANDEX_WEBMASTER_API_BASE_URL is not allowlisted");
  });

});
