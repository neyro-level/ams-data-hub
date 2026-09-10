import {
  clientRegistrySchema,
  clusterProfileSchema,
  goalProfileSchema,
  thresholdsSchema,
  type ClientRegistry,
  type ClusterProfile,
  type GoalProfile,
  type ThresholdsConfig,
} from "../../../shared/schemas/registry.ts";
import {
  trackedQuerySetSchema,
  type TrackedQuerySet,
} from "../../../shared/schemas/tracked-query.ts";
import type {
  MonitoringProjectRecord,
  MonitoringProviderConnectionRecord,
  MonitoringRepository,
} from "./ports/monitoring-repository.ts";

export interface MonitoringProjectContext {
  projectId: string;
  organizationId: string;
  client: ClientRegistry;
  clusterProfile: ClusterProfile;
  goalProfile: GoalProfile;
  trackedQuerySets: TrackedQuerySet[];
  thresholds: ThresholdsConfig;
}

function findProviderConnection(
  providerConnections: MonitoringProviderConnectionRecord[],
  provider: MonitoringProviderConnectionRecord["provider"],
) {
  return providerConnections.find((connection) => connection.provider === provider) ?? null;
}

function readStringSetting(settingsJson: unknown, key: string): string | null {
  if (!settingsJson || typeof settingsJson !== "object" || !(key in settingsJson)) {
    return null;
  }

  const value = settingsJson[key as keyof typeof settingsJson];
  return typeof value === "string" ? value : null;
}

function readNumberSetting(settingsJson: unknown, key: string): number | null {
  if (!settingsJson || typeof settingsJson !== "object" || !(key in settingsJson)) {
    return null;
  }

  const value = settingsJson[key as keyof typeof settingsJson];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTopvisorTargets(settingsJson: unknown) {
  if (!settingsJson || typeof settingsJson !== "object" || !("targets" in settingsJson) || !Array.isArray(settingsJson.targets)) return [];
  return settingsJson.targets.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    return (row.engine === "YANDEX" || row.engine === "GOOGLE") && (row.device === "DESKTOP" || row.device === "MOBILE") && typeof row.regionKey === "number" && typeof row.regionIndex === "number" ? [{ engine: row.engine, device: row.device, regionKey: row.regionKey, regionIndex: row.regionIndex }] : [];
  });
}

function mapGoalCategory(category: string): GoalProfile["goals"][number]["category"] {
  switch (category) {
    case "LEAD_SUBMIT":
      return "lead_submit";
    case "PHONE_CLICK":
      return "phone_click";
    case "MESSENGER_CLICK":
      return "messenger_click";
    case "FORM_START":
      return "form_start";
    case "FILE_DOWNLOAD":
      return "file_download";
    default:
      return "other";
  }
}

function mapGoalDirection(direction: string): GoalProfile["goals"][number]["direction"] {
  return direction === "PRIMARY" ? "primary" : "secondary";
}

function buildSiteTopvisorConfig(providerConnections: MonitoringProviderConnectionRecord[]) {
  const topvisor = findProviderConnection(providerConnections, "TOPVISOR");
  return {
    enabled: Boolean(topvisor?.enabled && (topvisor.status === undefined || topvisor.status === "CONNECTED")),
    projectId: topvisor?.externalId ? Number(topvisor.externalId) : null,
    regionIndex: readNumberSetting(topvisor?.settingsJson ?? null, "regionIndex"),
    targets: readTopvisorTargets(topvisor?.settingsJson ?? null),
  };
}

function buildSiteMetricaConfig(providerConnections: MonitoringProviderConnectionRecord[]) {
  const metrica = findProviderConnection(providerConnections, "YANDEX_METRIKA");
  return {
    enabled: Boolean(metrica?.enabled && (metrica.status === undefined || metrica.status === "CONNECTED")),
    counterId: metrica?.externalId ?? null,
    goalProfile: readStringSetting(metrica?.settingsJson ?? null, "goalProfile"),
  };
}

function buildSiteWebmasterConfig(providerConnections: MonitoringProviderConnectionRecord[]) {
  const webmaster = findProviderConnection(providerConnections, "YANDEX_WEBMASTER");
  return {
    enabled: Boolean(webmaster?.enabled && (webmaster.status === undefined || webmaster.status === "CONNECTED")),
    expectedHostUrl:
      readStringSetting(webmaster?.settingsJson ?? null, "expectedHostUrl") ??
      webmaster?.externalId ??
      null,
  };
}

