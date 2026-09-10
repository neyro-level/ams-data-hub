import { describe, expect, it } from "vitest";
import { readMetricaEnvironment } from "../collector/sources/yandex-metrica/client.ts";
import { getMetricaJson, MetricaSafeError } from "../collector/sources/yandex-metrica/http.ts";

function createJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("metrica errors", () => {
  it("fails early on inactive token status", () => {
    expect(() =>
      readMetricaEnvironment({
        YANDEX_METRICA_OAUTH_TOKEN: "token",
        YANDEX_METRICA_API_BASE_URL: "https://api-metrika.yandex.net",
        YANDEX_METRICA_SITE_URL: "https://alpha.example.test",
        YANDEX_METRICA_TOKEN_STATUS: "REVOKED",
      }),
    ).toThrow("YANDEX_METRICA_TOKEN_STATUS is not ACTIVE");
  });

  it("retries one time on 5xx then succeeds", async () => {
    let calls = 0;
    const payload = await getMetricaJson({
      baseUrl: "https://api-metrika.yandex.net",
      token: "token",
      endpoint: "/management/v1/counters",
      retryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return createJsonResponse({ message: "internal" }, 500);
        }
        return createJsonResponse({ counters: [] }, 200);
      },
    });

    expect(payload).toEqual({ counters: [] });
    expect(calls).toBe(2);
  });

  it("maps 403 to FORBIDDEN", async () => {
    await expect(
      getMetricaJson({
        baseUrl: "https://api-metrika.yandex.net",
        token: "token",
        endpoint: "/management/v1/counters",
        fetchImpl: async () => createJsonResponse({ errors: [{ error_type: "access_denied" }], code: 403, message: "Access is denied" }, 403),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 } satisfies Partial<MetricaSafeError>);
  });
  it.each([
    "http://169.254.169.254",
    "https://api-metrika.yandex.net.evil.example",
    "https://token@api-metrika.yandex.net",
  ])("rejects an untrusted API origin before requests: %s", (baseUrl) => {
    expect(() =>
      readMetricaEnvironment({
        YANDEX_METRICA_OAUTH_TOKEN: "token",
        YANDEX_METRICA_API_BASE_URL: baseUrl,
        YANDEX_METRICA_SITE_URL: "https://alpha.example.test",
        YANDEX_METRICA_TOKEN_STATUS: "ACTIVE",
      }),
    ).toThrow("YANDEX_METRICA_API_BASE_URL is not allowlisted");
  });

});
