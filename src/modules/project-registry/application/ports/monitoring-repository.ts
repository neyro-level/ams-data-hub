export interface MonitoringProviderConnectionRecord {
  provider: "YANDEX_WEBMASTER" | "YANDEX_METRIKA" | "TOPVISOR";
  externalId: string | null;
  enabled: boolean;
  status?: "PENDING" | "CONNECTING" | "CONNECTED" | "ACTION_REQUIRED" | "FAILED";
  settingsJson: unknown;
}

export interface MonitoringSiteRecord {
  siteSlug: string;
  name: string;
  siteUrl: string;
  timezone: string;
  enabled: boolean;
  providerConnections: MonitoringProviderConnectionRecord[];
}

export interface MonitoringGoalDefinitionRecord {
  externalGoalId: string;
  label: string;
  category:
    | "LEAD_SUBMIT"
    | "PHONE_CLICK"
    | "MESSENGER_CLICK"
    | "FORM_START"
    | "FILE_DOWNLOAD"
    | "OTHER";
  direction: "PRIMARY" | "SECONDARY";
  includeInSeoConversion: boolean;
  siteSlugs: string[];
}

export interface MonitoringTrackedQueryRecord {
  query: string;
  baselineCurrentPosition: number | null;
  baselinePreviousPosition: number | null;
}

export interface MonitoringTrackedQuerySetRecord {
  siteSlug: string;
  baselineLabel: string;
  expectedCount: number;
  queries: MonitoringTrackedQueryRecord[];
}

export interface MonitoringClusterGroupRecord {
  slug: string;
  label: string;
  order: number;
  brandTerms: string[];
  terms: string[];
}

export interface MonitoringThresholdRecord {
  minimumShows: number;
  maximumCtrPercent: number;
  maximumAveragePosition: number;
  showsDropPercent: number;
  clicksDropPercent: number;
  positionWorsenedDelta: number;
  pagesInSearchDropPercent: number;
  organicVisitsDropPercent: number;
  goalConversionDropPercent: number;
}

export interface MonitoringProjectRecord {
  projectId: string;
  organizationId: string;
  projectSlug: string;
  name: string;
  enabled: boolean;
  clusterProfileSlug: string;
  clusterProfileName: string;
  clusterGroups: MonitoringClusterGroupRecord[];
  threshold: MonitoringThresholdRecord;
  sites: MonitoringSiteRecord[];
  goalDefinitions: MonitoringGoalDefinitionRecord[];
  trackedQuerySets: MonitoringTrackedQuerySetRecord[];
}

export interface MonitoringRepository {
  ping(): Promise<void>;
  listActiveProjectSlugs(): Promise<string[]>;
  findProjectBySlug(projectSlug: string): Promise<MonitoringProjectRecord | null>;
}
