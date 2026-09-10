import {
  REPORT_PERIOD_KEYS,
  derivePeriodEndingOn,
  derivePreviousPeriod,
  type DatePeriod,
} from "../../reporting/index.ts";
import type { SiteSourceCollectors } from "./ports/provider-collectors.ts";
import type { SyncLogEvent, SyncLogger } from "./ports/sync-logger.ts";
import {
  compileSiteReportSnapshot,
  type SafeSourceFailure,
} from "../../reporting/index.ts";
import type { MetricaSiteAudit } from "../../../shared/schemas/metrica-source.ts";
import type { TopvisorSiteData } from "../../../shared/schemas/rank-source.ts";
import type { GoalProfile } from "../../../shared/schemas/registry.ts";
import type { ReportPeriodKey, SiteReportSnapshot } from "../../../shared/schemas/report.ts";
import type { WebmasterSiteData } from "../../../shared/schemas/webmaster-source.ts";
import type {
  CreateSourceRunInput,
  CreateSyncRunInput,
  FinishSourceRunInput,
  FinishSyncRunInput,
  StoreLandingPageMetricsInput,
  StoreMetrikaDailyMetricsInput,
  StoreMetrikaDeviceMetricsInput,
  StoreMetrikaGoalMetricsInput,
  StoreMetrikaSearchEngineMetricsInput,
  StoreMetrikaSearchPhraseMetricsInput,
  StoreMetrikaGeoMetricsInput,
  StoreRankingCapturesInput,
  StoreReportSnapshotInput,
  StoreTechnicalSnapshotsInput,
  StoreWebmasterDailyMetricsInput,
  StoreWebmasterQueryMetricsInput,
  StoredSourceRunRecord,
  SyncRepository,
} from "./ports/sync-repository.ts";
import { MonitoringService } from "../../project-registry/index.ts";
import { ProjectService } from "../../project-registry/index.ts";
import { ReportService } from "../../reporting/index.ts";
import { createCorrelationId } from "../../../platform/http/correlation.ts";

export interface SyncProjectToDatabaseArgs {
  projectSlug: string;
  trigger: CreateSyncRunInput["trigger"];
  collectors: SiteSourceCollectors;
  now?: () => string;
  correlationId?: string;
  expectedOrganizationId?: string | null;
}

export interface SyncProjectPeriodResult {
  periodKey: ReportPeriodKey;
  freshness: SiteReportSnapshot["freshness"];
}

export interface SyncProjectSiteResult {
  siteSlug: string;
  status: "success" | "partial" | "failed";
  freshness: SiteReportSnapshot["freshness"];
  periods: SyncProjectPeriodResult[];
  safeErrorCodes: string[];
}

export interface SyncProjectToDatabaseResult {
  syncRunId: string;
  projectSlug: string;
  status: "success" | "partial" | "failed";
  sites: SyncProjectSiteResult[];
}

const GOAL_CATEGORY_BY_METRICA_CATEGORY = {
  lead_submit: "LEAD_SUBMIT",
  phone_click: "PHONE_CLICK",
  messenger_click: "MESSENGER_CLICK",
  form_start: "FORM_START",
  file_download: "FILE_DOWNLOAD",
  other: "OTHER",
} as const;

const GOAL_DIRECTION_BY_METRICA_DIRECTION = {
  primary: "PRIMARY",
  secondary: "SECONDARY",
} as const;

function toSafeFailure(error: unknown): SafeSourceFailure {
  if (error && typeof error === "object" && "code" in error) {
    const code = typeof error.code === "string" ? error.code : "UNKNOWN_SOURCE_ERROR";
    const status =
      "status" in error && typeof error.status === "number" ? error.status : null;
    return { code, status };
  }

  return {
    code: "UNKNOWN_SOURCE_ERROR",
    status: null,
  };
}

const WEBMASTER_TECHNICAL_ENDPOINT_SUFFIXES = [
  "/diagnostics",
  "/sitemaps",
  "/indexing/history",
  "/sqi-history",
  "/search-urls/events/history",
  "/links/internal/broken/history",
  "/links/external/history",
] as const;

export function mergeWebmasterTechnicalData(
  periodData: WebmasterSiteData,
  baselineData: WebmasterSiteData,
): WebmasterSiteData {
  const technicalErrors = baselineData.endpointErrors.filter((error) =>
    WEBMASTER_TECHNICAL_ENDPOINT_SUFFIXES.some((suffix) => error.endpoint.endsWith(suffix)),
  );

  return {
    ...periodData,
    diagnostics: baselineData.diagnostics,
    sitemaps: baselineData.sitemaps,
    indexingHistory: baselineData.indexingHistory,
    sqiHistory: baselineData.sqiHistory,
    searchEventsHistory: baselineData.searchEventsHistory,
    brokenInternalLinksHistory: baselineData.brokenInternalLinksHistory,
    externalLinksHistory: baselineData.externalLinksHistory,
    partial: periodData.partial || technicalErrors.length > 0,
    endpointErrors: [...periodData.endpointErrors, ...technicalErrors],
  };
}

function rowsReceivedForWebmaster(data: WebmasterSiteData | null) {
  if (!data) {
    return null;
  }

  return data.queryCollections.reduce((count, collection) => count + collection.queries.length, 0);
}

