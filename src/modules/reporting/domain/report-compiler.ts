import {
  siteReportSnapshotSchema,
  type CombinedSeoReport,
  type MetricaReport,
  type ReportComparison,
  type ReportPeriodKey,
  type SiteReportSnapshot,
  type WebmasterReport,
  type RankingMovement,
  type TrackedRankingReport,
} from "../../../shared/schemas/report.ts";
import type {
  ClusterProfile,
  SiteRegistry,
} from "../../../shared/schemas/registry.ts";
import type { MetricaSiteAudit } from "../../../shared/schemas/metrica-source.ts";
import type { WebmasterSiteData } from "../../../shared/schemas/webmaster-source.ts";
import type { TopvisorSiteData } from "../../../shared/schemas/rank-source.ts";
import type { TrackedQuerySet } from "../../../shared/schemas/tracked-query.ts";
import {
  buildQueryOpportunities,
  mergeWebmasterQueryCollections,
  type MergedWebmasterQuery,
} from "../../ranking-analytics/index.ts";

export type SafeSourceFailure = {
  code: string;
  status: number | null;
};

type CompileSiteReportArgs = {
  clientSlug: string;
  site: SiteRegistry;
  generatedAt: string;
  webmasterData: WebmasterSiteData | null;
  metricaData: MetricaSiteAudit | null;
  clusterProfile: ClusterProfile;
  previousWebmasterData?: WebmasterSiteData | null;
  previousMetricaData?: MetricaSiteAudit | null;
  periodKey?: ReportPeriodKey;
  currentPeriod?: { dateFrom: string; dateTo: string };
  previousPeriod?: { dateFrom: string; dateTo: string };
  webmasterFailure?: SafeSourceFailure | null;
  metricaFailure?: SafeSourceFailure | null;
  previous?: SiteReportSnapshot | null;
  queryThresholds: {
    minimumShows: number;
    maximumCtrPercent: number;
    maximumAveragePosition: number;
  };
  trackedQuerySet?: TrackedQuerySet | null;
  rankingData?: TopvisorSiteData | null;
  topvisorFailure?: SafeSourceFailure | null;
};

function latestHistoryValue(
  histories: Array<{ points: Array<{ date: string; value: number }> }>,
) {
  return histories.reduce((sum, history) => sum + (history.points.at(-1)?.value ?? 0), 0);
}

