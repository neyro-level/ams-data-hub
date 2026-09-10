import { metricaSiteAuditSchema } from "../../src/shared/schemas/metrica-source.ts";
import type { SiteRegistry } from "../../src/shared/schemas/registry.ts";
import { webmasterSiteDataSchema } from "../../src/shared/schemas/webmaster-source.ts";

const meta = {
  sampled: false,
  containsSensitiveData: false,
  sampleShare: 1,
  sampleSize: 100,
  sampleSpace: 100,
  totalRows: 1,
  totalRowsRounded: false,
  date1: "2026-07-28",
  date2: "2026-08-27",
  timezone: "+03:00",
};

export function createWebmasterSourceFixture(site: SiteRegistry) {
  return webmasterSiteDataSchema.parse({
    schemaVersion: 1,
    fetchedAt: "2026-08-27T10:00:00.000Z",
    access: {
      userId: "77",
      hostId: `https:${new URL(site.siteUrl).hostname}:443`,
      matchedHostUrl: `${site.siteUrl}/`,
      targetSiteUrl: site.siteUrl,
      verified: true,
    },
    summary: {
      siteUrl: site.siteUrl,
      searchablePages: 120,
      excludedPages: 4,
      sqi: 20,
    },
    diagnostics: [],
    sitemaps: [
      {
        id: "sm-1",
        url: `${site.siteUrl}/sitemap.xml`,
        status: "OK",
        lastDownloadedAt: "2026-08-27T09:00:00+03:00",
        urlsTotal: 100,
        errorsCount: 0,
        warningsCount: 0,
      },
    ],
    queryCollections: [
      {
        orderBy: "TOTAL_SHOWS",
        device: "ALL",
        requestedLimit: 500,
        dateFrom: "2026-08-17",
        dateTo: "2026-08-23",
        totalAvailable: 1,
        queries: [
          {
            queryId: "q-1",
            queryText: `квартиры ${site.name.toLowerCase()}`,
            orderBy: "TOTAL_SHOWS",
            device: "ALL",
            shows: 100,
            clicks: 5,
            ctrPercent: 5,
            avgShowPosition: 6,
            avgClickPosition: 5,
          },
        ],
      },
    ],
    allQueryHistory: [
      {
        indicator: "TOTAL_SHOWS",
        points: [{ date: "2026-08-23T00:00:00+03:00", value: 120 }],
      },
      {
        indicator: "TOTAL_CLICKS",
        points: [{ date: "2026-08-23T00:00:00+03:00", value: 6 }],
      },
      {
        indicator: "AVG_SHOW_POSITION",
        points: [{ date: "2026-08-23T00:00:00+03:00", value: 5.5 }],
      },
    ],
    indexingHistory: [
      {
        indicator: "HTTP_2XX",
        points: [{ date: "2026-08-27T00:00:00+03:00", value: 100 }],
      },
    ],
    sqiHistory: [
      { date: "2026-05-01T00:00:00+03:00", value: 18 },
      { date: "2026-08-01T00:00:00+03:00", value: 20 },
    ],
    pagesInSearchHistory: [{ date: "2026-08-27T00:00:00+03:00", value: 120 }],
    searchEventsHistory: [],
    brokenInternalLinksHistory: [
      {
        indicator: "SITE_ERROR",
        points: [{ date: "2026-08-27T00:00:00+03:00", value: 1 }],
      },
    ],
    externalLinksHistory: [
      {
        indicator: "LINKS_TOTAL_COUNT",
        points: [{ date: "2026-08-27T00:00:00+03:00", value: 12 }],
      },
    ],
    partial: false,
    endpointErrors: [],
  });
}

export function createMetricaSourceFixture(site: SiteRegistry) {
  return metricaSiteAuditSchema.parse({
    schemaVersion: 1,
    fetchedAt: "2026-08-27T10:05:00.000Z",
    access: {
      counterId: site.metrica.counterId ?? "1",
      site: new URL(site.siteUrl).hostname,
      permission: "edit",
      name: site.name,
      timeZoneName: "Europe/Moscow",
      timeZoneOffsetMinutes: 180,
    },
    goals: [],
    allowedGoals: [],
    allTraffic: {
      meta,
      summary: {
        visits: 300,
        users: 200,
        pageviews: 600,
        bounceRate: 20,
        pageDepth: 2,
        averageVisitDurationSeconds: 120,
        goalReaches: 10,
        conversionRate: null,
      },
    },
    yandexOrganic: {
      meta,
      summary: {
        visits: 100,
        users: 80,
        pageviews: 240,
        bounceRate: 12,
        pageDepth: 2.4,
        averageVisitDurationSeconds: 180,
        goalReaches: 5,
        targetVisits: 5,
        targetUsers: 4,
        conversionRate: null,
      },
      byTime: [
        {
          date: "2026-08-27",
          visits: 100,
          goalReaches: 5,
          targetVisits: 5,
          conversionRate: null,
        },
      ],
      landingPages: [],
      devices: [],
    },
    goalsSummary: {
      meta,
      items: [],
    },
  });
}
