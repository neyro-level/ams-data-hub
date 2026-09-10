import {
  getSeoConversionGoalIds,
} from "../../orchestration/metrica-site-config.ts";
import { type MetricaAllowedGoal, type MetricaCounterAccess } from "../../../src/shared/schemas/metrica-source.ts";
import { MetricaSafeError, type FetchLike, getMetricaJson } from "./http.ts";
import {
  buildMetricaPreflight,
  buildMetricaSiteAudit,
  normalizeByTimeReport,
  normalizeDevices,
  normalizeGoals,
  normalizeGoalTotals,
  normalizeOrganicEngineRows,
  normalizeSearchPhrases,
  normalizeGeography,
  normalizeLandingPages,
  normalizeMetricaSiteUrl,
  normalizeSampleMeta,
  normalizeSummaryFromNamedRow,
  normalizeSummaryFromTotals,
  normalizeTargetVisitTotals,
  resolveCounterAccess,
} from "./normalize.ts";
import {
  METRICA_COUNTERS_ENDPOINT,
  METRICA_GOALS_ENDPOINT,
  METRICA_REPORT_BYTIME_ENDPOINT,
  METRICA_REPORT_TABLE_ENDPOINT,
} from "./contract.ts";
import { requireTrustedApiBaseUrl } from "../trusted-api-url.ts";

export type MetricaEnvironment = {
  token: string;
  baseUrl: string;
  targetSiteUrl: string;
  tokenStatus: string | null;
};

export type MetricaClientDependencies = {
  fetchImpl?: FetchLike;
  now?: () => string;
};

function buildGoalReachMetrics(goalIds: string[]) {
  return goalIds.map((goalId) => `ym:s:goal${goalId}reaches`);
}

function buildGoalStatMetrics(goalId: string) {
  return [
    `ym:s:goal${goalId}reaches`,
    `ym:s:goal${goalId}visits`,
    `ym:s:goal${goalId}users`,
    `ym:s:goal${goalId}conversionRate`,
  ];
}

function buildYandexOrganicFilter() {
  return "ym:s:lastsignSearchEngineRootName=='Yandex'";
}

function buildEngineOrganicFilter(engine: "YANDEX" | "GOOGLE") {
  return `ym:s:lastsignSearchEngineRootName=='${engine === "YANDEX" ? "Yandex" : "Google"}'`;
}

function buildUniqueTargetFilter(goalIds: string[], engine: "YANDEX" | "GOOGLE" = "YANDEX") {
  if (goalIds.length === 0) {
    return null;
  }

  const targetFilter = goalIds
    .map((goalId) => `ym:s:goal${goalId}IsReached=='Yes'`)
    .join(" OR ");
  return `${buildEngineOrganicFilter(engine)} AND (${targetFilter})`;
}

export function readMetricaEnvironment(env: NodeJS.ProcessEnv = process.env): MetricaEnvironment {
  const token = env.YANDEX_METRICA_OAUTH_TOKEN?.trim();
  const baseUrl = env.YANDEX_METRICA_API_BASE_URL?.trim();
  const targetSiteUrl = env.YANDEX_METRICA_SITE_URL?.trim();
  const tokenStatus = env.YANDEX_METRICA_TOKEN_STATUS?.trim() ?? null;

  if (!token) {
    throw new MetricaSafeError({
      code: "MISSING_ENV",
      endpoint: "env:YANDEX_METRICA_OAUTH_TOKEN",
      message: "Required environment variable is missing: YANDEX_METRICA_OAUTH_TOKEN",
    });
  }

  if (!baseUrl) {
    throw new MetricaSafeError({
      code: "MISSING_ENV",
      endpoint: "env:YANDEX_METRICA_API_BASE_URL",
      message: "Required environment variable is missing: YANDEX_METRICA_API_BASE_URL",
    });
  }

  if (!targetSiteUrl) {
    throw new MetricaSafeError({
      code: "MISSING_ENV",
      endpoint: "env:YANDEX_METRICA_SITE_URL",
      message: "Required environment variable is missing: YANDEX_METRICA_SITE_URL",
    });
  }

  if (tokenStatus !== null && tokenStatus.toUpperCase() !== "ACTIVE") {
    throw new MetricaSafeError({
      code: "TOKEN_INACTIVE",
      endpoint: "env:YANDEX_METRICA_TOKEN_STATUS",
      message: "YANDEX_METRICA_TOKEN_STATUS is not ACTIVE",
    });
  }

  let trustedBaseUrl: string;
  try {
    trustedBaseUrl = requireTrustedApiBaseUrl(baseUrl, {
      origin: "https://api-metrika.yandex.net",
      pathname: "/",
    });
  } catch {
    throw new MetricaSafeError({
      code: "UNTRUSTED_ORIGIN",
      endpoint: "env:YANDEX_METRICA_API_BASE_URL",
      message: "YANDEX_METRICA_API_BASE_URL is not allowlisted",
    });
  }

  return {
    token,
    baseUrl: trustedBaseUrl,
    targetSiteUrl: normalizeMetricaSiteUrl(targetSiteUrl),
    tokenStatus,
  };
}