function normalizeQueryKey(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function calculatePercentDelta(current: number, previous: number) {
  if (previous === 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(2));
}

function compileWebmasterHealth(
  data: WebmasterSiteData,
): NonNullable<WebmasterReport["health"]> {
  const presentDiagnostics = data.diagnostics.filter(
    (diagnostic) => diagnostic.state === "PRESENT",
  );
  const countSeverity = (severity: string) =>
    presentDiagnostics.filter((diagnostic) => diagnostic.severity === severity).length;
  const latestByIndicator = (indicator: string) =>
    data.indexingHistory
      .find((history) => history.indicator === indicator)
      ?.points.at(-1)?.value ?? 0;
  const sumSearchEvents = (indicator: string) =>
    data.searchEventsHistory
      .find((history) => history.indicator === indicator)
      ?.points.reduce((sum, point) => sum + point.value, 0) ?? 0;
  const sitemap = data.sitemaps.find((item) => item.url !== null) ?? null;
  const fatalCount = countSeverity("FATAL");
  const criticalCount = countSeverity("CRITICAL");
  const possibleProblemCount = countSeverity("POSSIBLE_PROBLEM");
  const recommendationCount = countSeverity("RECOMMENDATION");
  const appearedInSearch = sumSearchEvents("APPEARED_IN_SEARCH");
  const removedFromSearch = sumSearchEvents("REMOVED_FROM_SEARCH");
  const http4xx = latestByIndicator("HTTP_4XX");
  const http5xx = latestByIndicator("HTTP_5XX");
  const sitemapErrors = sitemap?.errorsCount ?? 0;
  const status =
    fatalCount > 0 || criticalCount > 0 || http5xx > 0
      ? "critical"
      : possibleProblemCount > 0 ||
          sitemapErrors > 0 ||
          http4xx > 0 ||
          (removedFromSearch - appearedInSearch >= 10 &&
            removedFromSearch > appearedInSearch)
        ? "attention"
        : "stable";
  const currentSqi = data.sqiHistory.at(-1)?.value ?? data.summary.sqi;
  const previousSqi = data.sqiHistory.at(-2)?.value ?? null;

  return {
    status,
    fatalCount,
    criticalCount,
    possibleProblemCount,
    recommendationCount,
    sitemapUrls: sitemap?.urlsTotal ?? 0,
    sitemapErrors,
    pagesInSearch:
      data.pagesInSearchHistory.at(-1)?.value ?? data.summary.searchablePages ?? 0,
    excludedPages: data.summary.excludedPages ?? 0,
    appearedInSearch,
    removedFromSearch,
    searchBalance: appearedInSearch - removedFromSearch,
    http2xx: latestByIndicator("HTTP_2XX"),
    http3xx: latestByIndicator("HTTP_3XX"),
    http4xx,
    http5xx,
    otherHttp: latestByIndicator("OTHER"),
    sqi: currentSqi,
    previousSqi,
    sqiDelta:
      currentSqi !== null && previousSqi !== null ? currentSqi - previousSqi : null,
  };
}

function compileTrackedCore(args: {
  trackedQuerySet: TrackedQuerySet;
  currentQueries: MergedWebmasterQuery[];
  previousQueries: MergedWebmasterQuery[];
  clusterProfile: ClusterProfile;
  opportunityTypes: Map<string, string[]>;
}): NonNullable<WebmasterReport["trackedCore"]> {
  const currentAll = args.currentQueries.filter((query) => query.device === "ALL");
  const previousAll = args.previousQueries.filter((query) => query.device === "ALL");
  const currentByText = new Map(
    currentAll.map((query) => [normalizeQueryKey(query.queryText), query]),
  );
  const previousByText = new Map(
    previousAll.map((query) => [normalizeQueryKey(query.queryText), query]),
  );

  const queries = args.trackedQuerySet.queries.map((trackedQuery) => {
    const key = normalizeQueryKey(trackedQuery.query);
    const current = currentByText.get(key) ?? null;
    const previous = previousByText.get(key) ?? null;
    const currentCtr = current?.ctrPercent ?? null;
    const previousCtr = previous?.ctrPercent ?? null;
    const labels = current
      ? args.opportunityTypes.get(`${current.queryId}::${current.device}`) ?? []
      : [];

    return {
      query: trackedQuery.query,
      cluster: classifyQuery(trackedQuery.query, args.clusterProfile),
      observedInWebmaster: current !== null,
      shows: current?.shows ?? null,
      clicks: current?.clicks ?? null,
      ctr: currentCtr,
      avgShowPosition: current?.avgShowPosition ?? null,
      previousShows: previous?.shows ?? null,
      previousClicks: previous?.clicks ?? null,
      previousAvgShowPosition: previous?.avgShowPosition ?? null,
      deltaClicksPercent:
        current && previous
          ? calculatePercentDelta(current.clicks, previous.clicks)
          : null,
      deltaCtrPoints:
        currentCtr !== null && previousCtr !== null
          ? Number((currentCtr - previousCtr).toFixed(2))
          : null,
      deltaPosition:
        current?.avgShowPosition !== null &&
        current?.avgShowPosition !== undefined &&
        previous?.avgShowPosition !== null &&
        previous?.avgShowPosition !== undefined
          ? Number(
              (previous.avgShowPosition - current.avgShowPosition).toFixed(2),
            )
          : null,
      ownerPosition: trackedQuery.position.current,
      ownerBaselinePosition: trackedQuery.position.baseline,
      ownerPositionDelta: trackedQuery.position.delta,
      opportunityType:
        labels.length > 0
          ? labels.join(", ")
          : current
            ? "наблюдение"
            : "не найден в наблюдаемом пуле",
    };
  });
  const measuredPositions = queries
    .map((query) => query.avgShowPosition)
    .filter((position): position is number => position !== null);
  const observedCount = queries.filter((query) => query.observedInWebmaster).length;

  return {
    expectedCount: args.trackedQuerySet.expectedCount,
    observedCount,
    coveragePercent: Number(
      ((observedCount / args.trackedQuerySet.expectedCount) * 100).toFixed(1),
    ),
    top3Count: measuredPositions.filter((position) => position <= 3).length,
    top10Count: measuredPositions.filter((position) => position <= 10).length,
    top20Count: measuredPositions.filter(
      (position) => position > 10 && position <= 20,
    ).length,
    below20Count: measuredPositions.filter((position) => position > 20).length,
    unmeasuredCount: queries.length - measuredPositions.length,
    baselineLabel: args.trackedQuerySet.baselineLabel,
    queries,
  };
}

function movementForPositions(args: {
  current: number | null;
  previous: number | null;
  exactSnapshots: boolean;
}): RankingMovement {
  if (args.current !== null && args.previous !== null) {
    if (args.current < args.previous) return "improved";
    if (args.current > args.previous) return "declined";
    return "unchanged";
  }
  if (args.exactSnapshots && args.current !== null) return "new";
  if (args.exactSnapshots && args.previous !== null) return "lost";
  return "unmeasured";
}

function positionShare(count: number, total: number) {
  return Number(((count / total) * 100).toFixed(1));
}

function compileTrackedRanking(args: {
  trackedQuerySet: TrackedQuerySet;
  rankingData: TopvisorSiteData | null;
  currentPeriod?: { dateFrom: string; dateTo: string };
  webmaster: WebmasterReport | null;
  clusterProfile: ClusterProfile;
}): TrackedRankingReport {
  const periodSnapshots = args.rankingData?.snapshots
    .filter(
      (snapshot) =>
        (snapshot.engine === undefined || (snapshot.engine === "YANDEX" && snapshot.device === "DESKTOP")) &&
        (!args.currentPeriod ||
          (snapshot.capturedAt >= args.currentPeriod.dateFrom &&
            snapshot.capturedAt <= args.currentPeriod.dateTo)),
    )
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt)) ?? [];
  const exactSnapshots = periodSnapshots.length > 0;
  const currentSnapshot = periodSnapshots.at(-1) ?? null;
  const previousSnapshot = periodSnapshots[0] ?? null;
  const snapshotMap = (snapshot: typeof currentSnapshot) =>
    new Map(
      snapshot?.queries.map((query) => [
        normalizeQueryKey(query.query),
        query.position,
      ]) ?? [],
    );
  const currentPositions = snapshotMap(currentSnapshot);
  const previousPositions = snapshotMap(previousSnapshot);
  const webmasterQueries = new Map(
    (args.webmaster?.trackedCore?.queries ?? []).map((query) => [
      normalizeQueryKey(query.query),
      query,
    ]),
  );

  const queries = args.trackedQuerySet.queries.map((tracked) => {
    const key = normalizeQueryKey(tracked.query);
    const webmasterQuery = webmasterQueries.get(key);
    const current = exactSnapshots
      ? currentPositions.get(key) ?? null
      : tracked.position.current;
    const previous = exactSnapshots
      ? previousPositions.get(key) ?? null
      : tracked.position.baseline;
    const movement = movementForPositions({
      current,
      previous,
      exactSnapshots,
    });

    return {
      query: tracked.query,
      cluster: classifyQuery(tracked.query, args.clusterProfile),
      currentPosition: current,
      previousPosition: previous,
      positionDelta:
        current !== null && previous !== null ? previous - current : null,
      movement,
      shows: webmasterQuery?.shows ?? null,
      clicks: webmasterQuery?.clicks ?? null,
      ctr: webmasterQuery?.ctr ?? null,
    };
  });
  const currentMeasured = queries
    .map((query) => query.currentPosition)
    .filter((position): position is number => position !== null);
  const previousMeasured = queries
    .map((query) => query.previousPosition)
    .filter((position): position is number => position !== null);
  const top3Count = currentMeasured.filter((position) => position <= 3).length;
  const top10Count = currentMeasured.filter((position) => position <= 10).length;
  const previousTop3 = previousMeasured.filter((position) => position <= 3).length;
  const previousTop10 = previousMeasured.filter((position) => position <= 10).length;
  const queryCount = args.trackedQuerySet.expectedCount;
  const history = periodSnapshots.map((snapshot) => {
    const positions = snapshot.queries
      .map((query) => query.position)
      .filter((position): position is number => position !== null);
    const pointTop3 = positions.filter((position) => position <= 3).length;
    const pointTop10 = positions.filter((position) => position <= 10).length;
    return {
      date: snapshot.capturedAt,
      top3Count: pointTop3,
      top10Count: pointTop10,
      top3Share: positionShare(pointTop3, queryCount),
      top10Share: positionShare(pointTop10, queryCount),
    };
  });
  const countMovement = (movement: RankingMovement) =>
    queries.filter((query) => query.movement === movement).length;

  return {
    source: exactSnapshots ? "topvisor" : "owner-provided",
    queryCount,
    measuredCount: currentMeasured.length,
    top3Count,
    top10Count,
    top3Share: positionShare(top3Count, queryCount),
    top10Share: positionShare(top10Count, queryCount),
    top3Delta: top3Count - previousTop3,
    top10Delta: top10Count - previousTop10,
    improvedCount: countMovement("improved"),
    declinedCount: countMovement("declined"),
    unchangedCount: countMovement("unchanged"),
    newCount: countMovement("new"),
    lostCount: countMovement("lost"),
    unmeasuredCount: countMovement("unmeasured"),
    baselineLabel: exactSnapshots
      ? previousSnapshot?.capturedAt ?? args.trackedQuerySet.baselineLabel
      : args.trackedQuerySet.baselineLabel,
    lastCapturedAt: currentSnapshot?.capturedAt ?? null,
    history,
    queries,
  };
}

