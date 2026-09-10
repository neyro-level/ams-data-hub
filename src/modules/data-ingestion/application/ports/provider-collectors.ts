import type { MetricaAllowedGoal, MetricaSiteAudit } from "../../../../shared/schemas/metrica-source.ts";
import type { TopvisorSiteData } from "../../../../shared/schemas/rank-source.ts";
import type { SiteRegistry } from "../../../../shared/schemas/registry.ts";
import type { WebmasterSiteData } from "../../../../shared/schemas/webmaster-source.ts";

export interface WebmasterCollectOptions {
  queryLimit?: number;
  queryOrders?: Array<"TOTAL_SHOWS" | "TOTAL_CLICKS">;
  devices?: Array<"ALL" | "DESKTOP" | "MOBILE">;
  historyDateFrom?: string;
  historyDateTo?: string;
  queryDateFrom?: string;
  queryDateTo?: string;
  includeTechnicalDetails?: boolean;
}

export interface MetricaCollectOptions {
  date1?: string;
  date2?: string;
  landingLimit?: number;
  includeDetails?: boolean;
  allowedGoals?: MetricaAllowedGoal[];
  timezone?: string;
}

export interface TopvisorCollectOptions {
  dateFrom: string;
  dateTo: string;
}

export interface SiteSourceCollectors {
  webmaster: (
    site: SiteRegistry,
    options?: WebmasterCollectOptions,
  ) => Promise<WebmasterSiteData>;
  metrica: (
    site: SiteRegistry,
    options?: MetricaCollectOptions,
  ) => Promise<MetricaSiteAudit>;
  topvisor?: (
    site: SiteRegistry,
    options: TopvisorCollectOptions,
  ) => Promise<TopvisorSiteData>;
}
