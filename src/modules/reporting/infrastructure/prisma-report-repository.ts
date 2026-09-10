
import type {
  ReportRepository,
  StoredReportSnapshotRecord,
} from "../application/ports/report-repository.ts";
import {
  reportPeriodKeySchema,
  siteReportSnapshotSchema,
  type ReportPeriodKey,
} from "../../../shared/schemas/report.ts";
import { getPrismaClient } from "../../../platform/database/prisma/client.ts";

const PRISMA_PERIOD_KEY_BY_APP_PERIOD: Record<ReportPeriodKey, "WEEK" | "MONTH" | "QUARTER" | "HALF_YEAR"> = {
  week: "WEEK",
  month: "MONTH",
  quarter: "QUARTER",
  halfYear: "HALF_YEAR",
};

const APP_PERIOD_KEY_BY_PRISMA_PERIOD = {
  WEEK: "week",
  MONTH: "month",
  QUARTER: "quarter",
  HALF_YEAR: "halfYear",
} as const satisfies Record<"WEEK" | "MONTH" | "QUARTER" | "HALF_YEAR", ReportPeriodKey>;

const APP_FRESHNESS_BY_PRISMA_FRESHNESS = {
  FRESH: "fresh",
  STALE: "stale",
  PARTIAL: "partial",
  UNAVAILABLE: "unavailable",
} as const;

export class PrismaReportRepository implements ReportRepository {
  async findLatestReportSnapshot(
    siteId: string,
    periodKey: ReportPeriodKey,
  ): Promise<StoredReportSnapshotRecord | null> {
    const report = await getPrismaClient().reportSnapshot.findFirst({
      where: {
        siteId,
        periodKey: PRISMA_PERIOD_KEY_BY_APP_PERIOD[periodKey],
      },
      orderBy: {
        generatedAt: "desc",
      },
      select: {
        siteId: true,
        periodKey: true,
        generatedAt: true,
        freshness: true,
        payload: true,
      },
    });

    if (!report) {
      return null;
    }

    const normalizedPeriodKey = reportPeriodKeySchema.parse(
      APP_PERIOD_KEY_BY_PRISMA_PERIOD[report.periodKey],
    );

    return {
      siteId: report.siteId,
      periodKey: normalizedPeriodKey,
      generatedAt: report.generatedAt.toISOString(),
      freshness: APP_FRESHNESS_BY_PRISMA_FRESHNESS[report.freshness],
      payload: siteReportSnapshotSchema.parse(report.payload),
    };
  }

  async findDirectorAnalytics(siteId: string, periodKey: ReportPeriodKey) {
    const prismaPeriod = PRISMA_PERIOD_KEY_BY_APP_PERIOD[periodKey];
    const prisma = getPrismaClient();
    const [engineDate, phraseDate, regionDate, webmasterDate, competitorDate] = await Promise.all([
      prisma.metrikaSearchEngineDailyMetric.findFirst({ where: { siteId, periodKey: prismaPeriod }, orderBy: { date: "desc" }, select: { date: true } }),
      prisma.metrikaSearchPhraseDailyMetric.findFirst({ where: { siteId, periodKey: prismaPeriod }, orderBy: { date: "desc" }, select: { date: true } }),
      prisma.metrikaGeoDailyMetric.findFirst({ where: { siteId, periodKey: prismaPeriod }, orderBy: { date: "desc" }, select: { date: true } }),
      prisma.webmasterQueryDailyMetric.findFirst({ where: { siteId, periodKey: prismaPeriod }, orderBy: { date: "desc" }, select: { date: true } }),
      prisma.competitorSnapshot.findFirst({ where: { siteId }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
    ]);
    const [engines, phrases, regions, webmasterQueries, competitors] = await Promise.all([
      engineDate ? prisma.metrikaSearchEngineDailyMetric.findMany({ where: { siteId, periodKey: prismaPeriod, date: engineDate.date }, orderBy: { engine: "asc" } }) : [],
      phraseDate ? prisma.metrikaSearchPhraseDailyMetric.findMany({ where: { siteId, periodKey: prismaPeriod, date: phraseDate.date }, orderBy: { visits: "desc" }, take: 100 }) : [],
      regionDate ? prisma.metrikaGeoDailyMetric.findMany({ where: { siteId, periodKey: prismaPeriod, date: regionDate.date }, orderBy: { visits: "desc" }, take: 5 }) : [],
      webmasterDate ? prisma.webmasterQueryDailyMetric.findMany({ where: { siteId, periodKey: prismaPeriod, date: webmasterDate.date, orderBy: "TOTAL_SHOWS", device: { in: ["ALL", "DESKTOP", "MOBILE"] } }, orderBy: { shows: "desc" }, take: 100 }) : [],
      competitorDate ? prisma.competitorSnapshot.findMany({ where: { siteId, capturedAt: competitorDate.capturedAt }, orderBy: [{ engine: "asc" }, { device: "asc" }, { visibility: "desc" }] }) : [],
    ]);
    return {
      engines: engines.map((row) => ({ engine: row.engine, visits: row.visits, users: row.users, goalReaches: row.goalReaches, uniqueTargetVisits: row.uniqueTargetVisits, conversionRate: row.conversionRate === null ? null : Number(row.conversionRate) })),
      phrases: phrases.map((row) => ({ engine: row.engine, phrase: row.phrase, visits: row.visits, goalReaches: row.goalReaches, uniqueTargetVisits: row.uniqueTargetVisits })),
      regions: regions.map((row) => ({ regionKey: row.regionKey, regionName: row.regionName, visits: row.visits, uniqueTargetVisits: row.uniqueTargetVisits })),
      webmasterQueries: webmasterQueries.map((row) => ({ query: row.query, device: row.device, shows: Number(row.shows), clicks: Number(row.clicks), ctr: row.ctr === null ? null : Number(row.ctr), averagePosition: row.averagePosition === null ? null : Number(row.averagePosition), demand: row.demand === null ? null : Number(row.demand), relevantUrl: row.relevantUrl })),
      competitors: competitors.map((row) => ({ engine: row.engine, device: row.device, regionName: row.regionName, domain: row.domain, visibility: row.visibility === null ? null : Number(row.visibility), averagePosition: row.averagePosition === null ? null : Number(row.averagePosition), top3: row.top3, top10: row.top10, top30: row.top30, top50: row.top50, top100: row.top100 })),
      competitorCapturedAt: competitorDate?.capturedAt.toISOString() ?? null,
    };
  }
}