function classifyQuery(query: string, profile: ClusterProfile) {
  const normalized = query.toLocaleLowerCase("ru");
  const brandGroup = profile.groups.find((group) => group.slug === "brand");
  if (profile.brandTerms.some((term) => normalized.includes(term.toLocaleLowerCase("ru")))) {
    return brandGroup?.label ?? "Бренд";
  }

  for (const group of profile.groups) {
    if (group.slug === "brand") continue;
    if (group.terms.some((term) => normalized.includes(term.toLocaleLowerCase("ru")))) {
      return group.label;
    }
  }

  return "Другое";
}

function compileWebmasterReport(
  data: WebmasterSiteData,
  thresholds: CompileSiteReportArgs["queryThresholds"],
  clusterProfile: ClusterProfile,
  previousData: WebmasterSiteData | null = null,
  trackedQuerySet: TrackedQuerySet | null = null,
): WebmasterReport {
  const mergedQueries = mergeWebmasterQueryCollections(data.queryCollections);
  const previousQueries = previousData
    ? mergeWebmasterQueryCollections(previousData.queryCollections)
    : [];
  const previousByIdAndDevice = new Map(
    previousQueries.map((query) => [
      `${query.queryId}::${query.device}`,
      query,
    ]),
  );
  const opportunities = buildQueryOpportunities(mergedQueries, thresholds);
  const opportunityTypes = new Map<string, string[]>();

  for (const opportunity of opportunities) {
    const key = `${opportunity.queryId}::${opportunity.device}`;
    const labels = opportunityTypes.get(key) ?? [];
    const labelByType = {
      high_impressions_low_ctr: "много показов, мало переходов",
      positions_4_10: "позиции 4–10",
      positions_11_20: "позиции 11–20",
      zero_clicks: "нет кликов",
    } as const;
    labels.push(labelByType[opportunity.type]);
    opportunityTypes.set(key, labels);
  }

  const allDeviceQueries = mergedQueries.filter((query) => query.device === "ALL");
  const poolShows = allDeviceQueries.reduce((sum, query) => sum + query.shows, 0);
  const poolClicks = allDeviceQueries.reduce((sum, query) => sum + query.clicks, 0);
  const historyByIndicator = new Map(
    data.allQueryHistory.map((history) => [history.indicator, history.points]),
  );
  const showHistory = historyByIndicator.get("TOTAL_SHOWS") ?? [];
  const clickHistoryByDate = new Map(
    (historyByIndicator.get("TOTAL_CLICKS") ?? []).map((point) => [
      point.date.slice(0, 10),
      point.value,
    ]),
  );
  const positionHistoryByDate = new Map(
    (historyByIndicator.get("AVG_SHOW_POSITION") ?? []).map((point) => [
      point.date.slice(0, 10),
      point.value,
    ]),
  );
  const shows =
    showHistory.length > 0
      ? showHistory.reduce((sum, point) => sum + point.value, 0)
      : poolShows;
  const clicks =
    showHistory.length > 0
      ? [...clickHistoryByDate.values()].reduce((sum, value) => sum + value, 0)
      : poolClicks;
  const weightedPositionNumerator =
    showHistory.length > 0
      ? showHistory.reduce((sum, point) => {
          const date = point.date.slice(0, 10);
          return sum + (positionHistoryByDate.get(date) ?? 0) * point.value;
        }, 0)
      : allDeviceQueries.reduce(
          (sum, query) => sum + (query.avgShowPosition ?? 0) * query.shows,
          0,
        );
  const weightedPositionDenominator =
    showHistory.length > 0
      ? showHistory.reduce((sum, point) => {
          const date = point.date.slice(0, 10);
          return sum + (positionHistoryByDate.has(date) ? point.value : 0);
        }, 0)
      : allDeviceQueries.reduce(
          (sum, query) => sum + (query.avgShowPosition === null ? 0 : query.shows),
          0,
        );
  const allCollection = data.queryCollections.find(
    (collection) => collection.device === "ALL" && collection.orderBy === "TOTAL_SHOWS",
  );
  const trendDate = allCollection?.dateTo ?? data.fetchedAt.slice(0, 10);
  const visibilityTrend =
    showHistory.length > 0
      ? showHistory.map((point) => {
          const date = point.date.slice(0, 10);
          return {
            label: date,
            date,
            value: point.value,
            secondaryValue: clickHistoryByDate.get(date) ?? null,
            tertiaryValue: positionHistoryByDate.get(date) ?? null,
          };
        })
      : [
          {
            label: trendDate,
            date: trendDate,
            value: shows,
            secondaryValue: clicks,
            tertiaryValue:
              weightedPositionDenominator > 0
                ? Number((weightedPositionNumerator / weightedPositionDenominator).toFixed(2))
                : null,
          },
        ];
  const sitemap = data.sitemaps.find((item) => item.url !== null) ?? null;
  const reportQueries = mergedQueries.slice(0, 500).map((query) => {
    const previous = previousByIdAndDevice.get(
      `${query.queryId}::${query.device}`,
    );
    const currentCtr = query.ctrPercent ?? 0;
    const previousCtr = previous?.ctrPercent ?? null;

    return {
      queryId: query.queryId,
      query: query.queryText,
      cluster: classifyQuery(query.queryText, clusterProfile),
      device:
        query.device === "MOBILE_AND_TABLET" || query.device === "TABLET"
          ? ("MOBILE" as const)
          : query.device,
      shows: query.shows,
      clicks: query.clicks,
      ctr: currentCtr,
      avgShowPosition: query.avgShowPosition ?? 0,
      avgClickPosition: query.avgClickPosition,
      previousShows: previous?.shows ?? null,
      previousClicks: previous?.clicks ?? null,
      deltaClicksPercent: previous
        ? calculatePercentDelta(query.clicks, previous.clicks)
        : null,
      deltaCtrPoints:
        previousCtr !== null
          ? Number((currentCtr - previousCtr).toFixed(2))
          : null,
      opportunityType:
        opportunityTypes.get(`${query.queryId}::${query.device}`)?.join(", ") ??
        "наблюдение",
    };
  });
  const trackedCore = trackedQuerySet
    ? compileTrackedCore({
        trackedQuerySet,
        currentQueries: mergedQueries,
        previousQueries,
        clusterProfile,
        opportunityTypes,
      })
    : null;
  const trackedKeys = new Set(
    trackedQuerySet?.queries.map((query) => normalizeQueryKey(query.query)) ?? [],
  );
  const observedOutsideCore = trackedQuerySet
    ? reportQueries
        .filter(
          (query) =>
            query.device === "ALL" &&
            !trackedKeys.has(normalizeQueryKey(query.query)),
        )
        .slice(0, 100)
    : [];

  return {
    summary: {
      shows,
      clicks,
      ctr: shows > 0 ? Number(((clicks / shows) * 100).toFixed(2)) : 0,
      avgPosition:
        weightedPositionDenominator > 0
          ? Number((weightedPositionNumerator / weightedPositionDenominator).toFixed(2))
          : null,
      pagesInSearch:
        data.pagesInSearchHistory.at(-1)?.value ?? data.summary.searchablePages ?? 0,
      excludedPages: data.summary.excludedPages ?? 0,
      sitemapUrls: sitemap?.urlsTotal ?? 0,
      sqi: data.summary.sqi,
    },
    visibilityTrend,
    queries: reportQueries,
    diagnostics: data.diagnostics
      .filter((diagnostic) => diagnostic.state === "PRESENT")
      .map((diagnostic) => ({
        severity:
          diagnostic.severity === "FATAL" || diagnostic.severity === "CRITICAL"
            ? "error"
            : diagnostic.severity === "POSSIBLE_PROBLEM"
              ? "warning"
              : "info",
        title: diagnostic.code,
        description: `Состояние: ${diagnostic.state}. Обновлено: ${diagnostic.lastStateUpdate ?? "нет даты"}.`,
      })),
    sitemap: sitemap?.url
      ? {
          url: sitemap.url,
          urls: sitemap.urlsTotal ?? 0,
          errors: sitemap.errorsCount ?? 0,
        }
      : null,
    links: {
      external: latestHistoryValue(data.externalLinksHistory),
      brokenInternal: latestHistoryValue(data.brokenInternalLinksHistory),
    },
    health: compileWebmasterHealth(data),
    trackedCore,
    observedOutsideCore,
  };
}

