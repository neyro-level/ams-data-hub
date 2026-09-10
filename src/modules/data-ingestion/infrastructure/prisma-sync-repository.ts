import { GoalCategory,
GoalDirection,
RankingSource,
ReportFreshness,
ReportPeriodKey,
SourceStatus,
SyncRunStatus,
SyncTrigger,
TechnicalSnapshotKind,
WebmasterDevice,
WebmasterQueryOrderBy, } from "../../../generated/prisma/client.ts"
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
  StoredRunRecord,
  StoredSourceRunRecord,
  StoredTrackedQuerySetRecord,
  SyncRepository,
  SyncLockHandle,
} from "../application/ports/sync-repository.ts";
import { getPrismaClient, getPrismaPool } from "../../../platform/database/prisma/client.ts";

const PRISMA_TRIGGER_BY_APP_TRIGGER = {
  daily: SyncTrigger.DAILY,
  manual: SyncTrigger.MANUAL,
  preflight: SyncTrigger.PREFLIGHT,
  backfill: SyncTrigger.BACKFILL,
} as const;

const PRISMA_STATUS_BY_APP_STATUS = {
  running: SyncRunStatus.RUNNING,
  success: SyncRunStatus.SUCCESS,
  partial: SyncRunStatus.PARTIAL,
  failed: SyncRunStatus.FAILED,
} as const;

const PRISMA_SOURCE_STATUS_BY_APP_STATUS = {
  success: SourceStatus.SUCCESS,
  partial: SourceStatus.PARTIAL,
  failed: SourceStatus.FAILED,
  not_configured: SourceStatus.NOT_CONFIGURED,
  access_denied: SourceStatus.ACCESS_DENIED,
  quota_limited: SourceStatus.QUOTA_LIMITED,
  stale: SourceStatus.STALE,
} as const;

const PRISMA_REPORT_PERIOD_BY_APP_PERIOD = {
  week: ReportPeriodKey.WEEK,
  month: ReportPeriodKey.MONTH,
  quarter: ReportPeriodKey.QUARTER,
  halfYear: ReportPeriodKey.HALF_YEAR,
} as const;

const PRISMA_REPORT_FRESHNESS_BY_APP_FRESHNESS = {
  fresh: ReportFreshness.FRESH,
  stale: ReportFreshness.STALE,
  partial: ReportFreshness.PARTIAL,
  unavailable: ReportFreshness.UNAVAILABLE,
} as const;

const PRISMA_QUERY_ORDER_BY = {
  TOTAL_SHOWS: WebmasterQueryOrderBy.TOTAL_SHOWS,
  TOTAL_CLICKS: WebmasterQueryOrderBy.TOTAL_CLICKS,
} as const;

const PRISMA_DEVICE = {
  ALL: WebmasterDevice.ALL,
  DESKTOP: WebmasterDevice.DESKTOP,
  MOBILE: WebmasterDevice.MOBILE,
  TABLET: WebmasterDevice.TABLET,
  MOBILE_AND_TABLET: WebmasterDevice.MOBILE_AND_TABLET,
} as const;

const PRISMA_GOAL_CATEGORY = {
  LEAD_SUBMIT: GoalCategory.LEAD_SUBMIT,
  PHONE_CLICK: GoalCategory.PHONE_CLICK,
  MESSENGER_CLICK: GoalCategory.MESSENGER_CLICK,
  FORM_START: GoalCategory.FORM_START,
  FILE_DOWNLOAD: GoalCategory.FILE_DOWNLOAD,
  OTHER: GoalCategory.OTHER,
} as const;

const PRISMA_GOAL_DIRECTION = {
  PRIMARY: GoalDirection.PRIMARY,
  SECONDARY: GoalDirection.SECONDARY,
} as const;

const PRISMA_RANKING_SOURCE = {
  OWNER_PROVIDED: RankingSource.OWNER_PROVIDED,
  TOPVISOR: RankingSource.TOPVISOR,
} as const;