function rowsReceivedForMetrica(data: MetricaSiteAudit | null) {
  if (!data) {
    return null;
  }

  return (
    data.yandexOrganic.byTime.length +
    data.yandexOrganic.landingPages.length +
    data.yandexOrganic.devices.length +
    data.goalsSummary.items.length
  );
}

function rowsReceivedForTopvisor(data: TopvisorSiteData | null) {
  if (!data) {
    return null;
  }

  return data.snapshots.reduce((count, snapshot) => count + snapshot.queries.length, 0);
}

function findBaselinePeriod(webmasterData: WebmasterSiteData | null) {
  if (!webmasterData) {
    return null;
  }

  return (
    webmasterData.queryCollections.find(
      (collection) =>
        collection.device === "ALL" &&
        collection.orderBy === "TOTAL_SHOWS" &&
        collection.dateTo !== null,
    ) ?? null
  );
}

function getSourceStatusForPeriod(
  snapshot: SiteReportSnapshot,
  provider: "YANDEX_WEBMASTER" | "YANDEX_METRIKA" | "TOPVISOR",
) {
  if (provider === "YANDEX_WEBMASTER") {
    return snapshot.sources.webmaster;
  }

  if (provider === "YANDEX_METRIKA") {
    return snapshot.sources.metrica;
  }

  return (
    snapshot.sources.topvisor ?? {
      status: "not_configured",
      fetchedAt: snapshot.generatedAt,
      periodStart: null,
      periodEnd: null,
      timezone: "+00:00",
      note: null,
      safeErrorCode: null,
    }
  );
}

export interface PeriodSourceState {
  status: FinishSourceRunInput["status"];
  safeErrorCode: string | null;
  note: string | null;
}

export type SourceRunSummary = Pick<
  FinishSourceRunInput,
  "status" | "safeErrorCode" | "notes"
>;

export function summarizeSourceRun(states: PeriodSourceState[]): SourceRunSummary {
  const firstError = states.find((state) => state.safeErrorCode)?.safeErrorCode ?? null;
  const firstNote = states.find((state) => state.note)?.note ?? null;

  if (states.length === 0) {
    return { status: "failed", safeErrorCode: firstError, notes: firstNote };
  }
  if (states.every((state) => state.status === "success")) {
    return { status: "success", safeErrorCode: null, notes: null };
  }
  if (
    states.some(
      (state) =>
        state.status === "success" ||
        state.status === "partial" ||
        state.status === "stale",
    )
  ) {
    return { status: "partial", safeErrorCode: firstError, notes: firstNote };
  }

  const firstStatus = states[0]!.status;
  return {
    status: states.every((state) => state.status === firstStatus) ? firstStatus : "failed",
    safeErrorCode: firstError,
    notes: firstNote,
  };
}

function normalizeTrackedQuery(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim();
}

function toDateOnly(value: string) {
  return value.slice(0, 10);
}

export function shouldCollectTopvisor(trigger: CreateSyncRunInput["trigger"], timestamp: string) {
  return trigger !== "daily" || new Date(timestamp).getUTCDay() === 1;
}

function buildWebmasterDailyRows(data: WebmasterSiteData | null) {
  if (!data) {
    return [];
  }

  const showHistory = data.allQueryHistory.find((history) => history.indicator === "TOTAL_SHOWS")?.points ?? [];
  const clickHistory = data.allQueryHistory.find((history) => history.indicator === "TOTAL_CLICKS")?.points ?? [];
  const positionHistory =
    data.allQueryHistory.find((history) => history.indicator === "AVG_SHOW_POSITION")?.points ?? [];
  const allDates = new Set<string>();
  for (const point of showHistory) allDates.add(toDateOnly(point.date));
  for (const point of clickHistory) allDates.add(toDateOnly(point.date));
  for (const point of positionHistory) allDates.add(toDateOnly(point.date));
  const clicksByDate = new Map(clickHistory.map((point) => [toDateOnly(point.date), point.value]));
  const positionByDate = new Map(positionHistory.map((point) => [toDateOnly(point.date), point.value]));

  return [...allDates]
    .sort()
    .map((date) => {
      const shows = showHistory.find((point) => toDateOnly(point.date) === date)?.value ?? 0;
      const clicks = clicksByDate.get(date) ?? 0;
      return {
        date,
        shows,
        clicks,
        ctr: shows > 0 ? Number(((clicks / shows) * 100).toFixed(2)) : null,
        averagePosition: positionByDate.get(date) ?? null,
      };
    });
}

function buildWebmasterQueryRows(
  data: WebmasterSiteData | null,
  fallbackDate: string,
) {
  if (!data) {
    return [];
  }

  return data.queryCollections.flatMap((collection) =>
    collection.queries.map((query) => ({
      date: collection.dateTo ?? fallbackDate,
      queryId: query.queryId,
      query: query.queryText,
      normalizedQuery: normalizeTrackedQuery(query.queryText),
      orderBy: collection.orderBy,
      device: query.device,
      shows: query.shows,
      clicks: query.clicks,
      ctr: query.ctrPercent,
      averagePosition: query.avgShowPosition,
      averageClickPosition: query.avgClickPosition,
      demand: query.demand ?? null,
      relevantUrl: query.relevantUrl ?? null,
    })),
  );
}