export function createMetricaClient(config: MetricaEnvironment, deps: MetricaClientDependencies = {}) {
  const fetchImpl = deps.fetchImpl;
  const now = deps.now ?? (() => new Date().toISOString());

  async function listCounters(searchString?: string) {
    return getMetricaJson({
      baseUrl: config.baseUrl,
      token: config.token,
      endpoint: METRICA_COUNTERS_ENDPOINT,
      query: {
        per_page: 1000,
        search_string: searchString ?? undefined,
      },
      fetchImpl,
    });
  }

  async function resolveCounterBySite(): Promise<MetricaCounterAccess> {
    const payload = await listCounters(config.targetSiteUrl);
    const access = resolveCounterAccess(payload, config.targetSiteUrl);
    if (!access) {
      throw new MetricaSafeError({
        code: "COUNTER_MISSING",
        endpoint: METRICA_COUNTERS_ENDPOINT,
        message: "Target site counter is not available to the OAuth user in Yandex Metrica",
      });
    }
    return access;
  }

  async function listGoals(counterId: string) {
    return getMetricaJson({
      baseUrl: config.baseUrl,
      token: config.token,
      endpoint: METRICA_GOALS_ENDPOINT(counterId),
      fetchImpl,
    });
  }

  async function getTableReport(query: Record<string, string | number | boolean | Array<string | number | boolean> | null | undefined>) {
    return getMetricaJson({
      baseUrl: config.baseUrl,
      token: config.token,
      endpoint: METRICA_REPORT_TABLE_ENDPOINT,
      query,
      fetchImpl,
    });
  }

  async function getByTimeReport(query: Record<string, string | number | boolean | Array<string | number | boolean> | null | undefined>) {
    return getMetricaJson({
      baseUrl: config.baseUrl,
      token: config.token,
      endpoint: METRICA_REPORT_BYTIME_ENDPOINT,
      query,
      fetchImpl,
    });
  }

  async function preflight() {
    const access = await resolveCounterBySite();
    const goals = normalizeGoals(await listGoals(access.counterId));
    return buildMetricaPreflight({
      checkedAt: now(),
      access,
      goals,
    });
  }

  async function collectSiteData(options?: {
    date1?: string;
    date2?: string;
    landingLimit?: number;
    includeDetails?: boolean;
    allowedGoals?: MetricaAllowedGoal[];
    timezone?: string;
  }) {
    const access = await resolveCounterBySite();
    const includeDetails = options?.includeDetails ?? true;
    const goals = includeDetails ? normalizeGoals(await listGoals(access.counterId)) : [];
    if (options?.allowedGoals === undefined || options.timezone === undefined) {
      throw new MetricaSafeError({
        code: "INVALID_RESPONSE",
        endpoint: "runtime:metrica-configuration",
        message: "Metrica collection requires database-owned goals and timezone",
      });
    }

    const allowedGoals = options.allowedGoals;
    const seoConversionGoalIds = getSeoConversionGoalIds(allowedGoals);
    const goalReachesMetrics = buildGoalReachMetrics(
      allowedGoals.map((goal) => goal.goalId),
    );
    const timezone = options.timezone;
    const commonDates = {
      date1: options?.date1 ?? "30daysAgo",
      date2: options?.date2 ?? "today",
      timezone,
    };

    const allTrafficPayload = await getTableReport({
      ids: access.counterId,
      metrics: [
        "ym:s:visits",
        "ym:s:users",
        "ym:s:pageviews",
        "ym:s:bounceRate",
        "ym:s:pageDepth",
        "ym:s:avgVisitDurationSeconds",
        ...goalReachesMetrics,
      ],
      ...commonDates,
    });

    const searchEnginePayload = await getTableReport({
      ids: access.counterId,
      dimensions: "ym:s:lastsignSearchEngineRootName",
      metrics: [
        "ym:s:visits",
        "ym:s:users",
        "ym:s:pageviews",
        "ym:s:bounceRate",
        "ym:s:pageDepth",
        "ym:s:avgVisitDurationSeconds",
        ...goalReachesMetrics,
      ],
      sort: "-ym:s:visits",
      limit: 20,
      ...commonDates,
    });

    const organicFilter = buildYandexOrganicFilter();
    const uniqueTargetFilter = buildUniqueTargetFilter(seoConversionGoalIds);
    const uniqueTargetPayload = uniqueTargetFilter
      ? await getTableReport({
          ids: access.counterId,
          metrics: ["ym:s:visits", "ym:s:users"],
          filters: uniqueTargetFilter,
          ...commonDates,
        })
      : { totals: [0, 0], query: commonDates };
    const uniqueTargetTotals = normalizeTargetVisitTotals(uniqueTargetPayload);

    const engineDetails = await Promise.all((["YANDEX", "GOOGLE"] as const).map(async (engine) => {
      const engineFilter = buildEngineOrganicFilter(engine);
      const engineTargetFilter = buildUniqueTargetFilter(seoConversionGoalIds, engine);
      const [targetPayload, phrasesPayload, targetPhrasesPayload] = await Promise.all([
        engineTargetFilter ? getTableReport({ ids: access.counterId, metrics: "ym:s:visits", filters: engineTargetFilter, ...commonDates }) : Promise.resolve({ totals: [0] }),
        getTableReport({ ids: access.counterId, dimensions: "ym:s:lastSearchPhrase", metrics: ["ym:s:visits", "ym:s:users", ...goalReachesMetrics], filters: engineFilter, sort: "-ym:s:visits", limit: 500, ...commonDates }),
        engineTargetFilter ? getTableReport({ ids: access.counterId, dimensions: "ym:s:lastSearchPhrase", metrics: "ym:s:visits", filters: engineTargetFilter, sort: "-ym:s:visits", limit: 500, ...commonDates }) : Promise.resolve({ data: [] }),
      ]);
      return { engine, targetVisits: normalizeTargetVisitTotals(targetPayload).targetVisits, phrases: normalizeSearchPhrases(engine, phrasesPayload, targetPhrasesPayload) };
    }));
    const allOrganicFilter = `(${buildEngineOrganicFilter("YANDEX")} OR ${buildEngineOrganicFilter("GOOGLE")})`;
    const allTargetFilter = seoConversionGoalIds.length ? `(${allOrganicFilter}) AND (${seoConversionGoalIds.map((goalId) => `ym:s:goal${goalId}IsReached=='Yes'`).join(" OR ")})` : null;
    const [geographyPayload, targetGeographyPayload] = await Promise.all([
      getTableReport({ ids: access.counterId, dimensions: ["ym:s:regionCountryName", "ym:s:regionAreaName", "ym:s:regionCityName"], metrics: ["ym:s:visits", "ym:s:users", ...goalReachesMetrics], filters: allOrganicFilter, sort: "-ym:s:visits", limit: 50, ...commonDates }),
      allTargetFilter ? getTableReport({ ids: access.counterId, dimensions: ["ym:s:regionCountryName", "ym:s:regionAreaName", "ym:s:regionCityName"], metrics: "ym:s:visits", filters: allTargetFilter, sort: "-ym:s:visits", limit: 50, ...commonDates }) : Promise.resolve({ data: [] }),
    ]);

    const byTimePayload = includeDetails
      ? await getByTimeReport({
          ids: access.counterId,
          metrics: ["ym:s:visits", ...goalReachesMetrics],
          filters: organicFilter,
          group: "day",
          ...commonDates,
        })
      : { data: [], time_intervals: [] };
    const targetByTimePayload =
      includeDetails && uniqueTargetFilter
        ? await getByTimeReport({
            ids: access.counterId,
            metrics: "ym:s:visits",
            filters: uniqueTargetFilter,
            group: "day",
            ...commonDates,
          })
        : { data: [] };

    const landingPayload = includeDetails
      ? await getTableReport({
          ids: access.counterId,
          dimensions: "ym:s:startURLPath",
          metrics: [
            "ym:s:visits",
            "ym:s:users",
            "ym:s:pageviews",
            "ym:s:bounceRate",
            "ym:s:pageDepth",
            "ym:s:avgVisitDurationSeconds",
            ...goalReachesMetrics,
          ],
          filters: organicFilter,
          sort: "-ym:s:visits",
          limit: options?.landingLimit ?? 50,
          ...commonDates,
        })
      : { data: [] };
    const targetLandingPayload =
      includeDetails && uniqueTargetFilter
        ? await getTableReport({
            ids: access.counterId,
            dimensions: "ym:s:startURLPath",
            metrics: "ym:s:visits",
            filters: uniqueTargetFilter,
            sort: "-ym:s:visits",
            limit: options?.landingLimit ?? 50,
            ...commonDates,
          })
        : { data: [] };
    const devicesPayload = includeDetails
      ? await getTableReport({
          ids: access.counterId,
          dimensions: "ym:s:deviceCategory",
          metrics: ["ym:s:visits", "ym:s:users", ...goalReachesMetrics],
          filters: organicFilter,
          sort: "-ym:s:visits",
          limit: 10,
          ...commonDates,
        })
      : { data: [] };

    const goalsSummaryPayloads: Array<{
      allowedGoal: MetricaAllowedGoal;
      payload: unknown;
    }> = [];
    if (includeDetails) {
      for (const allowedGoal of allowedGoals) {
        const payload = await getTableReport({
          ids: access.counterId,
          metrics: buildGoalStatMetrics(allowedGoal.goalId),
          filters: organicFilter,
          ...commonDates,
        });
        goalsSummaryPayloads.push({ allowedGoal, payload });
      }
    }

    return buildMetricaSiteAudit({
      fetchedAt: now(),
      access,
      goals,
      allowedGoals,
      allTrafficMeta: normalizeSampleMeta(allTrafficPayload),
      allTrafficSummary: normalizeSummaryFromTotals(allTrafficPayload),
      organicMeta: normalizeSampleMeta(searchEnginePayload),
      organicSummary: normalizeSummaryFromNamedRow(searchEnginePayload, "Yandex"),
      targetVisits: uniqueTargetTotals.targetVisits,
      targetUsers: uniqueTargetTotals.targetUsers,
      byTime: normalizeByTimeReport(byTimePayload, targetByTimePayload),
      landingPages: normalizeLandingPages(landingPayload, targetLandingPayload),
      devices: normalizeDevices(devicesPayload),
      goalsMeta:
        goalsSummaryPayloads.length > 0
          ? normalizeSampleMeta(goalsSummaryPayloads[0].payload)
          : normalizeSampleMeta({}),
      goalsSummary: goalsSummaryPayloads.map((item) =>
        normalizeGoalTotals(item.payload, item.allowedGoal),
      ),
      organicEngines: normalizeOrganicEngineRows(searchEnginePayload, Object.fromEntries(engineDetails.map((item) => [item.engine, item.targetVisits]))),
      searchPhrases: engineDetails.flatMap((item) => item.phrases),
      geography: normalizeGeography(geographyPayload, targetGeographyPayload),
    });
  }

  return {
    preflight,
    collectSiteData,
  };
}
