import {
  metricaCounterAccessSchema,
  metricaDeviceRowSchema,
  metricaGoalSchema,
  metricaGoalStatSchema,
  metricaOrganicEngineRowSchema,
  metricaSearchPhraseRowSchema,
  metricaGeoRowSchema,
  metricaLandingPageSchema,
  metricaPreflightSchema,
  metricaSampleMetaSchema,
  metricaSiteAuditSchema,
  metricaSummarySchema,
  metricaTrendPointSchema,
  type MetricaAllowedGoal,
  type MetricaCounterAccess,
  type MetricaDeviceRow,
  type MetricaGoal,
  type MetricaGoalStat,
  type MetricaOrganicEngineRow,
  type MetricaSearchPhraseRow,
  type MetricaGeoRow,
  type MetricaLandingPage,
  type MetricaSampleMeta,
  type MetricaSummary,
  type MetricaTrendPoint,
} from "../../../src/shared/schemas/metrica-source.ts";

function getRecord(value: unknown) {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getArray(value: unknown) {
  return Array.isArray(value) ? value : [];
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
    return null;
  }

  for (const name of names) {
    const value = record[name];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
  }

  return null;
}

function toMetricArray(value: unknown) {
  return getArray(value).map((item) => (typeof item === "number" && Number.isFinite(item) ? item : 0));
}

function sumGoalReaches(metrics: number[], baseMetricCount: number) {
  return metrics.slice(baseMetricCount).reduce((sum, value) => sum + value, 0);
}


function normalizeMetricSummary(metrics: number[], baseMetricCount = 6): MetricaSummary {
  const visits = metrics[0] ?? 0;
  const users = metrics[1] ?? 0;
  const pageviews = metrics[2] ?? 0;
  const bounceRate = metrics[3] ?? 0;
  const pageDepth = metrics[4] ?? 0;
  const averageVisitDurationSeconds = metrics[5] ?? 0;
  const goalReaches = sumGoalReaches(metrics, baseMetricCount);

  return metricaSummarySchema.parse({
    visits,
    users,
    pageviews,
    bounceRate,
    pageDepth,
    averageVisitDurationSeconds,
    goalReaches,
    conversionRate: null,
  });
}

function normalizeLandingPath(path: string | null) {
  if (!path || path.trim().length === 0) {
    return "/";
  }

  return path;
}

export function normalizeMetricaSiteUrl(url: string) {
  const parsed = url.includes("://") ? new URL(url) : new URL(`https://${url}`);
  const normalizedPath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  return `${parsed.hostname.toLowerCase()}${normalizedPath}`;
}

function getCounterCandidateSites(counter: Record<string, unknown>) {
  const site2 = getRecord(counter.site2);
  const mirrors = getArray(counter.mirrors).map(getRecord).filter((value): value is Record<string, unknown> => value !== null);
  const values = [
    getString(counter, "site"),
    getString(site2, "site"),
    getString(site2, "domain"),
    ...mirrors.map((mirror) => getString(mirror, "site", "domain")).filter((value): value is string => value !== null),
  ];
  return values.filter((value): value is string => value !== null);
}

export function resolveCounterAccess(countersPayload: unknown, targetSiteUrl: string): MetricaCounterAccess | null {
  const root = getRecord(countersPayload);
  const counters = getArray(root?.counters).map(getRecord).filter((value): value is Record<string, unknown> => value !== null);
  const target = normalizeMetricaSiteUrl(targetSiteUrl);

  for (const counter of counters) {
    const candidates = getCounterCandidateSites(counter);
    const matchedSite = candidates.find((candidate) => normalizeMetricaSiteUrl(candidate) === target);
    if (!matchedSite) {
      continue;
    }

    return metricaCounterAccessSchema.parse({
      counterId: String(getNumber(counter, "id") ?? ""),
      site: matchedSite,
      permission: getString(counter, "permission") ?? "unknown",
      name: getString(counter, "name") ?? matchedSite,
      timeZoneName: getString(counter, "time_zone_name"),
      timeZoneOffsetMinutes: getNumber(counter, "time_zone_offset"),
    });
  }

  return null;
}

export function normalizeGoals(goalsPayload: unknown): MetricaGoal[] {
  const root = getRecord(goalsPayload);
  const goals = getArray(root?.goals).map(getRecord).filter((value): value is Record<string, unknown> => value !== null);

  return goals.map((goal) =>
    metricaGoalSchema.parse({
      goalId: String(getNumber(goal, "id") ?? ""),
      name: getString(goal, "name") ?? "Unnamed goal",
      type: getString(goal, "type") ?? "unknown",
      isFavorite: getBoolean(goal, "is_favorite"),
      status: getString(goal, "status"),
    }),
  );
}