function compileMetricaReport(data: MetricaSiteAudit): MetricaReport {
  return {
    summary: {
      visits: data.yandexOrganic.summary.visits,
      users: data.yandexOrganic.summary.users,
      pageviews: data.yandexOrganic.summary.pageviews,
      bounceRate: data.yandexOrganic.summary.bounceRate,
      depth: data.yandexOrganic.summary.pageDepth,
      averageVisitDurationSeconds: data.yandexOrganic.summary.averageVisitDurationSeconds,
      goalReaches: data.yandexOrganic.summary.goalReaches,
      targetVisits: data.yandexOrganic.summary.targetVisits,
      targetUsers: data.yandexOrganic.summary.targetUsers,
      allVisits: data.allTraffic.summary.visits,
      conversionRate: data.yandexOrganic.summary.conversionRate,
    },
    organicTrend: data.yandexOrganic.byTime.map((point) => ({
      label: point.date,
      date: point.date,
      value: point.visits,
      secondaryValue: point.targetVisits,
      tertiaryValue: point.conversionRate,
    })),
    landingPages: data.yandexOrganic.landingPages.map((page) => ({
      path: page.path,
      visits: page.visits,
      users: page.users,
      pageviews: page.pageviews,
      bounceRate: page.bounceRate,
      depth: page.pageDepth,
      durationSeconds: page.averageVisitDurationSeconds,
      goals: page.goalReaches,
      targetVisits: page.targetVisits,
      conversionRate: page.conversionRate,
      trendLabel: "Без сравнения с предыдущим периодом",
    })),
    devices: data.yandexOrganic.devices.map((device) => ({
      device: device.device,
      visits: device.visits,
      conversionRate: device.conversionRate,
    })),
    goals: data.goalsSummary.items.map((goal) => ({
      label: goal.name,
      category: goal.category,
      reaches: goal.reaches,
      conversionRate: goal.conversionRate,
    })),
  };
}

