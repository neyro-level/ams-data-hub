import {
  webmasterDeviceSchema,
  webmasterQueryOrderBySchema,
  type WebmasterEndpointError,
  type WebmasterHostAccess,
} from "../../../src/shared/schemas/webmaster-source.ts";
import {
  WebmasterSafeError,
  type FetchLike,
  getWebmasterJson,
  postWebmasterJson,
  type QueryValue,
} from "./http.ts";
import {
  buildWebmasterSiteData,
  findExactVerifiedHost,
  normalizeDiagnostics,
  normalizeIndicatorHistory,
  normalizePlainHistory,
  normalizePopularQueries,
  normalizeQueryAnalytics,
  normalizeSiteUrl,
  normalizeSitemaps,
  normalizeSummary,
} from "./normalize.ts";
import { requireTrustedApiBaseUrl } from "../trusted-api-url.ts";

export type WebmasterEnvironment = {
  token: string;
  baseUrl: string;
  targetSiteUrl: string;
  tokenStatus: string | null;
};

export type WebmasterClientDependencies = {
  fetchImpl?: FetchLike;
  now?: () => string;
};

export function readWebmasterEnvironment(env: NodeJS.ProcessEnv = process.env): WebmasterEnvironment {
  const token = env.YANDEX_WEBMASTER_OAUTH_TOKEN?.trim();
  const baseUrl = env.YANDEX_WEBMASTER_API_BASE_URL?.trim();
  const targetSiteUrl = env.YANDEX_WEBMASTER_SITE_URL?.trim();
  const tokenStatus = env.YANDEX_WEBMASTER_TOKEN_STATUS?.trim() ?? null;

  if (!token) {
    throw new WebmasterSafeError({
      code: "MISSING_ENV",
      endpoint: "env:YANDEX_WEBMASTER_OAUTH_TOKEN",
      message: "Required environment variable is missing: YANDEX_WEBMASTER_OAUTH_TOKEN",
    });
  }

  if (!baseUrl) {
    throw new WebmasterSafeError({
      code: "MISSING_ENV",
      endpoint: "env:YANDEX_WEBMASTER_API_BASE_URL",
      message: "Required environment variable is missing: YANDEX_WEBMASTER_API_BASE_URL",
    });
  }

  if (!targetSiteUrl) {
    throw new WebmasterSafeError({
      code: "MISSING_ENV",
      endpoint: "env:YANDEX_WEBMASTER_SITE_URL",
      message: "Required environment variable is missing: YANDEX_WEBMASTER_SITE_URL",
    });
  }

  if (tokenStatus !== null && tokenStatus.toUpperCase() !== "ACTIVE") {
    throw new WebmasterSafeError({
      code: "TOKEN_INACTIVE",
      endpoint: "env:YANDEX_WEBMASTER_TOKEN_STATUS",
      message: "YANDEX_WEBMASTER_TOKEN_STATUS is not ACTIVE",
    });
  }

  let trustedBaseUrl: string;
  try {
    trustedBaseUrl = requireTrustedApiBaseUrl(baseUrl, {
      origin: "https://api.webmaster.yandex.net",
      pathname: "/v4",
    });
  } catch {
    throw new WebmasterSafeError({
      code: "UNTRUSTED_ORIGIN",
      endpoint: "env:YANDEX_WEBMASTER_API_BASE_URL",
      message: "YANDEX_WEBMASTER_API_BASE_URL is not allowlisted",
    });
  }

  return {
    token,
    baseUrl: trustedBaseUrl,
    targetSiteUrl: normalizeSiteUrl(targetSiteUrl),
    tokenStatus,
  };
}

