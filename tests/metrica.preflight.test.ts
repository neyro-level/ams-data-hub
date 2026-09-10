import { describe, expect, it } from "vitest";
import { createMetricaClient, readMetricaEnvironment } from "../collector/sources/yandex-metrica/client.ts";
import { MetricaSafeError, getMetricaJson } from "../collector/sources/yandex-metrica/http.ts";

function createJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("metrica preflight", () => {
  it("reads environment and resolves exact site counter", async () => {
    const client = createMetricaClient(
      readMetricaEnvironment({
        YANDEX_METRICA_OAUTH_TOKEN: "token",
        YANDEX_METRICA_API_BASE_URL: "https://api-metrika.yandex.net",
        YANDEX_METRICA_SITE_URL: "https://alpha.example.test",
        YANDEX_METRICA_TOKEN_STATUS: "ACTIVE",
      }),
      {
        fetchImpl: async (url) => {
          const path = typeof url === "string" ? url : String(url);
          if (path.includes("/management/v1/counters")) {
            return createJsonResponse({
              counters: [
                { id: 1, site: "other-site.ru", permission: "view", name: "Other" },
                { id: 700001, site: "alpha.example.test", permission: "edit", name: "Альфа Север", time_zone_name: "Europe/Moscow", time_zone_offset: 180 },
              ],
            });
          }
          return createJsonResponse({ goals: [{ id: 800002, name: "Отправка формы", type: "form", status: "Active", is_favorite: 0 }] });
        },
        now: () => "2026-08-27T12:00:00.000Z",
      },
    );

    await expect(client.preflight()).resolves.toMatchObject({
      access: { counterId: "700001", site: "alpha.example.test" },
      goals: [{ goalId: "800002", name: "Отправка формы" }],
    });
  });

  it("maps 420 quota failure", async () => {
    await expect(
      getMetricaJson({
        baseUrl: "https://api-metrika.yandex.net",
        token: "token",
        endpoint: "/management/v1/counters",
        fetchImpl: async () => createJsonResponse({ errors: [{ error_type: "quota" }], code: 420, message: "Too many requests" }, 420),
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 420 } satisfies Partial<MetricaSafeError>);
  });
});