function buildClusterProfile(project: MonitoringProjectRecord): ClusterProfile {
  const firstBrandTerms = project.clusterGroups[0]?.brandTerms ?? [];
  return clusterProfileSchema.parse({
    schemaVersion: 1,
    profileSlug: project.clusterProfileSlug,
    name: project.clusterProfileName,
    brandTerms: firstBrandTerms,
    groups: [...project.clusterGroups]
      .sort((left, right) => left.order - right.order)
      .map((group) => ({
        slug: group.slug,
        label: group.label,
        terms: group.terms,
      })),
  });
}

function buildGoalProfile(project: MonitoringProjectRecord): GoalProfile {
  return goalProfileSchema.parse({
    schemaVersion: 1,
    clientSlug: project.projectSlug,
    goals: project.goalDefinitions.map((goal) => ({
      goalId: goal.externalGoalId,
      label: goal.label,
      category: mapGoalCategory(goal.category),
      direction: mapGoalDirection(goal.direction),
      includeInSeoConversion: goal.includeInSeoConversion,
      siteSlugs: goal.siteSlugs,
    })),
  });
}

function buildTrackedQuerySets(project: MonitoringProjectRecord): TrackedQuerySet[] {
  return project.trackedQuerySets.map((querySet) =>
    trackedQuerySetSchema.parse({
      schemaVersion: 1,
      clientSlug: project.projectSlug,
      siteSlug: querySet.siteSlug,
      source: "owner-provided",
      baselineLabel: querySet.baselineLabel,
      expectedCount: querySet.expectedCount,
      queries: querySet.queries.map((query) => ({
        query: query.query,
        position: {
          current: query.baselineCurrentPosition,
          baseline: query.baselinePreviousPosition,
          delta:
            query.baselineCurrentPosition !== null && query.baselinePreviousPosition !== null
              ? query.baselinePreviousPosition - query.baselineCurrentPosition
              : null,
        },
      })),
    }),
  );
}

function buildThresholds(project: MonitoringProjectRecord): ThresholdsConfig {
  return thresholdsSchema.parse({
    schemaVersion: 1,
    queryOpportunity: {
      minimumShows: project.threshold.minimumShows,
      maximumCtrPercent: project.threshold.maximumCtrPercent,
      maximumAveragePosition: project.threshold.maximumAveragePosition,
    },
    trendAlerts: {
      showsDropPercent: project.threshold.showsDropPercent,
      clicksDropPercent: project.threshold.clicksDropPercent,
      positionWorsenedDelta: project.threshold.positionWorsenedDelta,
      pagesInSearchDropPercent: project.threshold.pagesInSearchDropPercent,
      organicVisitsDropPercent: project.threshold.organicVisitsDropPercent,
      goalConversionDropPercent: project.threshold.goalConversionDropPercent,
    },
  });
}

function buildClientRegistry(project: MonitoringProjectRecord): ClientRegistry {
  return clientRegistrySchema.parse({
    schemaVersion: 1,
    clientSlug: project.projectSlug,
    name: project.name,
    enabled: project.enabled,
    clusterProfile: project.clusterProfileSlug,
    sites: project.sites.map((site) => ({
      siteSlug: site.siteSlug,
      name: site.name,
      siteUrl: site.siteUrl,
      timezone: site.timezone,
      enabled: site.enabled,
      webmaster: buildSiteWebmasterConfig(site.providerConnections),
      metrica: buildSiteMetricaConfig(site.providerConnections),
      topvisor: buildSiteTopvisorConfig(site.providerConnections),
    })),
  });
}

export class MonitoringService {
  constructor(private readonly monitoringRepository: MonitoringRepository) {}

  async ping(): Promise<void> {
    await this.monitoringRepository.ping();
  }

  async listActiveProjectSlugs(): Promise<string[]> {
    return this.monitoringRepository.listActiveProjectSlugs();
  }

  async getProjectContext(projectSlug: string): Promise<MonitoringProjectContext | null> {
    const project = await this.monitoringRepository.findProjectBySlug(projectSlug);
    if (!project) {
      return null;
    }

    return {
      projectId: project.projectId,
      organizationId: project.organizationId,
      client: buildClientRegistry(project),
      clusterProfile: buildClusterProfile(project),
      goalProfile: buildGoalProfile(project),
      trackedQuerySets: buildTrackedQuerySets(project),
      thresholds: buildThresholds(project),
    };
  }
}