export function normalizeSampleMeta(reportPayload: unknown): MetricaSampleMeta {
  const root = getRecord(reportPayload);
  const query = getRecord(root?.query);

  return metricaSampleMetaSchema.parse({
    sampled: getBoolean(root, "sampled") ?? false,
    containsSensitiveData: getBoolean(root, "contains_sensitive_data") ?? false,
    sampleShare: getNumber(root, "sample_share"),
    sampleSize: getNumber(root, "sample_size"),
    sampleSpace: getNumber(root, "sample_space"),
    totalRows: getNumber(root, "total_rows"),
    totalRowsRounded: getBoolean(root, "total_rows_rounded"),
    date1: getString(query, "date1"),
    date2: getString(query, "date2"),
    timezone: getString(query, "timezone"),
  });
}

export function normalizeSummaryFromTotals(reportPayload: unknown) {
  const root = getRecord(reportPayload);
  const totals = toMetricArray(root?.totals);
  return normalizeMetricSummary(totals);
}

export function normalizeTargetVisitTotals(reportPayload: unknown) {
  const root = getRecord(reportPayload);
  const totals = toMetricArray(root?.totals);
  return {
    targetVisits: totals[0] ?? 0,
    targetUsers: totals[1] ?? 0,
  };
}

export function normalizeSummaryFromNamedRow(reportPayload: unknown, rowName: string) {
  const root = getRecord(reportPayload);
  const rows = getArray(root?.data).map(getRecord).filter((value): value is Record<string, unknown> => value !== null);
  const matched = rows.find((row) => getString(getArray(row.dimensions).map(getRecord)[0] ?? null, "name") === rowName);
  if (!matched) {
    return normalizeMetricSummary([]);
  }

  return normalizeMetricSummary(toMetricArray(matched.metrics));
}

export function normalizeByTimeReport(
  reportPayload: unknown,
  targetVisitsPayload?: unknown,
): MetricaTrendPoint[] {
  const root = getRecord(reportPayload);
  const timeIntervals = getArray(root?.time_intervals);
  const rows = getArray(root?.data)
    .map(getRecord)
    .filter((value): value is Record<string, unknown> => value !== null);
  const metricsMatrix = getArray(rows[0]?.metrics).map(toMetricArray);
  const visitsSeries = metricsMatrix[0] ?? [];
  const goalSeries = metricsMatrix.slice(1);
  const targetRoot = getRecord(targetVisitsPayload);
  const targetRows = getArray(targetRoot?.data)
    .map(getRecord)
    .filter((value): value is Record<string, unknown> => value !== null);
  const targetVisitsSeries = getArray(targetRows[0]?.metrics).map(toMetricArray)[0] ?? [];
  const points: MetricaTrendPoint[] = [];

  for (let index = 0; index < timeIntervals.length; index += 1) {
    const interval = getArray(timeIntervals[index]);
    const date = typeof interval[0] === "string" ? interval[0] : String(index);
    const visits = visitsSeries[index] ?? 0;
    const goalReaches = goalSeries.reduce((sum, series) => sum + (series[index] ?? 0), 0);
    const targetVisits = targetVisitsSeries[index] ?? 0;
    points.push(
      metricaTrendPointSchema.parse({
        date,
        visits,
        goalReaches,
        targetVisits,
        conversionRate:
          visits > 0 ? Number(((targetVisits / visits) * 100).toFixed(2)) : null,
      }),
    );
  }

  return points;
}

function normalizeRowMetrics(row: Record<string, unknown>) {
  return toMetricArray(row.metrics);
}

