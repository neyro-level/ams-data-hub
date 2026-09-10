import type { ReportPeriodKey, SiteReportSnapshot } from "../../../../shared/schemas/report.ts";

export interface StoredReportSnapshotRecord {
  siteId: string;
  periodKey: ReportPeriodKey;
  generatedAt: string;
  freshness: "fresh" | "stale" | "partial" | "unavailable";
  payload: SiteReportSnapshot;
}

export interface DirectorAnalytics {
  engines: Array<{ engine: "YANDEX" | "GOOGLE"; visits: number; users: number; goalReaches: number; uniqueTargetVisits: number; conversionRate: number | null }>;
  phrases: Array<{ engine: "YANDEX" | "GOOGLE"; phrase: string; visits: number; goalReaches: number; uniqueTargetVisits: number }>;
  regions: Array<{ regionKey: string; regionName: string; visits: number; uniqueTargetVisits: number }>;
  webmasterQueries: Array<{ query: string; device: string; shows: number; clicks: number; ctr: number | null; averagePosition: number | null; demand: number | null; relevantUrl: string | null }>;
  competitors: Array<{ engine: "YANDEX" | "GOOGLE"; device: "DESKTOP" | "MOBILE"; regionName: string; domain: string; visibility: number | null; averagePosition: number | null; top3: number; top10: number; top30: number; top50: number; top100: number }>;
  competitorCapturedAt: string | null;
}

export interface ReportRepository {
  findLatestReportSnapshot(
    siteId: string,
    periodKey: ReportPeriodKey,
  ): Promise<StoredReportSnapshotRecord | null>;
  findDirectorAnalytics?(siteId: string, periodKey: ReportPeriodKey): Promise<DirectorAnalytics>;
}
