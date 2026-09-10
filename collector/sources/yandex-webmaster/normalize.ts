import {
  webmasterDiagnosticSchema,
  webmasterHostAccessSchema,
  webmasterHistoryPointSchema,
  webmasterIndicatorHistorySchema,
  webmasterQueryCollectionSchema,
  webmasterSiteDataSchema,
  webmasterSummarySchema,
  webmasterSitemapSchema,
  type WebmasterDiagnostic,
  type WebmasterEndpointError,
  type WebmasterHistoryPoint,
  type WebmasterHostAccess,
  type WebmasterIndicatorHistory,
  type WebmasterQueryCollection,
  type WebmasterSummary,
  type WebmasterSitemap,
} from "../../../src/shared/schemas/webmaster-source.ts";

function getRecord(value: unknown) {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getString(record: Record<string, unknown> | null, ...names: string[]) {
  if (!record) {
    return null;
  }

  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function getNumber(record: Record<string, unknown> | null, ...names: string[]) {
  if (!record) {
    return null;
  }

  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function getBoolean(record: Record<string, unknown> | null, ...names: string[]) {
  if (!record) {
    return false;
  }

  for (const name of names) {
    const value = record[name];
    if (typeof value === "boolean") {
      return value;
    }
  }

  return false;
}

function getArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function normalizeSiteUrl(url: string) {
  const parsed = new URL(url);
  const normalizedPath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  return `${parsed.protocol.toLowerCase()}//${parsed.hostname.toLowerCase()}${normalizedPath}`;
}

export function findExactVerifiedHost(hostsPayload: unknown, targetSiteUrl: string) {
  const target = normalizeSiteUrl(targetSiteUrl);
  const root = getRecord(hostsPayload);
  const hosts = getArray(root?.hosts).map(getRecord).filter((value): value is Record<string, unknown> => value !== null);

  for (const host of hosts) {
    const matchedUrl = getString(host, "ascii_host_url", "unicode_host_url", "host_url");
    if (!matchedUrl) {
      continue;
    }

    let normalizedCandidate: string;
    try {
      normalizedCandidate = normalizeSiteUrl(matchedUrl);
    } catch {
      continue;
    }

    if (normalizedCandidate !== target) {
      continue;
    }

    return webmasterHostAccessSchema.parse({
      userId: getString(root, "user_id") ?? getString(host, "user_id") ?? "",
      hostId: getString(host, "host_id", "id") ?? "",
      matchedHostUrl: matchedUrl,
      targetSiteUrl,
      verified: getBoolean(host, "verified"),
    });
  }

  return null;
}

export function normalizeSummary(summaryPayload: unknown, targetSiteUrl: string) {
  const root = getRecord(summaryPayload);
  return webmasterSummarySchema.parse({
    siteUrl: targetSiteUrl,
    searchablePages: getNumber(root, "searchable_pages_count", "pages_in_search", "pages_count", "searchable_pages"),
    excludedPages: getNumber(root, "excluded_pages_count", "excluded_pages", "excluded_pages_total"),
    sqi: getNumber(root, "sqi", "sqi_value", "host_sqi"),
  });
}

export function normalizeDiagnostics(diagnosticsPayload: unknown) {
  const root = getRecord(diagnosticsPayload);
  const problems = getRecord(root?.problems) ?? getRecord(root?.diagnostics) ?? {};
  const diagnostics: WebmasterDiagnostic[] = [];

  for (const [code, rawValue] of Object.entries(problems)) {
    const problem = getRecord(rawValue);
    diagnostics.push(
      webmasterDiagnosticSchema.parse({
        code,
        severity: getString(problem, "severity") ?? "UNKNOWN",
        state: getString(problem, "state") ?? "UNKNOWN",
        lastStateUpdate: getString(problem, "last_state_update", "updated_at", "last_update"),
      }),
    );
  }

  return diagnostics;
}

export function normalizeSitemaps(sitemapsPayload: unknown) {
  const root = getRecord(sitemapsPayload);
  const items = getArray(root?.sitemaps).map(getRecord).filter((value): value is Record<string, unknown> => value !== null);
  return items.map((item) =>
    webmasterSitemapSchema.parse({
      id: getString(item, "sitemap_id", "id"),
      url: getString(item, "sitemap_url", "url"),
      status: getString(item, "status"),
      lastDownloadedAt: getString(item, "last_access", "last_download_time", "last_downloaded_at"),
      urlsTotal: getNumber(item, "urls_count", "urls_total"),
      errorsCount: getNumber(item, "errors_count", "errors"),
      warningsCount: getNumber(item, "warnings_count", "warnings"),
    }),
  );
}

export function normalizePopularQueries(args: {
  payload: unknown;
  orderBy: "TOTAL_SHOWS" | "TOTAL_CLICKS";
  device: "ALL" | "DESKTOP" | "MOBILE" | "TABLET" | "MOBILE_AND_TABLET";
  requestedLimit: number;
}) {
  const root = getRecord(args.payload);
  const queries = getArray(root?.queries).map(getRecord).filter((value): value is Record<string, unknown> => value !== null);

  return webmasterQueryCollectionSchema.parse({
    orderBy: args.orderBy,
    device: args.device,
    requestedLimit: args.requestedLimit,
    dateFrom: getString(root, "date_from"),
    dateTo: getString(root, "date_to"),
    totalAvailable: getNumber(root, "count"),
    queries: queries.map((query) => {
      const indicators = getRecord(query.indicators);
      const shows = getNumber(indicators, "TOTAL_SHOWS", "total_shows") ?? 0;
      const clicks = getNumber(indicators, "TOTAL_CLICKS", "total_clicks") ?? 0;

      return {
        queryId: getString(query, "query_id", "id") ?? "",
        queryText: getString(query, "query_text", "text") ?? "",
        orderBy: args.orderBy,
        device: args.device,
        shows,
        clicks,
        ctrPercent: shows > 0 ? Number(((clicks / shows) * 100).toFixed(2)) : null,
        avgShowPosition: getNumber(indicators, "AVG_SHOW_POSITION", "avg_show_position"),
        avgClickPosition: getNumber(indicators, "AVG_CLICK_POSITION", "avg_click_position"),
      };
    }),
  });
}

export function normalizeQueryAnalytics(payload: unknown) {
  const root = getRecord(payload);
  return getArray(root?.text_indicator_to_statistics).map(getRecord).filter((row): row is Record<string, unknown> => row !== null).flatMap((row) => {
    const text = getRecord(row.text_indicator);
    const complementary = getRecord(row.popular_complementary_indicator);
    const query = getString(text, "value");
    if (!query) return [];
    const totals = new Map<string, number>();
    for (const statistic of getArray(row.statistics).map(getRecord).filter((item): item is Record<string, unknown> => item !== null)) {
      const field = getString(statistic, "field"); const value = getNumber(statistic, "value");
      if (field && value !== null) totals.set(field, (totals.get(field) ?? 0) + value);
    }
    return [{ query: query.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim(), demand: totals.get("DEMAND") ?? null, relevantUrl: getString(complementary, "value") }];
  });
}

export function normalizeIndicatorHistory(historyPayload: unknown): WebmasterIndicatorHistory[] {
  const root = getRecord(historyPayload);
  const indicators = getRecord(root?.indicators) ?? {};

  return Object.entries(indicators).map(([indicator, rawPoints]) =>
    webmasterIndicatorHistorySchema.parse({
      indicator,
      points: getArray(rawPoints)
        .map(getRecord)
        .filter((point): point is Record<string, unknown> => point !== null)
        .map((point) => ({
          date: getString(point, "date") ?? "",
          value: getNumber(point, "value") ?? 0,
        })),
    }),
  );
}

export function normalizePlainHistory(historyPayload: unknown): WebmasterHistoryPoint[] {
  const root = getRecord(historyPayload);
  return getArray(root?.history ?? root?.points)
    .map(getRecord)
    .filter((point): point is Record<string, unknown> => point !== null)
    .map((point) =>
      webmasterHistoryPointSchema.parse({
        date: getString(point, "date") ?? "",
        value: getNumber(point, "value") ?? 0,
      }),
    );
}

export function buildWebmasterSiteData(args: {
  fetchedAt: string;
  access: WebmasterHostAccess;
  summary: WebmasterSummary;
  diagnostics: WebmasterDiagnostic[];
  sitemaps: WebmasterSitemap[];
  queryCollections: WebmasterQueryCollection[];
  allQueryHistory: WebmasterIndicatorHistory[];
  indexingHistory: WebmasterIndicatorHistory[];
  sqiHistory: WebmasterHistoryPoint[];
  pagesInSearchHistory: WebmasterHistoryPoint[];
  searchEventsHistory: WebmasterIndicatorHistory[];
  brokenInternalLinksHistory: WebmasterIndicatorHistory[];
  externalLinksHistory: WebmasterIndicatorHistory[];
  endpointErrors: WebmasterEndpointError[];
}) {
  return webmasterSiteDataSchema.parse({
    schemaVersion: 1,
    fetchedAt: args.fetchedAt,
    access: args.access,
    summary: args.summary,
    diagnostics: args.diagnostics,
    sitemaps: args.sitemaps,
    queryCollections: args.queryCollections,
    allQueryHistory: args.allQueryHistory,
    indexingHistory: args.indexingHistory,
    sqiHistory: args.sqiHistory,
    pagesInSearchHistory: args.pagesInSearchHistory,
    searchEventsHistory: args.searchEventsHistory,
    brokenInternalLinksHistory: args.brokenInternalLinksHistory,
    externalLinksHistory: args.externalLinksHistory,
    partial: args.endpointErrors.length > 0,
    endpointErrors: args.endpointErrors,
  });
}
