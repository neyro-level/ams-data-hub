import { describe, expect, it } from "vitest";
import { compileSiteReportSnapshot } from "../src/modules/reporting/index.ts";
import {
  getClientBySlug,
  getRegistryBundle,
} from "./helpers/example-registry.ts";
import {
  createMetricaSourceFixture,
  createWebmasterSourceFixture,
} from "./helpers/source-dto-fixtures.ts";

function getNorthSite() {
  const site = getClientBySlug("alpha")?.sites.find((item) => item.siteSlug === "north");
  if (!site) throw new Error("Missing Alpha North fixture site");
  return site;
}

const thresholds = {
  minimumShows: 30,
  maximumCtrPercent: 5,
  maximumAveragePosition: 10,
};

const clusterProfile = getRegistryBundle().clusters.find(
  (profile) => profile.profileSlug === "real-estate",
);
if (!clusterProfile) throw new Error("Missing real-estate cluster profile");

describe("SiteReportSnapshot compiler", () => {
  it("compiles both source DTOs into one validated snapshot", () => {
    const site = getNorthSite();
    const currentWebmaster = createWebmasterSourceFixture(site);
    currentWebmaster.queryCollections[0]!.queries[0]!.avgShowPosition = 2;
    const previousWebmaster = createWebmasterSourceFixture(site);
    previousWebmaster.allQueryHistory.find(
      (history) => history.indicator === "TOTAL_SHOWS",
    )!.points[0]!.value = 100;
    previousWebmaster.allQueryHistory.find(
      (history) => history.indicator === "TOTAL_CLICKS",
    )!.points[0]!.value = 4;
    previousWebmaster.allQueryHistory.find(
      (history) => history.indicator === "AVG_SHOW_POSITION",
    )!.points[0]!.value = 6;
    const currentMetrica = createMetricaSourceFixture(site);
    const previousMetrica = createMetricaSourceFixture(site);
    previousMetrica.yandexOrganic.summary.visits = 80;
    previousMetrica.yandexOrganic.summary.targetVisits = 3;
    previousMetrica.yandexOrganic.summary.conversionRate = 3.75;
    previousMetrica.allTraffic.summary.visits = 250;
    const snapshot = compileSiteReportSnapshot({
      clientSlug: "alpha",
      site,
      generatedAt: "2026-08-27T10:10:00.000Z",
      clusterProfile,
      webmasterData: currentWebmaster,
      metricaData: currentMetrica,
      previousWebmasterData: previousWebmaster,
      previousMetricaData: previousMetrica,
      periodKey: "week",
      currentPeriod: { dateFrom: "2026-08-17", dateTo: "2026-08-23" },
      previousPeriod: { dateFrom: "2026-08-10", dateTo: "2026-08-16" },
      queryThresholds: thresholds,
      trackedQuerySet: {
        schemaVersion: 1,
        clientSlug: "alpha",
        siteSlug: "north",
        source: "owner-provided",
        baselineLabel: "02.06",
        expectedCount: 1,
        queries: [
          {
            query: "квартиры север",
            position: { current: 1, baseline: 3, delta: 2 },
          },
        ],
      },
    });

    expect(snapshot.freshness).toBe("fresh");
    expect(snapshot.sources.webmaster.status).toBe("success");
    expect(snapshot.sources.metrica.status).toBe("success");
    expect(snapshot.webmaster?.summary.shows).toBe(120);
    expect(snapshot.metrica?.summary.visits).toBe(100);
    expect(snapshot.combined.funnel).toMatchObject({
      shows: 120,
      clicks: 6,
      visits: 100,
      goalReaches: 5,
    });
    expect(snapshot.combined.methodology.join(" ")).toContain(
      "конкретная заявка не утверждается",
    );
    expect(snapshot.comparison?.metrics.shows.deltaPercent).toBe(20);
    expect(snapshot.comparison?.metrics.clicks.deltaPercent).toBe(50);
    expect(snapshot.comparison?.metrics.avgPosition.deltaPoints).toBe(0.5);
    expect(snapshot.comparison?.metrics.organicVisits.deltaPercent).toBe(25);
    expect(snapshot.comparison?.metrics.targetVisits.current).toBe(5);
    expect(snapshot.webmaster?.queries[0]?.cluster).not.toBe("Не классифицирован");
    expect(snapshot.webmaster?.trackedCore).toMatchObject({
      expectedCount: 1,
      observedCount: 1,
      coveragePercent: 100,
      top10Count: 1,
      top3Count: 1,
    });
    expect(snapshot.webmaster?.trackedCore?.queries[0]).toMatchObject({
      query: "квартиры север",
      shows: 100,
      previousShows: 100,
      ownerPosition: 1,
      ownerBaselinePosition: 3,
      ownerPositionDelta: 2,
    });
    expect(snapshot.webmaster?.health).toMatchObject({
      status: "stable",
      sqi: 20,
      previousSqi: 18,
      sqiDelta: 2,
    });
    expect(snapshot.ranking).toMatchObject({
      source: "owner-provided",
      queryCount: 1,
      measuredCount: 1,
      top3Count: 1,
      top10Count: 1,
      improvedCount: 1,
      declinedCount: 0,
      baselineLabel: "02.06",
    });
  });


  it("promotes critical crawl health into the management risk", () => {
    const site = getNorthSite();
    const webmasterData = createWebmasterSourceFixture(site);
    webmasterData.indexingHistory.push({
      indicator: "HTTP_5XX",
      points: [{ date: "2026-08-27T00:00:00+03:00", value: 2 }],
    });

    const snapshot = compileSiteReportSnapshot({
      clientSlug: "alpha",
      site,
      generatedAt: "2026-08-27T10:10:00.000Z",
      clusterProfile,
      webmasterData,
      metricaData: createMetricaSourceFixture(site),
      queryThresholds: thresholds,
    });

    expect(snapshot.webmaster?.health?.status).toBe("critical");
    expect(snapshot.combined.alerts[0]).toMatchObject({
      id: "webmaster-health-critical",
      tone: "error",
    });
  });

  it("compiles Topvisor capture history into ranking movements", () => {
    const site = {
      ...getNorthSite(),
      topvisor: { enabled: true, projectId: 700004, regionIndex: 0 },
    };
    const snapshot = compileSiteReportSnapshot({
      clientSlug: "alpha",
      site,
      generatedAt: "2026-08-23T10:10:00.000Z",
      clusterProfile,
      webmasterData: createWebmasterSourceFixture(site),
      metricaData: createMetricaSourceFixture(site),
      periodKey: "month",
      currentPeriod: { dateFrom: "2026-07-27", dateTo: "2026-08-23" },
      previousPeriod: { dateFrom: "2026-06-29", dateTo: "2026-07-26" },
      queryThresholds: thresholds,
      trackedQuerySet: {
        schemaVersion: 1,
        clientSlug: "alpha",
        siteSlug: "north",
        source: "owner-provided",
        baselineLabel: "02.06",
        expectedCount: 2,
        queries: [
          {
            query: "квартиры север",
            position: { current: 4, baseline: 9, delta: 5 },
          },
          {
            query: "новостройки север",
            position: { current: 8, baseline: null, delta: 0 },
          },
        ],
      },
      rankingData: {
        schemaVersion: 1,
        fetchedAt: "2026-08-23T10:00:00.000Z",
        projectId: 700004,
        regionIndex: 0,
        snapshots: [
          {
            capturedAt: "2026-08-01",
            queries: [
              { query: "квартиры север", position: 12 },
              { query: "новостройки север", position: null },
            ],
          },
          {
            capturedAt: "2026-08-22",
            queries: [
              { query: "квартиры север", position: 5 },
              { query: "новостройки север", position: 3 },
            ],
          },
        ],
      },
    });

    expect(snapshot.sources.topvisor?.status).toBe("success");
    expect(snapshot.ranking).toMatchObject({
      source: "topvisor",
      queryCount: 2,
      top3Count: 1,
      top10Count: 2,
      top3Delta: 1,
      top10Delta: 2,
      improvedCount: 1,
      newCount: 1,
      lastCapturedAt: "2026-08-22",
    });
    expect(snapshot.ranking?.history).toHaveLength(2);
  });
  it("marks a source partial when current data arrived with a request failure", () => {
    const site = getNorthSite();
    const snapshot = compileSiteReportSnapshot({
      clientSlug: "alpha",
      site,
      generatedAt: "2026-08-28T10:10:00.000Z",
      clusterProfile,
      webmasterData: createWebmasterSourceFixture(site),
      webmasterFailure: { code: "WEBMASTER_PARTIAL_REQUEST", status: 503 },
      metricaData: createMetricaSourceFixture(site),
      queryThresholds: thresholds,
    });

    expect(snapshot.freshness).toBe("partial");
    expect(snapshot.sources.webmaster.status).toBe("partial");
    expect(snapshot.sources.webmaster.safeErrorCode).toBe("WEBMASTER_PARTIAL_REQUEST");
  });

  it("uses last-known-good source section and marks a failed refresh partial", () => {
    const site = getNorthSite();
    const previous = compileSiteReportSnapshot({
      clientSlug: "alpha",
      site,
      generatedAt: "2026-08-27T10:10:00.000Z",
      clusterProfile,
      webmasterData: createWebmasterSourceFixture(site),
      metricaData: createMetricaSourceFixture(site),
      queryThresholds: thresholds,
    });
    const partial = compileSiteReportSnapshot({
      clientSlug: "alpha",
      site,
      generatedAt: "2026-08-28T10:10:00.000Z",
      clusterProfile,
      webmasterData: createWebmasterSourceFixture(site),
      metricaData: null,
      metricaFailure: { code: "RATE_LIMITED", status: 420 },
      previous,
      queryThresholds: thresholds,
    });

    expect(partial.freshness).toBe("partial");
    expect(partial.sources.metrica.status).toBe("quota_limited");
    expect(partial.sources.metrica.safeErrorCode).toBe("RATE_LIMITED");
    expect(partial.metrica).toEqual(previous.metrica);
    expect(partial.combined.funnel.visits).toBe(100);
  });
});
