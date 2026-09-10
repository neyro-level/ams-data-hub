import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import alphaGoals from "../config/examples/goals/alpha.json";
import { createMetricaClient, readMetricaEnvironment } from "../collector/sources/yandex-metrica/client.ts";
import { goalProfileSchema } from "../src/shared/schemas/registry.ts";

function fixturePath(name: string) {
  return path.join(process.cwd(), "tests", "fixtures", "yandex-metrica", name);
}

async function loadFixture(name: string) {
  return JSON.parse(await readFile(fixturePath(name), "utf8"));
}

function createJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("metrica audit dto", () => {
  it("builds normalized Metrica audit bundle", async () => {
    const counters = await loadFixture("counters.json");
    const goals = await loadFixture("goals.json");
    const allTraffic = await loadFixture("all-traffic.json");
    const searchEngines = await loadFixture("search-engines.json");
    const byTime = await loadFixture("bytime.json");
    const landing = await loadFixture("landing.json");
    const devices = await loadFixture("devices.json");
    const defaultGoalStat = await loadFixture("goal-stat-default.json");
    const uniqueTarget = await loadFixture("unique-target.json");
    const targetByTime = await loadFixture("target-bytime.json");
    const targetLanding = await loadFixture("target-landing.json");
    const allowedGoals = goalProfileSchema
      .parse(alphaGoals)
      .goals.filter((goal) => goal.siteSlugs.includes("north"))
      .map((goal) => ({
        goalId: goal.goalId,
        label: goal.label,
        category: goal.category,
        direction: goal.direction,
        includeInSeoConversion: goal.includeInSeoConversion,
      }));

    const client = createMetricaClient(
      readMetricaEnvironment({
        YANDEX_METRICA_OAUTH_TOKEN: "token",
        YANDEX_METRICA_API_BASE_URL: "https://api-metrika.yandex.net",
        YANDEX_METRICA_SITE_URL: "https://alpha.example.test",
        YANDEX_METRICA_TOKEN_STATUS: "ACTIVE",
      }),
      {
        fetchImpl: async (url) => {
          const target = new URL(typeof url === "string" ? url : String(url));
          const metrics = target.searchParams.getAll("metrics");
          const filters = target.searchParams.get("filters") ?? "";
          const isUniqueTargetRequest = filters.includes("IsReached");
          if (target.pathname.endsWith("/management/v1/counters")) {
            return createJsonResponse(counters);
          }
          if (target.pathname.endsWith("/management/v1/counter/700001/goals")) {
            return createJsonResponse(goals);
          }
          if (target.pathname.endsWith("/stat/v1/data/bytime")) {
            return createJsonResponse(isUniqueTargetRequest ? targetByTime : byTime);
          }
          if (target.pathname.endsWith("/stat/v1/data")) {
            const dimensions = target.searchParams.getAll("dimensions");
            if (
              isUniqueTargetRequest &&
              dimensions.includes("ym:s:startURLPath")
            ) {
              return createJsonResponse(targetLanding);
            }
            if (isUniqueTargetRequest) {
              return createJsonResponse(uniqueTarget);
            }
            if (dimensions.includes("ym:s:lastsignSearchEngineRootName")) {
              return createJsonResponse(searchEngines);
            }
            if (dimensions.includes("ym:s:startURLPath")) {
              return createJsonResponse(landing);
            }
            if (dimensions.includes("ym:s:deviceCategory")) {
              return createJsonResponse(devices);
            }
            if (metrics.some((metric) => metric.includes("conversionRate"))) {
              return createJsonResponse(defaultGoalStat);
            }
            return createJsonResponse(allTraffic);
          }
          throw new Error(`Unexpected URL: ${target}`);
        },
        now: () => "2026-08-27T12:30:00.000Z",
      },
    );

    const result = await client.collectSiteData({
      date1: "2026-07-28",
      date2: "2026-08-27",
      landingLimit: 2,
      timezone: "+03:00",
      allowedGoals,
    });

    expect(result.access.counterId).toBe("700001");
    expect(result.allTraffic.summary.goalReaches).toBe(398);
    expect(result.yandexOrganic.summary.visits).toBe(5290);
    expect(result.yandexOrganic.summary.targetVisits).toBe(49);
    expect(result.yandexOrganic.summary.targetUsers).toBe(37);
    expect(result.yandexOrganic.summary.conversionRate).toBe(0.93);
    expect(result.yandexOrganic.byTime).toHaveLength(3);
    expect(result.yandexOrganic.landingPages[0]?.path).toBe("/");
    expect(result.yandexOrganic.byTime[0]?.targetVisits).toBe(4);
    expect(result.yandexOrganic.landingPages[0]?.targetVisits).toBe(22);
    expect(result.yandexOrganic.devices[0]?.device).toBe("mobile");
    expect(result.goalsSummary.items).toHaveLength(6);
  });
});