export function createWebmasterClient(config: WebmasterEnvironment, deps: WebmasterClientDependencies = {}) {
  const fetchImpl = deps.fetchImpl;
  const now = deps.now ?? (() => new Date().toISOString());

  async function getUserId() {
    const payload = await getWebmasterJson({
      baseUrl: config.baseUrl,
      token: config.token,
      endpoint: "/user",
      fetchImpl,
    });

    const root = payload as Record<string, unknown>;
    const userId =
      typeof root.user_id === "number" || typeof root.user_id === "string"
        ? String(root.user_id)
        : typeof root.id === "number" || typeof root.id === "string"
          ? String(root.id)
          : null;

    if (!userId) {
      throw new WebmasterSafeError({
        code: "INVALID_RESPONSE",
        endpoint: "/user",
        message: "Yandex Webmaster API did not return user_id",
      });
    }

    return userId;
  }

  async function resolveVerifiedHost(): Promise<WebmasterHostAccess> {
    const userId = await getUserId();
    const hostsPayload = await getWebmasterJson({
      baseUrl: config.baseUrl,
      token: config.token,
      endpoint: `/user/${userId}/hosts`,
      fetchImpl,
    });

    const root = hostsPayload as Record<string, unknown>;
    if (root.user_id === undefined) {
      root.user_id = userId;
    }

    const access = findExactVerifiedHost(root, config.targetSiteUrl);
    if (!access) {
      throw new WebmasterSafeError({
        code: "TARGET_SITE_MISSING",
        endpoint: `/user/${userId}/hosts`,
        message: "Target site is not available to the OAuth user in Yandex Webmaster",
      });
    }

    if (!access.verified) {
      throw new WebmasterSafeError({
        code: "TARGET_SITE_UNVERIFIED",
        endpoint: `/user/${userId}/hosts`,
        message: "Target site exists in Yandex Webmaster but is not verified for this user",
      });
    }

    return access;
  }

  async function collectOptional(
    endpoint: string,
    endpointErrors: WebmasterEndpointError[],
    query?: Record<string, QueryValue>,
    execute?: () => Promise<unknown>,
  ) {
    try {
      return execute ? await execute() : await getWebmasterJson({
        baseUrl: config.baseUrl,
        token: config.token,
        endpoint,
        query,
        fetchImpl,
      });
    } catch (error) {
      if (!(error instanceof WebmasterSafeError)) {
        throw error;
      }

      endpointErrors.push({
        endpoint,
        code: error.code,
        status: error.status,
      });
      return null;
    }
  }

  async function preflight() {
    return resolveVerifiedHost();
  }

  async function collectSiteData(options?: {
    queryLimit?: number;
    queryOrders?: Array<"TOTAL_SHOWS" | "TOTAL_CLICKS">;
    devices?: Array<"ALL" | "DESKTOP" | "MOBILE">;
    historyDateFrom?: string;
    historyDateTo?: string;
    queryDateFrom?: string;
    queryDateTo?: string;
    includeTechnicalDetails?: boolean;
  }) {
    const access = await resolveVerifiedHost();
    const queryLimit = options?.queryLimit ?? 50;
    const includeTechnicalDetails = options?.includeTechnicalDetails ?? true;
    const queryOrders = options?.queryOrders ?? ["TOTAL_SHOWS", "TOTAL_CLICKS"];
    const devices = options?.devices ?? ["ALL", "DESKTOP", "MOBILE"];
    const fetchedAt = now();
    const historyDateTo = options?.historyDateTo ?? fetchedAt.slice(0, 10);
    const historyDateFrom =
      options?.historyDateFrom ??
      new Date(Date.parse(`${historyDateTo}T00:00:00.000Z`) - 29 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    const historyQuery = {
      date_from: historyDateFrom,
      date_to: historyDateTo,
    };
    const sqiHistoryQuery = {
      date_from: new Date(
        Date.parse(`${historyDateTo}T00:00:00.000Z`) - 365 * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10),
      date_to: historyDateTo,
    };
    const endpointErrors: WebmasterEndpointError[] = [];
    const baseEndpoint = `/user/${access.userId}/hosts/${access.hostId}`;

    const summaryPayload = await collectOptional(`${baseEndpoint}/summary`, endpointErrors);
    const diagnosticsPayload = includeTechnicalDetails
      ? await collectOptional(`${baseEndpoint}/diagnostics`, endpointErrors)
      : null;
    const sitemapsPayload = includeTechnicalDetails
      ? await collectOptional(`${baseEndpoint}/sitemaps`, endpointErrors)
      : null;
    const indexingPayload = includeTechnicalDetails
      ? await collectOptional(
          `${baseEndpoint}/indexing/history`,
          endpointErrors,
          historyQuery,
        )
      : null;
    const sqiHistoryPayload = includeTechnicalDetails
      ? await collectOptional(
          `${baseEndpoint}/sqi-history`,
          endpointErrors,
          sqiHistoryQuery,
        )
      : null;
    const pagesInSearchPayload = await collectOptional(
      `${baseEndpoint}/search-urls/in-search/history`,
      endpointErrors,
      historyQuery,
    );
    const searchEventsPayload = includeTechnicalDetails
      ? await collectOptional(
          `${baseEndpoint}/search-urls/events/history`,
          endpointErrors,
          historyQuery,
        )
      : null;
    const brokenInternalLinksPayload = includeTechnicalDetails
      ? await collectOptional(
          `${baseEndpoint}/links/internal/broken/history`,
          endpointErrors,
          historyQuery,
        )
      : null;
    const externalLinksPayload = includeTechnicalDetails
      ? await collectOptional(
          `${baseEndpoint}/links/external/history`,
          endpointErrors,
          { indicator: "LINKS_TOTAL_COUNT" },
        )
      : null;

    const queryCollections = [];
    const queryAnalyticsByDevice = new Map<string, Map<string, { demand: number | null; relevantUrl: string | null }>>();
    for (const device of devices) {
      const analyticsPayload = await collectOptional(`${baseEndpoint}/query-analytics/list`, endpointErrors, {}, () => postWebmasterJson({ baseUrl: config.baseUrl, token: config.token, endpoint: `${baseEndpoint}/query-analytics/list`, body: { offset: 0, limit: 500, device_type_indicator: device, search_location: "WEB_LOCATION", text_indicator: "QUERY", sort_by_date: options?.queryDateTo ? { date: options.queryDateTo, statistic_field: "IMPRESSIONS", by: "DESC" } : undefined }, fetchImpl }));
      if (analyticsPayload !== null) queryAnalyticsByDevice.set(device, new Map(normalizeQueryAnalytics(analyticsPayload).map((row) => [row.query, row])));
    }
    for (const orderBy of queryOrders) {
      webmasterQueryOrderBySchema.parse(orderBy);
      for (const device of devices) {
        webmasterDeviceSchema.parse(device);
        const queriesPayload = await collectOptional(
          `${baseEndpoint}/search-queries/popular`,
          endpointErrors,
          {
            order_by: orderBy,
            query_indicator: [
              "TOTAL_SHOWS",
              "TOTAL_CLICKS",
              "AVG_SHOW_POSITION",
              "AVG_CLICK_POSITION",
            ],
            device_type_indicator: device,
            limit: queryLimit,
            date_from: options?.queryDateFrom,
            date_to: options?.queryDateTo,
          },
        );
        if (queriesPayload === null) {
          continue;
        }
        const collection = normalizePopularQueries({
            payload: queriesPayload,
            orderBy,
            device,
            requestedLimit: queryLimit,
          });
        const analytics = queryAnalyticsByDevice.get(device);
        queryCollections.push({ ...collection, queries: collection.queries.map((query) => ({ ...query, ...(analytics?.get(query.queryText.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim()) ?? { demand: null, relevantUrl: null }) })) });
      }
    }
    const actualQueryDateFrom =
      queryCollections[0]?.dateFrom ?? options?.queryDateFrom ?? null;
    const actualQueryDateTo = queryCollections[0]?.dateTo ?? options?.queryDateTo ?? null;
    const allQueryHistoryPayload = await collectOptional(
      `${baseEndpoint}/search-queries/all/history`,
      endpointErrors,
      {
        query_indicator: [
          "TOTAL_SHOWS",
          "TOTAL_CLICKS",
          "AVG_SHOW_POSITION",
          "AVG_CLICK_POSITION",
        ],
        device_type_indicator: "ALL",
        date_from: actualQueryDateFrom,
        date_to: actualQueryDateTo,
      },
    );

    return buildWebmasterSiteData({
      fetchedAt,
      access,
      summary: normalizeSummary(summaryPayload, config.targetSiteUrl),
      diagnostics: normalizeDiagnostics(diagnosticsPayload),
      sitemaps: normalizeSitemaps(sitemapsPayload),
      queryCollections,
      allQueryHistory: normalizeIndicatorHistory(allQueryHistoryPayload),
      indexingHistory: normalizeIndicatorHistory(indexingPayload),
      pagesInSearchHistory: normalizePlainHistory(pagesInSearchPayload),
      sqiHistory: normalizePlainHistory(sqiHistoryPayload),
      searchEventsHistory: normalizeIndicatorHistory(searchEventsPayload),
      brokenInternalLinksHistory: normalizeIndicatorHistory(brokenInternalLinksPayload),
      externalLinksHistory: normalizeIndicatorHistory(externalLinksPayload),
      endpointErrors,
    });
  }

  return {
    preflight,
    collectSiteData,
  };
}