function buildMetrikaDailyRows(data: MetricaSiteAudit | null) {
  if (!data) {
    return [];
  }

  return data.yandexOrganic.byTime.map((point) => ({
    date: point.date,
    visits: point.visits,
    users: null,
    pageviews: null,
    bounceRate: null,
    pageDepth: null,
    averageVisitDurationSeconds: null,
    goalReaches: point.goalReaches,
    uniqueTargetVisits: point.targetVisits,
    uniqueTargetUsers: null,
    allVisits: null,
    conversionRate: point.conversionRate,
  }));
}

function buildMetrikaSearchEngineRows(data: MetricaSiteAudit | null, fallbackDate: string) {
  const date = data?.yandexOrganic.meta.date2 ?? fallbackDate;
  return (data?.organicEngines ?? []).map((row) => ({ date, ...row }));
}

function buildMetrikaSearchPhraseRows(data: MetricaSiteAudit | null, fallbackDate: string) {
  const date = data?.yandexOrganic.meta.date2 ?? fallbackDate;
  return (data?.searchPhrases ?? []).map((row) => ({ date, ...row }));
}

function buildMetrikaGeoRows(data: MetricaSiteAudit | null, fallbackDate: string) {
  const date = data?.yandexOrganic.meta.date2 ?? fallbackDate;
  return (data?.geography ?? []).map((row) => ({ date, ...row }));
}

function buildAllowedGoalsForSite(siteSlug: string, goalProfile: GoalProfile) {
  return goalProfile.goals
    .filter((goal) => goal.siteSlugs.length === 0 || goal.siteSlugs.includes(siteSlug))
    .map((goal) => ({
      goalId: goal.goalId,
      label: goal.label,
      category: goal.category,
      direction: goal.direction,
      includeInSeoConversion: goal.includeInSeoConversion,
    }));
}

function buildLandingPageRows(
  data: MetricaSiteAudit | null,
  fallbackDate: string,
) {
  if (!data) {
    return [];
  }

  const date = data.yandexOrganic.meta.date2 ?? fallbackDate;
  return data.yandexOrganic.landingPages.map((row) => ({
    date,
    path: row.path,
    visits: row.visits,
    users: row.users,
    pageviews: row.pageviews,
    bounceRate: row.bounceRate,
    pageDepth: row.pageDepth,
    averageVisitDurationSeconds: row.averageVisitDurationSeconds,
    goalReaches: row.goalReaches,
    targetVisits: row.targetVisits,
    conversionRate: row.conversionRate,
  }));
}

function buildMetrikaDeviceRows(
  data: MetricaSiteAudit | null,
  fallbackDate: string,
) {
  if (!data) {
    return [];
  }

  const date = data.yandexOrganic.meta.date2 ?? fallbackDate;
  return data.yandexOrganic.devices.map((row) => ({
    date,
    device: row.device,
    visits: row.visits,
    users: row.users,
    goalReaches: row.goalReaches,
    conversionRate: row.conversionRate,
  }));
}

function buildMetrikaGoalRows(
  data: MetricaSiteAudit | null,
  fallbackDate: string,
) {
  if (!data) {
    return [];
  }

  const date = data.goalsSummary.meta.date2 ?? data.yandexOrganic.meta.date2 ?? fallbackDate;
  return data.goalsSummary.items.map((row) => ({
    date,
    externalGoalId: row.goalId,
    name: row.name,
    category: goalCategoryToPrisma(row.category),
    direction: goalDirectionToPrisma(row.direction),
    reaches: row.reaches,
    visits: row.visits,
    users: row.users,
    conversionRate: row.conversionRate,
  }));
}

function goalCategoryToPrisma(value: string) {
  return GOAL_CATEGORY_BY_METRICA_CATEGORY[
    value as keyof typeof GOAL_CATEGORY_BY_METRICA_CATEGORY
  ];
}

function goalDirectionToPrisma(value: string) {
  return GOAL_DIRECTION_BY_METRICA_DIRECTION[
    value as keyof typeof GOAL_DIRECTION_BY_METRICA_DIRECTION
  ];
}