const PRISMA_TECHNICAL_SNAPSHOT_KIND = {
  WEBMASTER_DIAGNOSTICS: TechnicalSnapshotKind.WEBMASTER_DIAGNOSTICS,
  WEBMASTER_SITEMAPS: TechnicalSnapshotKind.WEBMASTER_SITEMAPS,
  WEBMASTER_INDEXING_HISTORY: TechnicalSnapshotKind.WEBMASTER_INDEXING_HISTORY,
  WEBMASTER_SEARCH_EVENTS_HISTORY: TechnicalSnapshotKind.WEBMASTER_SEARCH_EVENTS_HISTORY,
  WEBMASTER_BROKEN_INTERNAL_LINKS_HISTORY: TechnicalSnapshotKind.WEBMASTER_BROKEN_INTERNAL_LINKS_HISTORY,
  WEBMASTER_EXTERNAL_LINKS_HISTORY: TechnicalSnapshotKind.WEBMASTER_EXTERNAL_LINKS_HISTORY,
  WEBMASTER_PAGES_IN_SEARCH_HISTORY: TechnicalSnapshotKind.WEBMASTER_PAGES_IN_SEARCH_HISTORY,
  WEBMASTER_SQI_HISTORY: TechnicalSnapshotKind.WEBMASTER_SQI_HISTORY,
  METRICA_ALL_TRAFFIC_META: TechnicalSnapshotKind.METRICA_ALL_TRAFFIC_META,
  METRICA_YANDEX_ORGANIC_META: TechnicalSnapshotKind.METRICA_YANDEX_ORGANIC_META,
  METRICA_GOALS_SUMMARY_META: TechnicalSnapshotKind.METRICA_GOALS_SUMMARY_META,
} as const;

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateTime(value: string) {
  return new Date(value);
}

export class PrismaSyncRepository implements SyncRepository {
  private readonly siteOrganizationIds = new Map<string, string>();

  private async getOrganizationIdForSite(siteId: string): Promise<string> {
    const cached = this.siteOrganizationIds.get(siteId);
    if (cached) return cached;
    const site = await getPrismaClient().site.findUniqueOrThrow({
      where: { id: siteId },
      select: { project: { select: { organizationId: true } } },
    });
    const organizationId = site.project.organizationId;
    this.siteOrganizationIds.set(siteId, organizationId);
    return organizationId;
  }

  private async getOrganizationIdForTrackedQuery(trackedQueryId: string): Promise<string> {
    const query = await getPrismaClient().trackedQuery.findUniqueOrThrow({
      where: { id: trackedQueryId },
      select: {
        trackedQuerySet: {
          select: { site: { select: { project: { select: { organizationId: true } } } } },
        },
      },
    });
    return query.trackedQuerySet.site.project.organizationId;
  }
  async tryAcquireFullSyncLock(scope: string): Promise<SyncLockHandle | null> {
    const client = await getPrismaPool().connect();
    try {
      const result = await client.query<{ acquired: boolean }>(
        "select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired",
        [`ams-seo-monitor:full-sync:${scope}`],
      );
      if (!result.rows[0]?.acquired) {
        client.release();
        return null;
      }

      let released = false;
      return {
        async release() {
          if (released) {
            return;
          }
          released = true;
          try {
            await client.query(
              "select pg_advisory_unlock(hashtextextended($1, 0))",
              [`ams-seo-monitor:full-sync:${scope}`],
            );
          } finally {
            client.release();
          }
        },
      };
    } catch (error) {
      client.release();
      throw error;
    }
  }

