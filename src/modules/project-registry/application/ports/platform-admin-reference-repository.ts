import type {
  CreateGoalDefinitionInput,
  ConfirmMetricaGoalsInput,
  CreateProviderConnectionInput,
  CreateQueryClusterProfileInput,
  CreateSiteInput,
  CreateThresholdProfileInput,
  CreateTrackedQuerySetInput,
  GoalCategory,
  GoalDirection,
  Provider,
  QueryClusterGroupInput,
  RankingSource,
  UpdateGoalDefinitionInput,
  UpdateProviderConnectionInput,
  UpdateQueryClusterProfileInput,
  UpdateSiteInput,
  UpdateThresholdProfileInput,
  UpdateTrackedQuerySetInput,
} from "../../domain/platform-admin.ts";

export type PlatformAdminJsonValue =
  | string
  | number
  | boolean
  | null
  | PlatformAdminJsonValue[]
  | { [key: string]: PlatformAdminJsonValue };

export interface PlatformAdminAuditInput {
  actorId: string;
  organizationId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeMarker: { [key: string]: PlatformAdminJsonValue } | null;
  afterMarker: { [key: string]: PlatformAdminJsonValue };
  correlationId: string;
}

export interface ProjectParentRecord {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
}

export interface SiteActionRecord {
  id: string;
  organizationId: string;
  projectId: string;
  slug: string;
  name: string;
  url: string;
  timezone: string;
  enabled: boolean;
  version: number;
}

export interface SiteOptionRecord {
  id: string;
  organizationId: string;
  projectId: string;
}

export interface ProviderConnectionActionRecord {
  id: string;
  organizationId: string;
  siteId: string;
  projectId: string;
  provider: Provider;
  externalId: string | null;
  enabled: boolean;
  settingsJson: Record<string, string | number | boolean | null> | null;
  version: number;
}

export interface GoalDefinitionActionRecord {
  id: string;
  organizationId: string;
  projectId: string;
  externalGoalId: string;
  label: string;
  category: GoalCategory;
  direction: GoalDirection;
  includeInSeoConversion: boolean;
  siteIds: string[];
  version: number;
}

export interface TrackedQuerySetActionRecord {
  id: string;
  organizationId: string;
  siteId: string;
  source: RankingSource;
  baselineLabel: string;
  expectedCount: number;
  version: number;
  queries: string[];
}

export interface ThresholdProfileActionRecord {
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
}

export interface QueryClusterProfileActionRecord {
  id: string;
  slug: string;
  name: string;
  groups: QueryClusterGroupInput[];
  version: number;
}

export interface PlatformAdminReferenceRepository {
  findProjectParent(projectId: string): Promise<ProjectParentRecord | null>;
  findSiteForAction(siteId: string): Promise<SiteActionRecord | null>;
  createSite(input: CreateSiteInput, organizationId: string): Promise<{ id: string; version: number }>;
  updateSite(input: UpdateSiteInput, organizationId: string): Promise<boolean>;
  findProviderConnectionForAction(id: string): Promise<ProviderConnectionActionRecord | null>;
  createProviderConnection(
    input: CreateProviderConnectionInput,
    organizationId: string,
  ): Promise<{ id: string; version: number }>;
  updateProviderConnection(
    input: UpdateProviderConnectionInput,
    organizationId: string,
  ): Promise<boolean>;
  confirmMetricaGoals(
    input: ConfirmMetricaGoalsInput,
    organizationId: string,
  ): Promise<{ projectId: string; connectionId: string }>;
  findGoalDefinitionForAction(id: string): Promise<GoalDefinitionActionRecord | null>;
  createGoalDefinition(
    input: CreateGoalDefinitionInput,
    organizationId: string,
  ): Promise<{ id: string; version: number }>;
  updateGoalDefinition(
    input: UpdateGoalDefinitionInput,
    organizationId: string,
  ): Promise<boolean>;
  replaceGoalDefinitionSiteScopes(
    goalDefinitionId: string,
    organizationId: string,
    siteIds: string[],
  ): Promise<void>;
  assertProjectSiteScope(projectId: string, organizationId: string, siteIds: string[]): Promise<void>;
  findTrackedQuerySetForAction(id: string): Promise<TrackedQuerySetActionRecord | null>;
  createTrackedQuerySet(
    input: CreateTrackedQuerySetInput,
    organizationId: string,
  ): Promise<{ id: string; version: number }>;
  updateTrackedQuerySet(
    input: UpdateTrackedQuerySetInput,
    organizationId: string,
  ): Promise<boolean>;
  replaceTrackedQueries(
    trackedQuerySetId: string,
    organizationId: string,
    queries: string[],
  ): Promise<void>;
  findThresholdProfileForAction(id: string): Promise<ThresholdProfileActionRecord | null>;
  createThresholdProfile(input: CreateThresholdProfileInput): Promise<{ id: string; version: number }>;
  updateThresholdProfile(input: UpdateThresholdProfileInput): Promise<boolean>;
  findQueryClusterProfileForAction(id: string): Promise<QueryClusterProfileActionRecord | null>;
  createQueryClusterProfile(
    input: CreateQueryClusterProfileInput,
  ): Promise<{ id: string; version: number }>;
  updateQueryClusterProfile(input: UpdateQueryClusterProfileInput): Promise<boolean>;
  replaceQueryClusterGroups(profileId: string, groups: QueryClusterGroupInput[]): Promise<void>;
  appendAudit(input: PlatformAdminAuditInput): Promise<void>;
}