function buildTechnicalSnapshotRows(
  webmasterData: WebmasterSiteData | null,
  metricaData: MetricaSiteAudit | null,
) {
  const rows: Array<{
    capturedAt: string;
    kind:
      | "WEBMASTER_DIAGNOSTICS"
      | "WEBMASTER_SITEMAPS"
      | "WEBMASTER_INDEXING_HISTORY"
      | "WEBMASTER_SEARCH_EVENTS_HISTORY"
      | "WEBMASTER_BROKEN_INTERNAL_LINKS_HISTORY"
      | "WEBMASTER_EXTERNAL_LINKS_HISTORY"
      | "WEBMASTER_PAGES_IN_SEARCH_HISTORY"
      | "WEBMASTER_SQI_HISTORY"
      | "METRICA_ALL_TRAFFIC_META"
      | "METRICA_YANDEX_ORGANIC_META"
      | "METRICA_GOALS_SUMMARY_META";
    payload: unknown;
  }> = [];

  if (webmasterData) {
    rows.push(
      { capturedAt: webmasterData.fetchedAt, kind: "WEBMASTER_DIAGNOSTICS", payload: webmasterData.diagnostics },
      { capturedAt: webmasterData.fetchedAt, kind: "WEBMASTER_SITEMAPS", payload: webmasterData.sitemaps },
      { capturedAt: webmasterData.fetchedAt, kind: "WEBMASTER_INDEXING_HISTORY", payload: webmasterData.indexingHistory },
      { capturedAt: webmasterData.fetchedAt, kind: "WEBMASTER_SEARCH_EVENTS_HISTORY", payload: webmasterData.searchEventsHistory },
      { capturedAt: webmasterData.fetchedAt, kind: "WEBMASTER_BROKEN_INTERNAL_LINKS_HISTORY", payload: webmasterData.brokenInternalLinksHistory },
      { capturedAt: webmasterData.fetchedAt, kind: "WEBMASTER_EXTERNAL_LINKS_HISTORY", payload: webmasterData.externalLinksHistory },
      { capturedAt: webmasterData.fetchedAt, kind: "WEBMASTER_PAGES_IN_SEARCH_HISTORY", payload: webmasterData.pagesInSearchHistory },
      { capturedAt: webmasterData.fetchedAt, kind: "WEBMASTER_SQI_HISTORY", payload: webmasterData.sqiHistory },
    );
  }

  if (metricaData) {
    rows.push(
      { capturedAt: metricaData.fetchedAt, kind: "METRICA_ALL_TRAFFIC_META", payload: metricaData.allTraffic.meta },
      { capturedAt: metricaData.fetchedAt, kind: "METRICA_YANDEX_ORGANIC_META", payload: metricaData.yandexOrganic.meta },
      { capturedAt: metricaData.fetchedAt, kind: "METRICA_GOALS_SUMMARY_META", payload: metricaData.goalsSummary.meta },
    );
  }

  return rows;
}

function buildRankingCaptureRows(
  rankingData: TopvisorSiteData | null,
  trackedQueryRows: Array<{ trackedQueryId: string; normalizedQuery: string }>,
) {
  if (!rankingData) {
    return [];
  }

  const trackedQueryIdByNormalizedQuery = new Map(
    trackedQueryRows.map((row) => [row.normalizedQuery, row.trackedQueryId]),
  );

  return rankingData.snapshots.flatMap((snapshot) =>
    snapshot.queries.flatMap((query) => {
      const trackedQueryId = trackedQueryIdByNormalizedQuery.get(
        normalizeTrackedQuery(query.query),
      );
      if (!trackedQueryId) {
        return [];
      }

      return [
        {
          trackedQueryId,
          capturedAt: `${snapshot.capturedAt}T00:00:00.000Z`,
          position: query.position,
          source: "TOPVISOR" as const,
          engine: snapshot.engine ?? "YANDEX",
          device: snapshot.device ?? "DESKTOP",
          regionKey: snapshot.regionKey ?? "legacy",
          regionName: null,
          relevantUrl: null,
        },
      ];
    }),
  );
}

type SyncServiceDependencies = {
  monitoringService: MonitoringService;
  projectService: ProjectService;
  reportService: ReportService;
  syncRepository: SyncRepository;
  logger: SyncLogger;
};

export class SyncService {
  constructor(private readonly dependencies: SyncServiceDependencies) {}

  private get monitoringService() {
    return this.dependencies.monitoringService;
  }

  private get projectService() {
    return this.dependencies.projectService;
  }

  private get reportService() {
    return this.dependencies.reportService;
  }

  private get syncRepository() {
    return this.dependencies.syncRepository;
  }

  private log(event: SyncLogEvent) {
    try {
      this.dependencies.logger.log(event);
    } catch {
      // Logging must not change sync outcome.
    }
  }

  createSyncRun(input: CreateSyncRunInput) {
    return this.syncRepository.createSyncRun(input);
  }

  createSourceRun(input: CreateSourceRunInput) {
    return this.syncRepository.createSourceRun(input);
  }

  finishSourceRun(input: FinishSourceRunInput) {
    return this.syncRepository.finishSourceRun(input);
  }

  finishSyncRun(input: FinishSyncRunInput) {
    return this.syncRepository.finishSyncRun(input);
  }

  storeReportSnapshot(input: StoreReportSnapshotInput) {
    return this.syncRepository.storeReportSnapshot(input);
  }

  storeWebmasterDailyMetrics(input: StoreWebmasterDailyMetricsInput) {
    return this.syncRepository.storeWebmasterDailyMetrics(input);
  }

  storeWebmasterQueryMetrics(input: StoreWebmasterQueryMetricsInput) {
    return this.syncRepository.storeWebmasterQueryMetrics(input);
  }

  storeMetrikaDailyMetrics(input: StoreMetrikaDailyMetricsInput) {
    return this.syncRepository.storeMetrikaDailyMetrics(input);
  }

  storeLandingPageMetrics(input: StoreLandingPageMetricsInput) {
    return this.syncRepository.storeLandingPageMetrics(input);
  }

  storeMetrikaDeviceMetrics(input: StoreMetrikaDeviceMetricsInput) {
    return this.syncRepository.storeMetrikaDeviceMetrics(input);
  }

  storeMetrikaGoalMetrics(input: StoreMetrikaGoalMetricsInput) {
    return this.syncRepository.storeMetrikaGoalMetrics(input);
  }

  storeMetrikaSearchEngineMetrics(input: StoreMetrikaSearchEngineMetricsInput) { return this.syncRepository.storeMetrikaSearchEngineMetrics(input); }
  storeMetrikaSearchPhraseMetrics(input: StoreMetrikaSearchPhraseMetricsInput) { return this.syncRepository.storeMetrikaSearchPhraseMetrics(input); }
  storeMetrikaGeoMetrics(input: StoreMetrikaGeoMetricsInput) { return this.syncRepository.storeMetrikaGeoMetrics(input); }