export function normalizeLandingPages(
  reportPayload: unknown,
  targetVisitsPayload?: unknown,
): MetricaLandingPage[] {
  const root = getRecord(reportPayload);
  const rows = getArray(root?.data)
    .map(getRecord)
    .filter((value): value is Record<string, unknown> => value !== null);
  const targetRoot = getRecord(targetVisitsPayload);
  const targetVisitsByPath = new Map<string, number>();
  for (const row of getArray(targetRoot?.data)
    .map(getRecord)
    .filter((value): value is Record<string, unknown> => value !== null)) {
    const path = normalizeLandingPath(
      getString(getArray(row.dimensions).map(getRecord)[0] ?? null, "name"),
    );
    targetVisitsByPath.set(path, normalizeRowMetrics(row)[0] ?? 0);
  }
  return rows.map((row) => {
    const metrics = normalizeRowMetrics(row);
    const visits = metrics[0] ?? 0;
    const users = metrics[1] ?? 0;
    const pageviews = metrics[2] ?? 0;
    const bounceRate = metrics[3] ?? 0;
    const pageDepth = metrics[4] ?? 0;
    const averageVisitDurationSeconds = metrics[5] ?? 0;
    const goalReaches = sumGoalReaches(metrics, 6);
    const path = normalizeLandingPath(
      getString(getArray(row.dimensions).map(getRecord)[0] ?? null, "name"),
    );
    const targetVisits = targetVisitsByPath.get(path) ?? 0;

    return metricaLandingPageSchema.parse({
      path,
      visits,
      users,
      pageviews,
      bounceRate,
      pageDepth,
      averageVisitDurationSeconds,
      goalReaches,
      targetVisits,
      conversionRate:
        visits > 0 ? Number(((targetVisits / visits) * 100).toFixed(2)) : null,
    });
  });
}

function normalizeDeviceName(rawId: string | null, rawName: string | null) {
  switch (rawId) {
    case "desktop":
      return "desktop";
    case "mobile":
      return "mobile";
    case "tablet":
      return "tablet";
    default:
      if (rawName && rawName.trim().length > 0) {
        return rawName.toLowerCase() === "tv" ? "other" : rawName;
      }
      return "other";
  }
}

export function normalizeDevices(reportPayload: unknown): MetricaDeviceRow[] {
  const root = getRecord(reportPayload);
  const rows = getArray(root?.data).map(getRecord).filter((value): value is Record<string, unknown> => value !== null);

  return rows.map((row) => {
    const dimension = getArray(row.dimensions).map(getRecord)[0] ?? null;
    const metrics = normalizeRowMetrics(row);
    const visits = metrics[0] ?? 0;
    const users = metrics[1] ?? 0;
    const goalReaches = sumGoalReaches(metrics, 2);

    return metricaDeviceRowSchema.parse({
      device: normalizeDeviceName(getString(dimension, "id"), getString(dimension, "name")),
      visits,
      users,
      goalReaches,
      conversionRate: null,
    });
  });
}

export function normalizeGoalTotals(payload: unknown, allowedGoal: MetricaAllowedGoal): MetricaGoalStat {
  const root = getRecord(payload);
  const totals = toMetricArray(root?.totals);

  return metricaGoalStatSchema.parse({
    goalId: allowedGoal.goalId,
    name: allowedGoal.label,
    category: allowedGoal.category,
    direction: allowedGoal.direction,
    reaches: totals[0] ?? 0,
    visits: totals[1] ?? 0,
    users: totals[2] ?? 0,
    conversionRate: totals[3] ?? null,
  });
}

function dimensionValue(row: Record<string, unknown>, index: number) {
  const dimension = getArray(row.dimensions).map(getRecord)[index] ?? null;
  return {
    id: getString(dimension, "id") ?? getString(dimension, "name") ?? "unknown",
    name: getString(dimension, "name") ?? getString(dimension, "id") ?? "Не определено",
  };
}

export function normalizeOrganicEngineRows(
  reportPayload: unknown,
  targetVisits: Partial<Record<"YANDEX" | "GOOGLE", number>>,
): MetricaOrganicEngineRow[] {
  const root = getRecord(reportPayload);
  return getArray(root?.data).map(getRecord).filter((row): row is Record<string, unknown> => row !== null).flatMap((row) => {
    const label = dimensionValue(row, 0).name.toLocaleLowerCase("ru-RU");
    const engine = label.includes("yandex") || label.includes("яндекс") ? "YANDEX" : label.includes("google") ? "GOOGLE" : null;
    if (!engine) return [];
    const metrics = normalizeRowMetrics(row);
    const visits = metrics[0] ?? 0;
    const uniqueTargetVisits = targetVisits[engine] ?? 0;
    return [metricaOrganicEngineRowSchema.parse({ engine, visits, users: metrics[1] ?? 0, goalReaches: sumGoalReaches(metrics, 2), uniqueTargetVisits, conversionRate: visits > 0 ? Number(((uniqueTargetVisits / visits) * 100).toFixed(2)) : null })];
  });
}