function sourceStatus(
  enabled: boolean,
  hasData: boolean,
  partial: boolean,
  failure?: SafeSourceFailure | null,
) {
  if (!enabled) return "not_configured" as const;
  if (hasData && (partial || failure)) return "partial" as const;
  if (hasData) return "success" as const;
  if (failure?.status === 401 || failure?.status === 403) return "access_denied" as const;
  if (failure?.status === 420 || failure?.status === 429) return "quota_limited" as const;
  return "failed" as const;
}

function compileCombinedReport(args: {
  webmaster: WebmasterReport | null;
  metrica: MetricaReport | null;
  webmasterData: WebmasterSiteData | null;
  webmasterFailure?: SafeSourceFailure | null;
  metricaFailure?: SafeSourceFailure | null;
  comparison: ReportComparison | null;
}): CombinedSeoReport {
  const alerts: CombinedSeoReport["alerts"] = [];
  const opportunities: CombinedSeoReport["opportunities"] = [];

  for (const diagnostic of args.webmaster?.diagnostics ?? []) {
    if (diagnostic.severity !== "error") continue;
    alerts.push({
      id: `webmaster-${diagnostic.title}`,
      title: diagnostic.title,
      summary: diagnostic.description,
      tone: "error",
    });
  }

  const health = args.webmaster?.health;
  if (
    health?.status === "critical" &&
    !alerts.some((alert) => alert.id === "webmaster-health-critical")
  ) {
    alerts.push({
      id: "webmaster-health-critical",
      title: "Сайт требует внимания",
      summary: `Ошибок сервера: ${health.http5xx}; серьёзных проблем: ${health.fatalCount + health.criticalCount}; ошибок карты сайта: ${health.sitemapErrors}.`,
      tone: "error",
    });
  }

  if (args.webmasterFailure) {
    alerts.push({
      id: "webmaster-source-failure",
      title: "Яндекс.Вебмастер недоступен",
      summary: "Источник временно не отвечает. Повторите обновление позже.",
      tone: "error",
    });
  }
  if (args.metricaFailure) {
    alerts.push({
      id: "metrica-source-failure",
      title: "Яндекс.Метрика недоступна",
      summary: "Источник временно не отвечает. Повторите обновление позже.",
      tone: "error",
    });
  }

  const comparison = args.comparison?.metrics;
  const trendAlerts = [
    {
      active:
        (comparison?.clicks.previous ?? 0) >= 10 &&
        (comparison?.clicks.deltaPercent ?? 0) <= -30,
      id: "clicks-decline",
      title: "Снижение кликов из поиска",
      summary: `Клики снизились на ${Math.abs(comparison?.clicks.deltaPercent ?? 0).toFixed(1)}%.`,
    },
    {
      active:
        (comparison?.shows.previous ?? 0) >= 100 &&
        (comparison?.shows.deltaPercent ?? 0) <= -30,
      id: "shows-decline",
      title: "Снижение показов в поиске",
      summary: `Показы снизились на ${Math.abs(comparison?.shows.deltaPercent ?? 0).toFixed(1)}%.`,
    },
    {
      active:
        (comparison?.organicVisits.previous ?? 0) >= 20 &&
        (comparison?.organicVisits.deltaPercent ?? 0) <= -30,
      id: "organic-decline",
      title: "Снижение органического трафика",
      summary: `Органические визиты снизились на ${Math.abs(comparison?.organicVisits.deltaPercent ?? 0).toFixed(1)}%.`,
    },
    {
      active:
        (comparison?.pagesInSearch.previous ?? 0) >= 10 &&
        (comparison?.pagesInSearch.deltaPercent ?? 0) <= -10,
      id: "pages-decline",
      title: "Снижение числа страниц в поиске",
      summary: `Страниц в поиске стало меньше на ${Math.abs(comparison?.pagesInSearch.deltaPercent ?? 0).toFixed(1)}%.`,
    },
    {
      active:
        (comparison?.shows.previous ?? 0) >= 100 &&
        (comparison?.avgPosition.deltaPoints ?? 0) <= -2,
      id: "position-decline",
      title: "Ухудшение средней позиции",
      summary: `Средняя позиция ухудшилась на ${Math.abs(comparison?.avgPosition.deltaPoints ?? 0).toFixed(1)}.`,
    },
  ];
  for (const alert of trendAlerts) {
    if (!alert.active) continue;
    alerts.push({
      id: alert.id,
      title: alert.title,
      summary: alert.summary,
      tone: "warning",
    });
  }

  const mergedQueries = args.webmasterData
    ? mergeWebmasterQueryCollections(args.webmasterData.queryCollections)
    : [];
  for (const query of mergedQueries
    .filter(
      (item) =>
        item.device === "ALL" &&
        item.avgShowPosition !== null &&
        item.avgShowPosition >= 4 &&
        item.avgShowPosition <= 10,
    )
    .slice(0, 3)) {
    opportunities.push({
      id: `query-${query.queryId}`,
      title: query.queryText,
      summary: `${query.shows} показов, кликабельность ${(query.ctrPercent ?? 0).toFixed(2)}%, позиция ${(query.avgShowPosition ?? 0).toFixed(1)}.`,
      source: "webmaster",
      tone: "info",
    });
  }

  return {
    funnel: {
      shows: args.webmaster?.summary.shows ?? 0,
      clicks: args.webmaster?.summary.clicks ?? 0,
      visits: args.metrica?.summary.visits ?? 0,
      goalReaches: args.metrica?.summary.goalReaches ?? 0,
      caveats: [
        "Клики Вебмастера и визиты Метрики считаются разными системами и не совпадают один к одному.",
        "Сумма достижений целей не является числом уникальных заявок.",
      ],
    },
    opportunities,
    alerts,
    methodology: [
      "Вебмастер показывает наблюдаемую поисковую видимость, а не частотность Wordstat.",
      "Метрика показывает агрегированный трафик из поиска Яндекса без пользовательских данных.",
      "Связь конкретный запрос → конкретная заявка не утверждается.",
    ],
  };
}