  async createSyncRun(input: CreateSyncRunInput): Promise<StoredRunRecord> {
    const syncRun = await getPrismaClient().syncRun.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        projectSlug: input.projectSlug,
        trigger: PRISMA_TRIGGER_BY_APP_TRIGGER[input.trigger],
        status: SyncRunStatus.RUNNING,
        startedAt: toDateTime(input.startedAt),
        correlationId: input.correlationId,
      },
      select: { id: true },
    });

    return { syncRunId: syncRun.id };
  }

  async createSourceRun(input: CreateSourceRunInput): Promise<StoredSourceRunRecord> {
    const organizationId = await this.getOrganizationIdForSite(input.siteId);
    const prisma = getPrismaClient();
    const syncRun = await prisma.syncRun.findUniqueOrThrow({
      where: { id: input.syncRunId },
      select: { organizationId: true, projectId: true },
    });
    if (syncRun.organizationId !== organizationId || syncRun.projectId !== input.projectId) {
      throw new Error("SYNC_RUN_CROSS_TENANT_SOURCE");
    }
    const sourceRun = await prisma.sourceRun.create({
      data: {
        organizationId,
        projectId: input.projectId,
        correlationId: input.correlationId,
        syncRunId: input.syncRunId,
        siteId: input.siteId,
        provider: input.provider,
        status: SourceStatus.FAILED,
        startedAt: toDateTime(input.startedAt),
      },
      select: { id: true },
    });

    return { sourceRunId: sourceRun.id };
  }

  async finishSourceRun(input: FinishSourceRunInput): Promise<void> {
    await getPrismaClient().sourceRun.update({
      where: { id: input.sourceRunId },
      data: {
        status: PRISMA_SOURCE_STATUS_BY_APP_STATUS[input.status],
        finishedAt: toDateTime(input.finishedAt),
        durationMs: input.durationMs,
        rowsReceived: input.rowsReceived,
        safeErrorCode: input.safeErrorCode,
        notes: input.notes,
      },
    });
  }

  async finishSyncRun(input: FinishSyncRunInput): Promise<void> {
    await getPrismaClient().syncRun.update({
      where: { id: input.syncRunId },
      data: {
        status: PRISMA_STATUS_BY_APP_STATUS[input.status],
        finishedAt: toDateTime(input.finishedAt),
        sitesProcessed: input.sitesProcessed,
        sitesSucceeded: input.sitesSucceeded,
        sitesPartial: input.sitesPartial,
        sitesFailed: input.sitesFailed,
        safeError: input.safeError,
      },
    });
  }

  async storeReportSnapshot(input: StoreReportSnapshotInput): Promise<void> {
    const organizationId = await this.getOrganizationIdForSite(input.siteId);
    await getPrismaClient().reportSnapshot.create({
      data: {
        organizationId,
        siteId: input.siteId,
        periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey],
        schemaVersion: input.snapshot.schemaVersion,
        generatedAt: toDateTime(input.snapshot.generatedAt),
        freshness: PRISMA_REPORT_FRESHNESS_BY_APP_FRESHNESS[input.snapshot.freshness],
        payload: input.snapshot,
      },
    });
  }

  async storeWebmasterDailyMetrics(input: StoreWebmasterDailyMetricsInput): Promise<void> {
    const organizationId = await this.getOrganizationIdForSite(input.siteId);
    for (const row of input.rows) {
      await getPrismaClient().webmasterDailyMetric.upsert({
        where: {
          siteId_date: {
            siteId: input.siteId,
            date: toDateOnly(row.date),
          },
        },
        update: {
          shows: row.shows,
          clicks: row.clicks,
          ctr: row.ctr?.toString() ?? null,
          averagePosition: row.averagePosition?.toString() ?? null,
          organizationId,
          sourceRunId: input.sourceRunId,
        },
        create: {
          siteId: input.siteId,
          date: toDateOnly(row.date),
          shows: row.shows,
          clicks: row.clicks,
          ctr: row.ctr?.toString() ?? null,
          averagePosition: row.averagePosition?.toString() ?? null,
          organizationId,
          sourceRunId: input.sourceRunId,
        },
      });
    }
  }

  async storeWebmasterQueryMetrics(input: StoreWebmasterQueryMetricsInput): Promise<void> {
    const organizationId = await this.getOrganizationIdForSite(input.siteId);
    for (const row of input.rows) {
      await getPrismaClient().webmasterQueryDailyMetric.upsert({
        where: {
          siteId_periodKey_date_normalizedQuery_device_orderBy: {
            siteId: input.siteId,
            periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey],
            date: toDateOnly(row.date),
            normalizedQuery: row.normalizedQuery,
            device: PRISMA_DEVICE[row.device],
            orderBy: PRISMA_QUERY_ORDER_BY[row.orderBy],
          },
        },
        update: {
          queryId: row.queryId,
          query: row.query,
          shows: row.shows,
          clicks: row.clicks,
          ctr: row.ctr?.toString() ?? null,
          averagePosition: row.averagePosition?.toString() ?? null,
          averageClickPosition: row.averageClickPosition?.toString() ?? null,
          demand: row.demand?.toString() ?? null,
          relevantUrl: row.relevantUrl,
          organizationId,
          sourceRunId: input.sourceRunId,
        },
        create: {
          siteId: input.siteId,
          periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey],
          date: toDateOnly(row.date),
          queryId: row.queryId,
          query: row.query,
          normalizedQuery: row.normalizedQuery,
          orderBy: PRISMA_QUERY_ORDER_BY[row.orderBy],
          device: PRISMA_DEVICE[row.device],
          shows: row.shows,
          clicks: row.clicks,
          ctr: row.ctr?.toString() ?? null,
          averagePosition: row.averagePosition?.toString() ?? null,
          averageClickPosition: row.averageClickPosition?.toString() ?? null,
          demand: row.demand?.toString() ?? null,
          relevantUrl: row.relevantUrl,
          organizationId,
          sourceRunId: input.sourceRunId,
        },
      });
    }
  }

  async storeMetrikaDailyMetrics(input: StoreMetrikaDailyMetricsInput): Promise<void> {
    const organizationId = await this.getOrganizationIdForSite(input.siteId);
    for (const row of input.rows) {
      await getPrismaClient().metrikaDailyMetric.upsert({
        where: {
          siteId_date: {
            siteId: input.siteId,
            date: toDateOnly(row.date),
          },
        },
        update: {
          visits: row.visits,
          users: row.users,
          pageviews: row.pageviews,
          bounceRate: row.bounceRate?.toString() ?? null,
          pageDepth: row.pageDepth?.toString() ?? null,
          averageVisitDurationSeconds: row.averageVisitDurationSeconds,
          goalReaches: row.goalReaches,
          uniqueTargetVisits: row.uniqueTargetVisits,
          uniqueTargetUsers: row.uniqueTargetUsers,
          allVisits: row.allVisits,
          conversionRate: row.conversionRate?.toString() ?? null,
          organizationId,
          sourceRunId: input.sourceRunId,
        },
        create: {
          siteId: input.siteId,
          date: toDateOnly(row.date),
          visits: row.visits,
          users: row.users,
          pageviews: row.pageviews,
          bounceRate: row.bounceRate?.toString() ?? null,
          pageDepth: row.pageDepth?.toString() ?? null,
          averageVisitDurationSeconds: row.averageVisitDurationSeconds,
          goalReaches: row.goalReaches,
          uniqueTargetVisits: row.uniqueTargetVisits,
          uniqueTargetUsers: row.uniqueTargetUsers,
          allVisits: row.allVisits,
          conversionRate: row.conversionRate?.toString() ?? null,
          organizationId,
          sourceRunId: input.sourceRunId,
        },
      });
    }
  }

  async storeLandingPageMetrics(input: StoreLandingPageMetricsInput): Promise<void> {
    const organizationId = await this.getOrganizationIdForSite(input.siteId);
    for (const row of input.rows) {
      await getPrismaClient().landingPageDailyMetric.upsert({
        where: {
          siteId_periodKey_date_path: {
            siteId: input.siteId,
            periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey],
            date: toDateOnly(row.date),
            path: row.path,
          },
        },
        update: {
          visits: row.visits,
          users: row.users,
          pageviews: row.pageviews,
          bounceRate: row.bounceRate.toString(),
          pageDepth: row.pageDepth.toString(),
          averageVisitDurationSeconds: row.averageVisitDurationSeconds,
          goalReaches: row.goalReaches,
          targetVisits: row.targetVisits,
          conversionRate: row.conversionRate?.toString() ?? null,
          organizationId,
          sourceRunId: input.sourceRunId,
        },
        create: {
          siteId: input.siteId,
          periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey],
          date: toDateOnly(row.date),
          path: row.path,
          visits: row.visits,
          users: row.users,
          pageviews: row.pageviews,
          bounceRate: row.bounceRate.toString(),
          pageDepth: row.pageDepth.toString(),
          averageVisitDurationSeconds: row.averageVisitDurationSeconds,
          goalReaches: row.goalReaches,
          targetVisits: row.targetVisits,
          conversionRate: row.conversionRate?.toString() ?? null,
          organizationId,
          sourceRunId: input.sourceRunId,
        },
      });
    }
  }

  async storeMetrikaDeviceMetrics(input: StoreMetrikaDeviceMetricsInput): Promise<void> {
    const organizationId = await this.getOrganizationIdForSite(input.siteId);
    for (const row of input.rows) {
      await getPrismaClient().metrikaDeviceDailyMetric.upsert({
        where: {
          siteId_periodKey_date_device: {
            siteId: input.siteId,
            periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey],
            date: toDateOnly(row.date),
            device: row.device,
          },
        },
        update: {
          visits: row.visits,
          users: row.users,
          goalReaches: row.goalReaches,
          conversionRate: row.conversionRate?.toString() ?? null,
          organizationId,
          sourceRunId: input.sourceRunId,
        },
        create: {
          siteId: input.siteId,
          periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey],
          date: toDateOnly(row.date),
          device: row.device,
          visits: row.visits,
          users: row.users,
          goalReaches: row.goalReaches,
          conversionRate: row.conversionRate?.toString() ?? null,
          organizationId,
          sourceRunId: input.sourceRunId,
        },
      });
    }
  }

  async storeMetrikaGoalMetrics(input: StoreMetrikaGoalMetricsInput): Promise<void> {
    const organizationId = await this.getOrganizationIdForSite(input.siteId);
    for (const row of input.rows) {
      await getPrismaClient().metrikaGoalDailyMetric.upsert({
        where: {
          siteId_periodKey_date_externalGoalId: {
            siteId: input.siteId,
            periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey],
            date: toDateOnly(row.date),
            externalGoalId: row.externalGoalId,
          },
        },
        update: {
          name: row.name,
          category: PRISMA_GOAL_CATEGORY[row.category],
          direction: PRISMA_GOAL_DIRECTION[row.direction],
          reaches: row.reaches,
          visits: row.visits,
          users: row.users,
          conversionRate: row.conversionRate?.toString() ?? null,
          organizationId,
          sourceRunId: input.sourceRunId,
        },
        create: {
          siteId: input.siteId,
          periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey],
          date: toDateOnly(row.date),
          externalGoalId: row.externalGoalId,
          name: row.name,
          category: PRISMA_GOAL_CATEGORY[row.category],
          direction: PRISMA_GOAL_DIRECTION[row.direction],
          reaches: row.reaches,
          visits: row.visits,
          users: row.users,
          conversionRate: row.conversionRate?.toString() ?? null,
          organizationId,
          sourceRunId: input.sourceRunId,
        },
      });
    }
  }

  async storeRankingCaptures(input: StoreRankingCapturesInput): Promise<void> {
    const organizationIds = await Promise.all(
      input.rows.map((row) => this.getOrganizationIdForTrackedQuery(row.trackedQueryId)),
    );
    for (const [index, row] of input.rows.entries()) {
      const organizationId = organizationIds[index];
      if (!organizationId) throw new Error("TRACKED_QUERY_ORGANIZATION_MISSING");
      await getPrismaClient().rankingCapture.upsert({
        where: {
          trackedQueryId_capturedAt_source_engine_device_regionKey: {
            trackedQueryId: row.trackedQueryId,
            capturedAt: toDateTime(row.capturedAt),
            source: PRISMA_RANKING_SOURCE[row.source],
            engine: row.engine,
            device: row.device,
            regionKey: row.regionKey,
          },
        },
        update: {
          organizationId,
          position: row.position,
          sourceRunId: input.sourceRunId,
          engine: row.engine,
          device: row.device,
          regionKey: row.regionKey,
          regionName: row.regionName,
          relevantUrl: row.relevantUrl,
        },
        create: {
          organizationId,
          trackedQueryId: row.trackedQueryId,
          capturedAt: toDateTime(row.capturedAt),
          position: row.position,
          source: PRISMA_RANKING_SOURCE[row.source],
          sourceRunId: input.sourceRunId,
          engine: row.engine,
          device: row.device,
          regionKey: row.regionKey,
          regionName: row.regionName,
          relevantUrl: row.relevantUrl,
        },
      });
    }
  }

  async storeTechnicalSnapshots(input: StoreTechnicalSnapshotsInput): Promise<void> {
    const organizationId = await this.getOrganizationIdForSite(input.siteId);
    await getPrismaClient().technicalSnapshot.createMany({
      data: input.rows.map((row) => ({
        organizationId,
        siteId: input.siteId,
        sourceRunId: input.sourceRunId,
        capturedAt: toDateTime(row.capturedAt),
        kind: PRISMA_TECHNICAL_SNAPSHOT_KIND[row.kind],
        payload: row.payload as object,
      })),
    });
  }

  async listTrackedQueriesForSite(siteId: string): Promise<StoredTrackedQuerySetRecord> {
    const trackedQuerySet = await getPrismaClient().trackedQuerySet.findUnique({
      where: { siteId },
      select: {
        siteId: true,
        queries: {
          select: {
            id: true,
            normalizedQuery: true,
          },
        },
      },
    });

    return {
      siteId,
      rows:
        trackedQuerySet?.queries.map((row) => ({
          trackedQueryId: row.id,
          normalizedQuery: row.normalizedQuery,
        })) ?? [],
    };
  }

  async storeMetrikaSearchEngineMetrics(input: StoreMetrikaSearchEngineMetricsInput): Promise<void> {
    const organizationId = await this.getOrganizationIdForSite(input.siteId);
    for (const row of input.rows) await getPrismaClient().metrikaSearchEngineDailyMetric.upsert({
      where: { siteId_periodKey_date_engine: { siteId: input.siteId, periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey], date: toDateOnly(row.date), engine: row.engine } },
      update: { organizationId, visits: row.visits, users: row.users, goalReaches: row.goalReaches, uniqueTargetVisits: row.uniqueTargetVisits, conversionRate: row.conversionRate?.toString() ?? null, sourceRunId: input.sourceRunId },
      create: { organizationId, siteId: input.siteId, periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey], date: toDateOnly(row.date), engine: row.engine, visits: row.visits, users: row.users, goalReaches: row.goalReaches, uniqueTargetVisits: row.uniqueTargetVisits, conversionRate: row.conversionRate?.toString() ?? null, sourceRunId: input.sourceRunId },
    });
  }

  async storeMetrikaSearchPhraseMetrics(input: StoreMetrikaSearchPhraseMetricsInput): Promise<void> {
    const organizationId = await this.getOrganizationIdForSite(input.siteId);
    for (const row of input.rows) {
      const normalizedPhrase = row.phrase.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim();
      await getPrismaClient().metrikaSearchPhraseDailyMetric.upsert({
        where: { siteId_periodKey_date_engine_normalizedPhrase: { siteId: input.siteId, periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey], date: toDateOnly(row.date), engine: row.engine, normalizedPhrase } },
        update: { organizationId, phrase: row.phrase, visits: row.visits, users: row.users, goalReaches: row.goalReaches, uniqueTargetVisits: row.uniqueTargetVisits, sourceRunId: input.sourceRunId },
        create: { organizationId, siteId: input.siteId, periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey], date: toDateOnly(row.date), engine: row.engine, phrase: row.phrase, normalizedPhrase, visits: row.visits, users: row.users, goalReaches: row.goalReaches, uniqueTargetVisits: row.uniqueTargetVisits, sourceRunId: input.sourceRunId },
      });
    }
    if (input.rows.length > 0) {
      await getPrismaClient().providerOperation.updateMany({
        where: {
          siteId: input.siteId,
          provider: "TOPVISOR",
          operation: "RANK_CHECK",
          status: "STARTED",
        },
        data: { status: "COMPLETED", finishedAt: new Date() },
      });
    }
  }

  async storeMetrikaGeoMetrics(input: StoreMetrikaGeoMetricsInput): Promise<void> {
    const organizationId = await this.getOrganizationIdForSite(input.siteId);
    for (const row of input.rows) await getPrismaClient().metrikaGeoDailyMetric.upsert({
      where: { siteId_periodKey_date_regionKey: { siteId: input.siteId, periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey], date: toDateOnly(row.date), regionKey: row.regionKey } },
      update: { organizationId, regionName: row.regionName, visits: row.visits, users: row.users, goalReaches: row.goalReaches, uniqueTargetVisits: row.uniqueTargetVisits, sourceRunId: input.sourceRunId },
      create: { organizationId, siteId: input.siteId, periodKey: PRISMA_REPORT_PERIOD_BY_APP_PERIOD[input.periodKey], date: toDateOnly(row.date), regionKey: row.regionKey, regionName: row.regionName, visits: row.visits, users: row.users, goalReaches: row.goalReaches, uniqueTargetVisits: row.uniqueTargetVisits, sourceRunId: input.sourceRunId },
    });
  }

  async storeSyncNotification(input: Parameters<SyncRepository["storeSyncNotification"]>[0]): Promise<void> {
    const day = input.occurredAt.slice(0, 10);
    const dedupKey = input.trigger === "daily" ? `daily-sync:${input.projectId}:${day}` : `sync:${input.syncRunId}`;
    const statusText = input.status === "success" ? "завершено" : input.status === "partial" ? "завершено частично" : "не сформировано";
    await getPrismaClient().notification.upsert({
      where: { dedupKey },
      update: { severity: input.status === "success" ? "SUCCESS" : input.status === "partial" ? "WARNING" : "ERROR", title: `Обновление проекта ${statusText}`, message: input.safeErrorCode ? `Часть данных требует внимания. Код: ${input.safeErrorCode}` : "Данные отчётов обновлены.", occurredAt: new Date(input.occurredAt), sourceId: input.syncRunId },
      create: { organizationId: input.organizationId, projectId: input.projectId, category: "REPORT", severity: input.status === "success" ? "SUCCESS" : input.status === "partial" ? "WARNING" : "ERROR", visibility: "PLATFORM_TEAM", title: `Обновление проекта ${statusText}`, message: input.safeErrorCode ? `Часть данных требует внимания. Код: ${input.safeErrorCode}` : "Данные отчётов обновлены.", route: `/c/${input.projectSlug}/`, sourceType: "SyncRun", sourceId: input.syncRunId, dedupKey, occurredAt: new Date(input.occurredAt) },
    });
  }
}