export function normalizeSearchPhrases(
  engine: "YANDEX" | "GOOGLE",
  reportPayload: unknown,
  targetPayload: unknown,
): MetricaSearchPhraseRow[] {
  const targetRoot = getRecord(targetPayload);
  const targets = new Map(getArray(targetRoot?.data).map(getRecord).filter((row): row is Record<string, unknown> => row !== null).map((row) => [dimensionValue(row, 0).name, normalizeRowMetrics(row)[0] ?? 0]));
  const root = getRecord(reportPayload);
  return getArray(root?.data).map(getRecord).filter((row): row is Record<string, unknown> => row !== null).map((row) => {
    const phrase = dimensionValue(row, 0).name;
    const metrics = normalizeRowMetrics(row);
    return metricaSearchPhraseRowSchema.parse({ engine, phrase, visits: metrics[0] ?? 0, users: metrics[1] ?? 0, goalReaches: sumGoalReaches(metrics, 2), uniqueTargetVisits: targets.get(phrase) ?? 0 });
  });
}

export function normalizeGeography(reportPayload: unknown, targetPayload: unknown): MetricaGeoRow[] {
  const keyFor = (row: Record<string, unknown>) => getArray(row.dimensions).map(getRecord).map((_, index) => dimensionValue(row, index).id).join("/");
  const targetRoot = getRecord(targetPayload);
  const targets = new Map(getArray(targetRoot?.data).map(getRecord).filter((row): row is Record<string, unknown> => row !== null).map((row) => [keyFor(row), normalizeRowMetrics(row)[0] ?? 0]));
  const root = getRecord(reportPayload);
  return getArray(root?.data).map(getRecord).filter((row): row is Record<string, unknown> => row !== null).map((row) => {
    const dimensions = getArray(row.dimensions).map(getRecord).map((_, index) => dimensionValue(row, index));
    const region = [...dimensions].reverse().find((item) => item.id !== "unknown") ?? { id: "unknown", name: "Не определено" };
    const metrics = normalizeRowMetrics(row);
    return metricaGeoRowSchema.parse({ regionKey: region.id, regionName: region.name, visits: metrics[0] ?? 0, users: metrics[1] ?? 0, goalReaches: sumGoalReaches(metrics, 2), uniqueTargetVisits: targets.get(keyFor(row)) ?? 0 });
  });
}

export function buildMetricaPreflight(args: {
  checkedAt: string;
  access: MetricaCounterAccess;
  goals: MetricaGoal[];
}) {
  return metricaPreflightSchema.parse({
    schemaVersion: 1,
    checkedAt: args.checkedAt,
    access: args.access,
    goals: args.goals,
  });
}

export function buildMetricaSiteAudit(args: {
  fetchedAt: string;
  access: MetricaCounterAccess;
  goals: MetricaGoal[];
  allowedGoals: MetricaAllowedGoal[];
  allTrafficMeta: MetricaSampleMeta;
  allTrafficSummary: MetricaSummary;
  organicMeta: MetricaSampleMeta;
  organicSummary: MetricaSummary;
  targetVisits: number;
  targetUsers: number;
  byTime: MetricaTrendPoint[];
  landingPages: MetricaLandingPage[];
  devices: MetricaDeviceRow[];
  goalsMeta: MetricaSampleMeta;
  goalsSummary: MetricaGoalStat[];
  organicEngines?: MetricaOrganicEngineRow[];
  searchPhrases?: MetricaSearchPhraseRow[];
  geography?: MetricaGeoRow[];
}) {
  return metricaSiteAuditSchema.parse({
    schemaVersion: 2,
    fetchedAt: args.fetchedAt,
    access: args.access,
    goals: args.goals,
    allowedGoals: args.allowedGoals,
    allTraffic: {
      meta: args.allTrafficMeta,
      summary: args.allTrafficSummary,
    },
    yandexOrganic: {
      meta: args.organicMeta,
      summary: {
        ...args.organicSummary,
        targetVisits: args.targetVisits,
        targetUsers: args.targetUsers,
        conversionRate:
          args.organicSummary.visits > 0
            ? Number(((args.targetVisits / args.organicSummary.visits) * 100).toFixed(2))
            : null,
      },
      byTime: args.byTime,
      landingPages: args.landingPages,
      devices: args.devices,
    },
    goalsSummary: {
      meta: args.goalsMeta,
      items: args.goalsSummary,
    },
    organicEngines: args.organicEngines ?? [],
    searchPhrases: args.searchPhrases ?? [],
    geography: args.geography ?? [],
  });
}