function buildMetricComparison(
  current: number | null,
  previous: number | null,
  mode: "percent" | "points" | "position",
) {
  const deltaPercent =
    mode === "percent" && current !== null && previous !== null && previous !== 0
      ? Number((((current - previous) / previous) * 100).toFixed(2))
      : null;
  const deltaPoints =
    mode === "points" && current !== null && previous !== null
      ? Number((current - previous).toFixed(2))
      : mode === "position" && current !== null && previous !== null
        ? Number((previous - current).toFixed(2))
        : null;

  return {
    current,
    previous,
    deltaPercent,
    deltaPoints,
  };
}

function buildReportComparison(args: {
  periodKey: ReportPeriodKey;
  currentPeriod?: { dateFrom: string; dateTo: string };
  previousPeriod?: { dateFrom: string; dateTo: string };
  currentWebmaster: WebmasterReport | null;
  previousWebmaster: WebmasterReport | null;
  currentMetrica: MetricaReport | null;
  previousMetrica: MetricaReport | null;
}): ReportComparison | null {
  if (!args.currentPeriod || !args.previousPeriod) {
    return null;
  }

  const currentOrganicShare =
    args.currentMetrica && args.currentMetrica.summary.allVisits > 0
      ? (args.currentMetrica.summary.visits / args.currentMetrica.summary.allVisits) * 100
      : null;
  const previousOrganicShare =
    args.previousMetrica && args.previousMetrica.summary.allVisits > 0
      ? (args.previousMetrica.summary.visits / args.previousMetrica.summary.allVisits) * 100
      : null;

  return {
    periodKey: args.periodKey,
    currentPeriod: args.currentPeriod,
    previousPeriod: args.previousPeriod,
    metrics: {
      shows: buildMetricComparison(
        args.currentWebmaster?.summary.shows ?? null,
        args.previousWebmaster?.summary.shows ?? null,
        "percent",
      ),
      clicks: buildMetricComparison(
        args.currentWebmaster?.summary.clicks ?? null,
        args.previousWebmaster?.summary.clicks ?? null,
        "percent",
      ),
      ctr: buildMetricComparison(
        args.currentWebmaster?.summary.ctr ?? null,
        args.previousWebmaster?.summary.ctr ?? null,
        "points",
      ),
      avgPosition: buildMetricComparison(
        args.currentWebmaster?.summary.avgPosition ?? null,
        args.previousWebmaster?.summary.avgPosition ?? null,
        "position",
      ),
      organicVisits: buildMetricComparison(
        args.currentMetrica?.summary.visits ?? null,
        args.previousMetrica?.summary.visits ?? null,
        "percent",
      ),
      targetVisits: buildMetricComparison(
        args.currentMetrica?.summary.targetVisits ?? null,
        args.previousMetrica?.summary.targetVisits ?? null,
        "percent",
      ),
      conversionRate: buildMetricComparison(
        args.currentMetrica?.summary.conversionRate ?? null,
        args.previousMetrica?.summary.conversionRate ?? null,
        "points",
      ),
      pagesInSearch: buildMetricComparison(
        args.currentWebmaster?.summary.pagesInSearch ?? null,
        args.previousWebmaster?.summary.pagesInSearch ?? null,
        "percent",
      ),
      organicShare: buildMetricComparison(
        currentOrganicShare,
        previousOrganicShare,
        "points",
      ),
    },
  };
}

