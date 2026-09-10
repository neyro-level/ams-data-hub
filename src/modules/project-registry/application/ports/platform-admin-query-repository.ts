import type {
  GoalCategory,
  GoalDefinitionListQuery,
  GoalDirection,
  Provider,
  ProviderConnectionListQuery,
  QueryClusterGroupInput,
  QueryClusterProfileListQuery,
  RankingSource,
  SiteListQuery,
  ThresholdProfileListQuery,
  TrackedQuerySetListQuery,
} from "../../domain/platform-admin.ts";
import type { ProjectReadScope } from "./project-query-repository.ts";

export type PlatformAdminReadScope = ProjectReadScope;

export interface SiteListItem {
  id: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  slug: string;
  name: string;
  url: string;
  timezone: string;
  enabled: boolean;
  version: number;
  updatedAt: string;
}

export interface ProviderConnectionListItem {
  id: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  siteId: string;
  siteName: string;
  siteSlug: string;
  provider: Provider;
  externalId: string | null;
  enabled: boolean;
  status: "PENDING" | "CONNECTING" | "CONNECTED" | "ACTION_REQUIRED" | "FAILED";
  statusCode: string | null;
  goalSuggestions: Array<{ category: "LEAD_SUBMIT" | "PHONE_CLICK"; candidates: Array<{ goalId: string; name: string }> }>;
  settingsJson: Record<string, string | number | boolean | null> | null;
  version: number;
  updatedAt: string;
}

export interface GoalDefinitionListItem {
  id: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  externalGoalId: string;
  label: string;
  category: GoalCategory;
  direction: GoalDirection;
  includeInSeoConversion: boolean;
  siteIds: string[];
  version: number;
  updatedAt: string;
}

export interface TrackedQuerySetListItem {
  id: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  siteId: string;
  siteName: string;
  siteSlug: string;
  source: RankingSource;
  baselineLabel: string;
  expectedCount: number;
  enabledQueryCount: number;
  queries: string[];
  version: number;
  updatedAt: string;
}

export interface ThresholdProfileListItem {
  id: string;
  slug: string;
  minimumShows: number;
  maximumCtrPercent: number;
  maximumAveragePosition: number;
  showsDropPercent: number;
  clicksDropPercent: number;
  positionWorsenedDelta: number;
  pagesInSearchDropPercent: number;
  organicVisitsDropPercent: number;
  goalConversionDropPercent: number;
  version: number;
  updatedAt: string;
}

export interface QueryClusterProfileListItem {
  id: string;
  slug: string;
  name: string;
  groups: QueryClusterGroupInput[];
  version: number;
  updatedAt: string;
}

export interface PlatformAdminListResult<TItem> {
  items: TItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProjectRegistryAdminFormOptions {
  projects: Array<{
    id: string;
    organizationId: string;
    label: string;
  }>;
  sites: Array<{
    id: string;
    projectId: string;
    organizationId: string;
    label: string;
  }>;
  thresholdProfiles: Array<{ id: string; label: string }>;
  clusterProfiles: Array<{ id: string; label: string }>;
}

export interface PlatformAdminQueryRepository {
  listSites(query: SiteListQuery): Promise<PlatformAdminListResult<SiteListItem>>;
  listProviderConnections(
    query: ProviderConnectionListQuery,
  ): Promise<PlatformAdminListResult<ProviderConnectionListItem>>;
  listGoalDefinitions(
    query: GoalDefinitionListQuery,
  ): Promise<PlatformAdminListResult<GoalDefinitionListItem>>;
  listTrackedQuerySets(
    query: TrackedQuerySetListQuery,
  ): Promise<PlatformAdminListResult<TrackedQuerySetListItem>>;
  listThresholdProfiles(
    query: ThresholdProfileListQuery,
  ): Promise<PlatformAdminListResult<ThresholdProfileListItem>>;
  listQueryClusterProfiles(
    query: QueryClusterProfileListQuery,
  ): Promise<PlatformAdminListResult<QueryClusterProfileListItem>>;
  listFormOptions(): Promise<ProjectRegistryAdminFormOptions>;
}