  storeRankingCaptures(input: StoreRankingCapturesInput) {
    return this.syncRepository.storeRankingCaptures(input);
  }

  storeTechnicalSnapshots(input: StoreTechnicalSnapshotsInput) {
    return this.syncRepository.storeTechnicalSnapshots(input);
  }

  listTrackedQueriesForSite(siteId: string) {
    return this.syncRepository.listTrackedQueriesForSite(siteId);
  }

  async syncProjectToDatabase(
    args: SyncProjectToDatabaseArgs,
  ): Promise<SyncProjectToDatabaseResult> {
    const lock = await this.syncRepository.tryAcquireFullSyncLock("global");
    if (!lock) {
      const error = new Error("Another full sync is already running");
      Object.assign(error, { code: "SYNC_ALREADY_RUNNING" });
      throw error;
    }

    try {
      return await this.executeProjectSync(args);
    } finally {
      await lock.release();
    }
  }

  private async executeProjectSync(
    args: SyncProjectToDatabaseArgs,
  ): Promise<SyncProjectToDatabaseResult> {
    const now = args.now ?? (() => new Date().toISOString());
    const syncStartedAtMs = Date.now();
    const generatedAt = now();
    const correlationId = args.correlationId ?? createCorrelationId();
    const projectContext = await this.monitoringService.getProjectContext(args.projectSlug);

    if (!projectContext) {
      throw new Error(`Unknown project slug: ${args.projectSlug}`);
    }
    if (args.expectedOrganizationId && projectContext.organizationId !== args.expectedOrganizationId) {
      throw new Error("PROJECT_SYNC_INVALID_SCOPE");
    }

    const collectors = args.collectors;
    const syncRun = await this.createSyncRun({
      organizationId: projectContext.organizationId,
      projectId: projectContext.projectId,
      projectSlug: projectContext.client.clientSlug,
      trigger: args.trigger,
      startedAt: generatedAt,
      correlationId,
    });
    this.log({
      event: "sync_started",
      syncRunId: syncRun.syncRunId,
      projectSlug: args.projectSlug,
      trigger: args.trigger,
    });
    const siteResults: SyncProjectSiteResult[] = [];
    const projectSafeErrors = new Set<string>();
    const openSourceRuns = new Map<
      string,
      {
        record: StoredSourceRunRecord;
        siteId: string;
        provider: "YANDEX_WEBMASTER" | "YANDEX_METRIKA" | "TOPVISOR";
        startedAtMs: number;
      }
    >();

    const registerSourceRun = (
      sourceRun: StoredSourceRunRecord | null,
      siteId: string,
      provider: "YANDEX_WEBMASTER" | "YANDEX_METRIKA" | "TOPVISOR",
    ) => {
      if (sourceRun) {
        openSourceRuns.set(sourceRun.sourceRunId, {
          record: sourceRun,
          siteId,
          provider,
          startedAtMs: Date.now(),
        });
      }
      return sourceRun;
    };

    const closeSourceRun = async (
      sourceRun: StoredSourceRunRecord | null,
      input: Omit<FinishSourceRunInput, "sourceRunId" | "durationMs">,
    ) => {
      if (!sourceRun) {
        return;
      }
      const metadata = openSourceRuns.get(sourceRun.sourceRunId);
      const durationMs = metadata ? Math.max(0, Date.now() - metadata.startedAtMs) : 0;
      await this.finishSourceRun({
        sourceRunId: sourceRun.sourceRunId,
        ...input,
        durationMs,
      });
      openSourceRuns.delete(sourceRun.sourceRunId);
      if (metadata) {
        this.log({
          event: "source_run_finished",
          syncRunId: syncRun.syncRunId,
          sourceRunId: sourceRun.sourceRunId,
          siteId: metadata.siteId,
          provider: metadata.provider,
          durationMs,
          status: input.status,
          safeErrorCode: input.safeErrorCode,
        });
      }
    };

    try {
      for (const site of projectContext.client.sites.filter((item) => item.enabled)) {
        const siteRecord = await this.projectService.getSiteBySlugs(
          projectContext.client.clientSlug,
          site.siteSlug,
        );
        if (!siteRecord) {
          throw new Error(
            `Seeded site is missing in PostgreSQL: ${projectContext.client.clientSlug}/${site.siteSlug}`,
          );
        }
        const collectTopvisorNow = site.topvisor.enabled && shouldCollectTopvisor(args.trigger, generatedAt);

        const sourceRuns = {
          webmaster: site.webmaster.enabled
            ? registerSourceRun(
                await this.createSourceRun({
                  syncRunId: syncRun.syncRunId,
                  projectId: projectContext.projectId,
                  siteId: siteRecord.siteId,
                  provider: "YANDEX_WEBMASTER",
                  startedAt: generatedAt,
                  correlationId,
                }),
                siteRecord.siteId,
                "YANDEX_WEBMASTER",
              )
            : null,
          metrica: site.metrica.enabled
            ? registerSourceRun(
                await this.createSourceRun({
                  syncRunId: syncRun.syncRunId,
                  projectId: projectContext.projectId,
                  siteId: siteRecord.siteId,
                  provider: "YANDEX_METRIKA",
                  startedAt: generatedAt,
                  correlationId,
                }),
                siteRecord.siteId,
                "YANDEX_METRIKA",
              )
            : null,
          topvisor: collectTopvisorNow
            ? registerSourceRun(
                await this.createSourceRun({
                  syncRunId: syncRun.syncRunId,
                  projectId: projectContext.projectId,
                  siteId: siteRecord.siteId,
                  provider: "TOPVISOR",
                  startedAt: generatedAt,
                  correlationId,
                }),
                siteRecord.siteId,
                "TOPVISOR",
              )
            : null,
        };

        let baselineWebmaster: WebmasterSiteData | null = null;
        let baselineWebmasterFailure: SafeSourceFailure | null = null;

        if (site.webmaster.enabled) {
          try {
            baselineWebmaster = await collectors.webmaster(site, {
              queryLimit: 500,
              queryOrders: ["TOTAL_SHOWS", "TOTAL_CLICKS"],
              devices: ["ALL", "DESKTOP", "MOBILE"],
              includeTechnicalDetails: true,
            });
          } catch (error) {
            baselineWebmasterFailure = toSafeFailure(error);
          }
        }

        const baselinePeriod = findBaselinePeriod(baselineWebmaster);
        const fallbackMonth = await this.reportService.getLatestReportSnapshotForSite(
          siteRecord.siteId,
          "month",
        );
        const periodEnd =
          baselinePeriod?.dateTo ??
          fallbackMonth?.payload.comparison?.currentPeriod.dateTo ??
          generatedAt.slice(0, 10);

        let rankingData: TopvisorSiteData | null = null;
        let topvisorFailure: SafeSourceFailure | null = null;

        if (collectTopvisorNow) {
          try {
            if (!collectors.topvisor) {
              throw new Error("Topvisor collector is unavailable");
            }
            const historyPeriod = derivePeriodEndingOn(periodEnd, "halfYear");
            rankingData = await collectors.topvisor(site, {
              dateFrom: historyPeriod.dateFrom,
              dateTo: historyPeriod.dateTo,
            });
          } catch (error) {
            topvisorFailure = toSafeFailure(error);
          }
        }

        const allowedGoals = buildAllowedGoalsForSite(site.siteSlug, projectContext.goalProfile);
        const periodResults: SyncProjectPeriodResult[] = [];
        const siteSafeErrorCodes = new Set<string>();
        const sourceStates: Record<
          "webmaster" | "metrica" | "topvisor",
          PeriodSourceState[]
        > = {
          webmaster: [],
          metrica: [],
          topvisor: [],
        };
        let latestMetricaData: MetricaSiteAudit | null = null;
        let preferredTechnicalMetricaData: MetricaSiteAudit | null = null;

        for (const periodKey of REPORT_PERIOD_KEYS) {
          const currentPeriod: DatePeriod = derivePeriodEndingOn(periodEnd, periodKey);
          const previousPeriod: DatePeriod = derivePreviousPeriod(currentPeriod);
          const previousSnapshot = await this.reportService.getLatestReportSnapshotForSite(
            siteRecord.siteId,
            periodKey,
          );
          let webmasterData: WebmasterSiteData | null = null;
          let metricaData: MetricaSiteAudit | null = null;
          let previousWebmasterData: WebmasterSiteData | null = null;
          let previousMetricaData: MetricaSiteAudit | null = null;
          let metricaFailure: SafeSourceFailure | null = null;
          let webmasterFailure = baselineWebmasterFailure;

          if (site.webmaster.enabled) {
            try {
              webmasterData = await collectors.webmaster(site, {
                queryLimit: 500,
                queryOrders: ["TOTAL_SHOWS", "TOTAL_CLICKS"],
                devices: ["ALL"],
                historyDateFrom: currentPeriod.dateFrom,
                historyDateTo: currentPeriod.dateTo,
                queryDateFrom: currentPeriod.dateFrom,
                queryDateTo: currentPeriod.dateTo,
                includeTechnicalDetails: false,
              });
              if (baselineWebmaster) {
                webmasterData = mergeWebmasterTechnicalData(webmasterData, baselineWebmaster);
              }
              previousWebmasterData = await collectors.webmaster(site, {
                queryLimit: 500,
                queryOrders: ["TOTAL_SHOWS", "TOTAL_CLICKS"],
                devices: ["ALL"],
                historyDateFrom: previousPeriod.dateFrom,
                historyDateTo: previousPeriod.dateTo,
                queryDateFrom: previousPeriod.dateFrom,
                queryDateTo: previousPeriod.dateTo,
                includeTechnicalDetails: false,
              });
            } catch (error) {
              webmasterFailure = toSafeFailure(error);
            }
          }

          if (site.metrica.enabled) {
            try {
              metricaData = await collectors.metrica(site, {
                date1: currentPeriod.dateFrom,
                date2: currentPeriod.dateTo,
                landingLimit: 10,
                includeDetails: true,
                allowedGoals,
                timezone: site.timezone,
              });
              previousMetricaData = await collectors.metrica(site, {
                date1: previousPeriod.dateFrom,
                date2: previousPeriod.dateTo,
                landingLimit: 0,
                includeDetails: false,
                allowedGoals,
                timezone: site.timezone,
              });
              latestMetricaData = metricaData;
            } catch (error) {
              metricaFailure = toSafeFailure(error);
            }
          }

          const trackedQuerySet =
            projectContext.trackedQuerySets.find((item) => item.siteSlug === site.siteSlug) ?? null;
          const snapshot = compileSiteReportSnapshot({
            clientSlug: projectContext.client.clientSlug,
            site,
            generatedAt,
            clusterProfile: projectContext.clusterProfile,
            webmasterData,
            metricaData,
            previousWebmasterData,
            previousMetricaData,
            webmasterFailure,
            metricaFailure,
            previous: previousSnapshot?.payload ?? null,
            periodKey,
            currentPeriod,
            previousPeriod,
            queryThresholds: projectContext.thresholds.queryOpportunity,
            trackedQuerySet,
            rankingData,
            topvisorFailure,
          });

          await this.storeReportSnapshot({
            siteId: siteRecord.siteId,
            periodKey,
            snapshot,
          });

          if (sourceRuns.webmaster) {
            await this.storeWebmasterDailyMetrics({
              siteId: siteRecord.siteId,
              sourceRunId: sourceRuns.webmaster.sourceRunId,
              rows: buildWebmasterDailyRows(webmasterData),
            });
            await this.storeWebmasterDailyMetrics({
              siteId: siteRecord.siteId,
              sourceRunId: sourceRuns.webmaster.sourceRunId,
              rows: buildWebmasterDailyRows(previousWebmasterData),
            });
            await this.storeWebmasterQueryMetrics({
              siteId: siteRecord.siteId,
              sourceRunId: sourceRuns.webmaster.sourceRunId,
              periodKey,
              rows: buildWebmasterQueryRows(webmasterData, currentPeriod.dateTo),
            });
            await this.storeWebmasterQueryMetrics({
              siteId: siteRecord.siteId,
              sourceRunId: sourceRuns.webmaster.sourceRunId,
              periodKey,
              rows: buildWebmasterQueryRows(previousWebmasterData, previousPeriod.dateTo),
            });
          }

          if (sourceRuns.metrica) {
            await this.storeMetrikaDailyMetrics({
              siteId: siteRecord.siteId,
              sourceRunId: sourceRuns.metrica.sourceRunId,
              rows: buildMetrikaDailyRows(metricaData),
            });
            await this.storeMetrikaDailyMetrics({
              siteId: siteRecord.siteId,
              sourceRunId: sourceRuns.metrica.sourceRunId,
              rows: buildMetrikaDailyRows(previousMetricaData),
            });
            await this.storeLandingPageMetrics({
              siteId: siteRecord.siteId,
              sourceRunId: sourceRuns.metrica.sourceRunId,
              periodKey,
              rows: buildLandingPageRows(metricaData, currentPeriod.dateTo),
            });
            await this.storeMetrikaDeviceMetrics({
              siteId: siteRecord.siteId,
              sourceRunId: sourceRuns.metrica.sourceRunId,
              periodKey,
              rows: buildMetrikaDeviceRows(metricaData, currentPeriod.dateTo),
            });
            await this.storeMetrikaGoalMetrics({
              siteId: siteRecord.siteId,
              sourceRunId: sourceRuns.metrica.sourceRunId,
              periodKey,
              rows: buildMetrikaGoalRows(metricaData, currentPeriod.dateTo),
            });
            await this.storeMetrikaSearchEngineMetrics({ siteId: siteRecord.siteId, sourceRunId: sourceRuns.metrica.sourceRunId, periodKey, rows: buildMetrikaSearchEngineRows(metricaData, currentPeriod.dateTo) });
            await this.storeMetrikaSearchPhraseMetrics({ siteId: siteRecord.siteId, sourceRunId: sourceRuns.metrica.sourceRunId, periodKey, rows: buildMetrikaSearchPhraseRows(metricaData, currentPeriod.dateTo) });
            await this.storeMetrikaGeoMetrics({ siteId: siteRecord.siteId, sourceRunId: sourceRuns.metrica.sourceRunId, periodKey, rows: buildMetrikaGeoRows(metricaData, currentPeriod.dateTo) });
          }

          if (periodKey === "month" && metricaData) {
            preferredTechnicalMetricaData = metricaData;
          }

          sourceStates.webmaster.push(getSourceStatusForPeriod(snapshot, "YANDEX_WEBMASTER"));
          sourceStates.metrica.push(getSourceStatusForPeriod(snapshot, "YANDEX_METRIKA"));
          sourceStates.topvisor.push(getSourceStatusForPeriod(snapshot, "TOPVISOR"));
          periodResults.push({ periodKey, freshness: snapshot.freshness });

          for (const safeErrorCode of [
            webmasterFailure?.code,
            metricaFailure?.code,
            topvisorFailure?.code,
          ]) {
            if (safeErrorCode) {
              siteSafeErrorCodes.add(safeErrorCode);
              projectSafeErrors.add(safeErrorCode);
            }
          }
        }

        if (sourceRuns.webmaster && baselineWebmaster) {
          await this.storeTechnicalSnapshots({
            siteId: siteRecord.siteId,
            sourceRunId: sourceRuns.webmaster.sourceRunId,
            rows: buildTechnicalSnapshotRows(baselineWebmaster, null).filter((row) =>
              row.kind.startsWith("WEBMASTER_"),
            ),
          });
        }

        if (sourceRuns.metrica && preferredTechnicalMetricaData) {
          await this.storeTechnicalSnapshots({
            siteId: siteRecord.siteId,
            sourceRunId: sourceRuns.metrica.sourceRunId,
            rows: buildTechnicalSnapshotRows(null, preferredTechnicalMetricaData).filter((row) =>
              row.kind.startsWith("METRICA_"),
            ),
          });
        }

        if (sourceRuns.topvisor && rankingData) {
          const trackedQuerySet = await this.listTrackedQueriesForSite(siteRecord.siteId);
          await this.storeRankingCaptures({
            siteId: siteRecord.siteId,
            sourceRunId: sourceRuns.topvisor.sourceRunId,
            rows: buildRankingCaptureRows(rankingData, trackedQuerySet.rows),
          });
        }

        if (sourceRuns.webmaster) {
          const webmasterState = summarizeSourceRun(sourceStates.webmaster);
          await closeSourceRun(sourceRuns.webmaster, {
            ...webmasterState,
            finishedAt: now(),
            rowsReceived: rowsReceivedForWebmaster(baselineWebmaster),
          });
        }

        if (sourceRuns.metrica) {
          const metricaState = summarizeSourceRun(sourceStates.metrica);
          await closeSourceRun(sourceRuns.metrica, {
            ...metricaState,
            finishedAt: now(),
            rowsReceived: rowsReceivedForMetrica(latestMetricaData),
          });
        }

        if (sourceRuns.topvisor) {
          const topvisorState = summarizeSourceRun(sourceStates.topvisor);
          await closeSourceRun(sourceRuns.topvisor, {
            ...topvisorState,
            finishedAt: now(),
            rowsReceived: rowsReceivedForTopvisor(rankingData),
          });
        }

        const failed = periodResults.every((period) => period.freshness === "unavailable");
        const partial = periodResults.some((period) => period.freshness !== "fresh");
        siteResults.push({
          siteSlug: site.siteSlug,
          status: failed ? "failed" : partial ? "partial" : "success",
          freshness: failed ? "unavailable" : partial ? "partial" : "fresh",
          periods: periodResults,
          safeErrorCodes: [...siteSafeErrorCodes],
        });
      }

      const finalStatus = siteResults.some((site) => site.status === "failed")
        ? "failed"
        : siteResults.some((site) => site.status === "partial")
          ? "partial"
          : "success";

      await this.finishSyncRun({
        syncRunId: syncRun.syncRunId,
        status: finalStatus,
        finishedAt: now(),
        sitesProcessed: siteResults.length,
        sitesSucceeded: siteResults.filter((site) => site.status === "success").length,
        sitesPartial: siteResults.filter((site) => site.status === "partial").length,
        sitesFailed: siteResults.filter((site) => site.status === "failed").length,
        safeError: [...projectSafeErrors][0] ?? null,
      });
      await this.syncRepository.storeSyncNotification({
        organizationId: projectContext.organizationId,
        projectId: projectContext.projectId,
        projectSlug: projectContext.client.clientSlug,
        syncRunId: syncRun.syncRunId,
        trigger: args.trigger,
        status: finalStatus,
        occurredAt: now(),
        safeErrorCode: [...projectSafeErrors][0] ?? null,
      });

      this.log({
        event: "sync_finished",
        syncRunId: syncRun.syncRunId,
        projectSlug: projectContext.client.clientSlug,
        durationMs: Math.max(0, Date.now() - syncStartedAtMs),
        status: finalStatus,
        safeErrorCode: [...projectSafeErrors][0] ?? null,
      });

      return {
        syncRunId: syncRun.syncRunId,
        projectSlug: projectContext.client.clientSlug,
        status: finalStatus,
        sites: siteResults,
      };
    } catch (error) {
      const failedAt = now();
      const failure = toSafeFailure(error);

      for (const sourceRun of openSourceRuns.values()) {
        const durationMs = Math.max(0, Date.now() - sourceRun.startedAtMs);
        try {
          await this.finishSourceRun({
            sourceRunId: sourceRun.record.sourceRunId,
            status: "failed",
            finishedAt: failedAt,
            durationMs,
            rowsReceived: null,
            safeErrorCode: failure.code,
            notes: null,
          });
          this.log({
            event: "source_run_finished",
            syncRunId: syncRun.syncRunId,
            sourceRunId: sourceRun.record.sourceRunId,
            siteId: sourceRun.siteId,
            provider: sourceRun.provider,
            durationMs,
            status: "failed",
            safeErrorCode: failure.code,
          });
        } catch {
          // best effort only
        }
      }

      try {
        await this.finishSyncRun({
          syncRunId: syncRun.syncRunId,
          status: "failed",
          finishedAt: failedAt,
          sitesProcessed: siteResults.length,
          sitesSucceeded: siteResults.filter((site) => site.status === "success").length,
          sitesPartial: siteResults.filter((site) => site.status === "partial").length,
          sitesFailed: siteResults.filter((site) => site.status === "failed").length,
          safeError: failure.code,
        });
      } catch {
        // best effort only
      }

      this.log({
        event: "sync_failed",
        syncRunId: syncRun.syncRunId,
        projectSlug: projectContext.client.clientSlug,
        durationMs: Math.max(0, Date.now() - syncStartedAtMs),
        status: "failed",
        safeErrorCode: failure.code,
      });

      throw error;
    }
  }
}