export function compileSiteReportSnapshot(args: CompileSiteReportArgs): SiteReportSnapshot {
  const currentWebmaster = args.webmasterData
    ? compileWebmasterReport(
        args.webmasterData,
        args.queryThresholds,
        args.clusterProfile,
        args.previousWebmasterData ?? null,
        args.trackedQuerySet ?? null,
      )
    : null;
  const currentMetrica = args.metricaData ? compileMetricaReport(args.metricaData) : null;
  const previousWebmaster = args.previousWebmasterData
    ? compileWebmasterReport(
        args.previousWebmasterData,
        args.queryThresholds,
        args.clusterProfile,
      )
    : null;
  const previousMetrica = args.previousMetricaData
    ? compileMetricaReport(args.previousMetricaData)
    : null;
  const periodKey = args.periodKey ?? "month";
  const webmaster = currentWebmaster ?? args.previous?.webmaster ?? null;
  const metrica = currentMetrica ?? args.previous?.metrica ?? null;
  const webmasterStatus = sourceStatus(
    args.site.webmaster.enabled,
    args.webmasterData !== null,
    args.webmasterData?.partial ?? false,
    args.webmasterFailure,
  );
  const metricaStatus = sourceStatus(
    args.site.metrica.enabled,
    args.metricaData !== null,
    false,
    args.metricaFailure,
  );
  const topvisorStatus = sourceStatus(
    args.site.topvisor.enabled,
    (args.rankingData?.snapshots.length ?? 0) > 0,
    false,
    args.topvisorFailure,
  );
  const webmasterPeriod = args.webmasterData?.queryCollections[0] ?? null;
  const metricaPeriod = args.metricaData?.yandexOrganic.meta ?? null;
  const hasAnyReport = webmaster !== null || metrica !== null;
  const partial =
    webmasterStatus !== "success" ||
    metricaStatus !== "success" ||
    (args.site.topvisor.enabled && topvisorStatus !== "success");
  const ranking = args.trackedQuerySet
    ? compileTrackedRanking({
        trackedQuerySet: args.trackedQuerySet,
        rankingData: args.rankingData ?? null,
        currentPeriod: args.currentPeriod,
        webmaster,
        clusterProfile: args.clusterProfile,
      })
    : null;
  const comparison = buildReportComparison({
    periodKey,
    currentPeriod: args.currentPeriod,
    previousPeriod: args.previousPeriod,
    currentWebmaster,
    previousWebmaster,
    currentMetrica,
    previousMetrica,
  });

  return siteReportSnapshotSchema.parse({
    schemaVersion: 2,
    clientSlug: args.clientSlug,
    siteSlug: args.site.siteSlug,
    siteUrl: args.site.siteUrl,
    generatedAt: args.generatedAt,
    periodKey,
    comparison,
    freshness: hasAnyReport ? (partial ? "partial" : "fresh") : "unavailable",
    sources: {
      webmaster: {
        status: webmasterStatus,
        fetchedAt: args.webmasterData?.fetchedAt ?? args.previous?.sources.webmaster.fetchedAt ?? args.generatedAt,
        periodStart: args.currentPeriod?.dateFrom ?? webmasterPeriod?.dateFrom ?? null,
        periodEnd: args.currentPeriod?.dateTo ?? webmasterPeriod?.dateTo ?? null,
        timezone: args.site.timezone,
        note: args.webmasterData?.partial
          ? `${args.webmasterData.endpointErrors.length} endpoint errors`
          : null,
        safeErrorCode: args.webmasterFailure?.code ?? null,
      },
      metrica: {
        status: metricaStatus,
        fetchedAt: args.metricaData?.fetchedAt ?? args.previous?.sources.metrica.fetchedAt ?? args.generatedAt,
        periodStart: args.currentPeriod?.dateFrom ?? metricaPeriod?.date1 ?? null,
        periodEnd: args.currentPeriod?.dateTo ?? metricaPeriod?.date2 ?? null,
        timezone: args.site.timezone,
        note: metricaPeriod?.sampled ? "Отчёт построен с семплированием" : null,
        safeErrorCode: args.metricaFailure?.code ?? null,
      },
      topvisor: {
        status: topvisorStatus,
        fetchedAt:
          args.rankingData?.fetchedAt ??
          args.previous?.sources.topvisor?.fetchedAt ??
          args.generatedAt,
        periodStart: args.currentPeriod?.dateFrom ?? null,
        periodEnd: args.currentPeriod?.dateTo ?? null,
        timezone: args.site.timezone,
        note: args.site.topvisor.enabled
          ? null
          : ranking
            ? "Используется утверждённый исходный снимок позиций"
            : null,
        safeErrorCode: args.topvisorFailure?.code ?? null,
      },
    },
    webmaster,
    metrica,
    ranking,
    combined: compileCombinedReport({
      webmaster,
      metrica,
      webmasterData: args.webmasterData,
      comparison,
      webmasterFailure: args.webmasterFailure,
      metricaFailure: args.metricaFailure,
    }),
  });
}
