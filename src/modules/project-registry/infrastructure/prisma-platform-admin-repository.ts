import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { getPrismaClient } from "../../../platform/database/prisma/client.ts";
import {
  normalizeTrackedQuery,
  ProjectRegistryAdminError,
  type CreateGoalDefinitionInput,
  type ConfirmMetricaGoalsInput,
  type CreateProviderConnectionInput,
  type CreateQueryClusterProfileInput,
  type CreateSiteInput,
  type CreateThresholdProfileInput,
  type CreateTrackedQuerySetInput,
  type UpdateGoalDefinitionInput,
  type UpdateProviderConnectionInput,
  type UpdateQueryClusterProfileInput,
  type UpdateSiteInput,
  type UpdateThresholdProfileInput,
  type UpdateTrackedQuerySetInput,
} from "../domain/platform-admin.ts";
import type {
  PlatformAdminQueryRepository,
  ProjectRegistryAdminFormOptions,
  PlatformAdminListResult,
  SiteListItem,
  ProviderConnectionListItem,
  GoalDefinitionListItem,
  TrackedQuerySetListItem,
  ThresholdProfileListItem,
  QueryClusterProfileListItem,
} from "../application/ports/platform-admin-query-repository.ts";
import type {
  PlatformAdminAuditInput,
  PlatformAdminReferenceRepository,
} from "../application/ports/platform-admin-reference-repository.ts";

const siteListSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  slug: true,
  name: true,
  url: true,
  timezone: true,
  enabled: true,
  version: true,
  updatedAt: true,
  project: { select: { name: true, slug: true } },
} satisfies Prisma.SiteSelect;

const providerListSelect = {
  id: true,
  organizationId: true,
  siteId: true,
  provider: true,
  externalId: true,
  enabled: true,
  status: true,
  statusCode: true,
  settingsJson: true,
  version: true,
  updatedAt: true,
  site: { select: { id: true, name: true, slug: true, project: { select: { id: true, name: true } } } },
} satisfies Prisma.ProviderConnectionSelect;

const goalListSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  externalGoalId: true,
  label: true,
  category: true,
  direction: true,
  includeInSeoConversion: true,
  version: true,
  updatedAt: true,
  project: { select: { name: true, slug: true } },
  siteScopes: { select: { siteId: true } },
} satisfies Prisma.GoalDefinitionSelect;

const trackedQuerySetSelect = {
  id: true,
  organizationId: true,
  siteId: true,
  source: true,
  baselineLabel: true,
  expectedCount: true,
  version: true,
  updatedAt: true,
  site: { select: { id: true, name: true, slug: true, project: { select: { id: true, name: true } } } },
  queries: {
    where: { enabled: true },
    orderBy: { normalizedQuery: "asc" },
    select: { query: true },
  },
} satisfies Prisma.TrackedQuerySetSelect;

const thresholdProfileSelect = {
  id: true,
  slug: true,
  minimumShows: true,
  maximumCtrPercent: true,
  maximumAveragePosition: true,
  showsDropPercent: true,
  clicksDropPercent: true,
  positionWorsenedDelta: true,
  pagesInSearchDropPercent: true,
  organicVisitsDropPercent: true,
  goalConversionDropPercent: true,
  version: true,
  updatedAt: true,
} satisfies Prisma.ThresholdProfileSelect;

const clusterProfileSelect = {
  id: true,
  slug: true,
  name: true,
  version: true,
  updatedAt: true,
  groups: {
    orderBy: { order: "asc" },
    select: {
      slug: true,
      label: true,
      order: true,
      brandTermsJson: true,
      termsJson: true,
    },
  },
} satisfies Prisma.QueryClusterProfileSelect;

type PrismaStore = PrismaClient | DatabaseTransaction;
type SelectedSite = Prisma.SiteGetPayload<{ select: typeof siteListSelect }>;
type SelectedProvider = Prisma.ProviderConnectionGetPayload<{ select: typeof providerListSelect }>;
type SelectedGoal = Prisma.GoalDefinitionGetPayload<{ select: typeof goalListSelect }>;
type SelectedTracked = Prisma.TrackedQuerySetGetPayload<{ select: typeof trackedQuerySetSelect }>;
type SelectedThreshold = Prisma.ThresholdProfileGetPayload<{ select: typeof thresholdProfileSelect }>;
type SelectedCluster = Prisma.QueryClusterProfileGetPayload<{ select: typeof clusterProfileSelect }>;

function toPage<TItem>(items: TItem[], total: number, page: number, pageSize: number): PlatformAdminListResult<TItem> {
  return { items, total, page, pageSize };
}

function decimal(value: Prisma.Decimal): number {
  return Number(value);
}

function asSettingsJson(value: Prisma.JsonValue | null): Record<string, string | number | boolean | null> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, string | number | boolean | null>;
}

function readGoalSuggestions(value: Prisma.JsonValue | null): ProviderConnectionListItem["goalSuggestions"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const raw = (value as { goalSuggestions?: unknown }).goalSuggestions;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as { category?: unknown; candidates?: unknown };
    if (row.category !== "LEAD_SUBMIT" && row.category !== "PHONE_CLICK") return [];
    const candidates = Array.isArray(row.candidates) ? row.candidates.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
      const goal = candidate as { goalId?: unknown; name?: unknown };
      return typeof goal.goalId === "string" && typeof goal.name === "string" ? [{ goalId: goal.goalId, name: goal.name }] : [];
    }) : [];
    return [{ category: row.category, candidates }];
  });
}

function asStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toSiteListItem(site: SelectedSite): SiteListItem {
  return {
    id: site.id,
    organizationId: site.organizationId,
    projectId: site.projectId,
    projectName: site.project.name,
    projectSlug: site.project.slug,
    slug: site.slug,
    name: site.name,
    url: site.url,
    timezone: site.timezone,
    enabled: site.enabled,
    version: site.version,
    updatedAt: site.updatedAt.toISOString(),
  };
}

function toProviderListItem(item: SelectedProvider): ProviderConnectionListItem {
  return {
    id: item.id,
    organizationId: item.organizationId,
    projectId: item.site.project.id,
    projectName: item.site.project.name,
    siteId: item.siteId,
    siteName: item.site.name,
    siteSlug: item.site.slug,
    provider: item.provider,
    externalId: item.externalId,
    enabled: item.enabled,
    status: item.status,
    statusCode: item.statusCode,
    goalSuggestions: readGoalSuggestions(item.settingsJson),
    settingsJson: asSettingsJson(item.settingsJson),
    version: item.version,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function toGoalListItem(item: SelectedGoal): GoalDefinitionListItem {
  return {
    id: item.id,
    organizationId: item.organizationId,
    projectId: item.projectId,
    projectName: item.project.name,
    projectSlug: item.project.slug,
    externalGoalId: item.externalGoalId,
    label: item.label,
    category: item.category,
    direction: item.direction,
    includeInSeoConversion: item.includeInSeoConversion,
    siteIds: item.siteScopes.map((scope) => scope.siteId),
    version: item.version,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function toTrackedQuerySetListItem(item: SelectedTracked): TrackedQuerySetListItem {
  return {
    id: item.id,
    organizationId: item.organizationId,
    projectId: item.site.project.id,
    projectName: item.site.project.name,
    siteId: item.siteId,
    siteName: item.site.name,
    siteSlug: item.site.slug,
    source: item.source,
    baselineLabel: item.baselineLabel,
    expectedCount: item.expectedCount,
    enabledQueryCount: item.queries.length,
    queries: item.queries.map((query) => query.query),
    version: item.version,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function toThresholdProfileListItem(item: SelectedThreshold): ThresholdProfileListItem {
  return {
    id: item.id,
    slug: item.slug,
    minimumShows: item.minimumShows,
    maximumCtrPercent: decimal(item.maximumCtrPercent),
    maximumAveragePosition: decimal(item.maximumAveragePosition),
    showsDropPercent: decimal(item.showsDropPercent),
    clicksDropPercent: decimal(item.clicksDropPercent),
    positionWorsenedDelta: decimal(item.positionWorsenedDelta),
    pagesInSearchDropPercent: decimal(item.pagesInSearchDropPercent),
    organicVisitsDropPercent: decimal(item.organicVisitsDropPercent),
    goalConversionDropPercent: decimal(item.goalConversionDropPercent),
    version: item.version,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function toQueryClusterProfileListItem(item: SelectedCluster): QueryClusterProfileListItem {
  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    groups: item.groups.map((group) => ({
      slug: group.slug,
      label: group.label,
      order: group.order,
      brandTerms: asStringArray(group.brandTermsJson),
      terms: asStringArray(group.termsJson),
    })),
    version: item.version,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : "";
      if (target.includes("siteId") && target.includes("provider")) {
        throw new ProjectRegistryAdminError("PROVIDER_CONNECTION_CONFLICT");
      }
      if (target.includes("siteId")) {
        throw new ProjectRegistryAdminError("TRACKED_QUERY_SET_CONFLICT");
      }
      if (target.includes("slug")) {
        if (target.includes("ThresholdProfile")) {
          throw new ProjectRegistryAdminError("THRESHOLD_PROFILE_SLUG_CONFLICT");
        }
        if (target.includes("QueryClusterProfile")) {
          throw new ProjectRegistryAdminError("QUERY_CLUSTER_PROFILE_SLUG_CONFLICT");
        }
        throw new ProjectRegistryAdminError("SITE_CONFLICT");
      }
      if (target.includes("externalGoalId")) {
        throw new ProjectRegistryAdminError("GOAL_DEFINITION_CONFLICT");
      }
      throw new ProjectRegistryAdminError("SITE_CONFLICT");
    }
    if (error.code === "P2003") {
      throw new ProjectRegistryAdminError("SITE_REFERENCE_INVALID");
    }
  }
  throw error;
}

export class PrismaProjectRegistryAdminRepository
  implements PlatformAdminQueryRepository, PlatformAdminReferenceRepository {
  constructor(private readonly injectedPrisma?: PrismaStore) {}

  private get prisma(): PrismaStore {
    return this.injectedPrisma ?? getPrismaClient();
  }
  async listSites(query: Parameters<PlatformAdminQueryRepository["listSites"]>[0]) {
    const where: Prisma.SiteWhereInput = {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.enabled === null ? {} : { enabled: query.enabled }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { slug: { contains: query.search, mode: "insensitive" } },
              { url: { contains: query.search, mode: "insensitive" } },
              { project: { name: { contains: query.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.SiteOrderByWithRelationInput =
      query.sort === "slug"
        ? { slug: query.direction }
        : query.sort === "name"
          ? { name: query.direction }
          : { updatedAt: query.direction };
    const [items, total] = await Promise.all([
      this.prisma.site.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: siteListSelect,
      }),
      this.prisma.site.count({ where }),
    ]);
    return toPage(items.map(toSiteListItem), total, query.page, query.pageSize);
  }

  async listProviderConnections(query: Parameters<PlatformAdminQueryRepository["listProviderConnections"]>[0]) {
    const where: Prisma.ProviderConnectionWhereInput = {
      ...(query.siteId ? { siteId: query.siteId } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.enabled === null ? {} : { enabled: query.enabled }),
      ...(query.search
        ? {
            OR: [
              { externalId: { contains: query.search, mode: "insensitive" } },
              { site: { name: { contains: query.search, mode: "insensitive" } } },
              { site: { project: { name: { contains: query.search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.ProviderConnectionOrderByWithRelationInput =
      query.sort === "provider" ? { provider: query.direction } : { updatedAt: query.direction };
    const [items, total] = await Promise.all([
      this.prisma.providerConnection.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: providerListSelect,
      }),
      this.prisma.providerConnection.count({ where }),
    ]);
    return toPage(items.map(toProviderListItem), total, query.page, query.pageSize);
  }

  async listGoalDefinitions(query: Parameters<PlatformAdminQueryRepository["listGoalDefinitions"]>[0]) {
    const where: Prisma.GoalDefinitionWhereInput = {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.includeInSeoConversion === null ? {} : { includeInSeoConversion: query.includeInSeoConversion }),
      ...(query.category ? { category: query.category } : {}),
      ...(query.search
        ? {
            OR: [
              { label: { contains: query.search, mode: "insensitive" } },
              { externalGoalId: { contains: query.search, mode: "insensitive" } },
              { project: { name: { contains: query.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.GoalDefinitionOrderByWithRelationInput =
      query.sort === "label"
        ? { label: query.direction }
        : query.sort === "externalGoalId"
          ? { externalGoalId: query.direction }
          : { updatedAt: query.direction };
    const [items, total] = await Promise.all([
      this.prisma.goalDefinition.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: goalListSelect,
      }),
      this.prisma.goalDefinition.count({ where }),
    ]);
    return toPage(items.map(toGoalListItem), total, query.page, query.pageSize);
  }

  async listTrackedQuerySets(query: Parameters<PlatformAdminQueryRepository["listTrackedQuerySets"]>[0]) {
    const where: Prisma.TrackedQuerySetWhereInput = {
      ...(query.siteId ? { siteId: query.siteId } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.search
        ? {
            OR: [
              { baselineLabel: { contains: query.search, mode: "insensitive" } },
              { site: { name: { contains: query.search, mode: "insensitive" } } },
              { site: { project: { name: { contains: query.search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.TrackedQuerySetOrderByWithRelationInput =
      query.sort === "baselineLabel"
        ? { baselineLabel: query.direction }
        : query.sort === "expectedCount"
          ? { expectedCount: query.direction }
          : { updatedAt: query.direction };
    const [items, total] = await Promise.all([
      this.prisma.trackedQuerySet.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: trackedQuerySetSelect,
      }),
      this.prisma.trackedQuerySet.count({ where }),
    ]);
    return toPage(items.map(toTrackedQuerySetListItem), total, query.page, query.pageSize);
  }

  async listThresholdProfiles(query: Parameters<PlatformAdminQueryRepository["listThresholdProfiles"]>[0]) {
    const where: Prisma.ThresholdProfileWhereInput = query.search
      ? { slug: { contains: query.search, mode: "insensitive" } }
      : {};
    const orderBy: Prisma.ThresholdProfileOrderByWithRelationInput =
      query.sort === "slug" ? { slug: query.direction } : { updatedAt: query.direction };
    const [items, total] = await Promise.all([
      this.prisma.thresholdProfile.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: thresholdProfileSelect,
      }),
      this.prisma.thresholdProfile.count({ where }),
    ]);
    return toPage(items.map(toThresholdProfileListItem), total, query.page, query.pageSize);
  }

  async listQueryClusterProfiles(query: Parameters<PlatformAdminQueryRepository["listQueryClusterProfiles"]>[0]) {
    const where: Prisma.QueryClusterProfileWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { slug: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {};
    const orderBy: Prisma.QueryClusterProfileOrderByWithRelationInput =
      query.sort === "slug"
        ? { slug: query.direction }
        : query.sort === "name"
          ? { name: query.direction }
          : { updatedAt: query.direction };
    const [items, total] = await Promise.all([
      this.prisma.queryClusterProfile.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: clusterProfileSelect,
      }),
      this.prisma.queryClusterProfile.count({ where }),
    ]);
    return toPage(items.map(toQueryClusterProfileListItem), total, query.page, query.pageSize);
  }

  async listFormOptions(): Promise<ProjectRegistryAdminFormOptions> {
    const [projects, sites, thresholdProfiles, clusterProfiles] = await Promise.all([
      this.prisma.project.findMany({
        orderBy: [{ organization: { name: "asc" } }, { name: "asc" }],
        select: { id: true, organizationId: true, name: true },
      }),
      this.prisma.site.findMany({
        orderBy: [{ project: { name: "asc" } }, { name: "asc" }],
        select: { id: true, projectId: true, organizationId: true, name: true, project: { select: { name: true } } },
      }),
      this.prisma.thresholdProfile.findMany({ orderBy: { slug: "asc" }, select: { id: true, slug: true } }),
      this.prisma.queryClusterProfile.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);

    return {
      projects: projects.map((project) => ({
        id: project.id,
        organizationId: project.organizationId,
        label: project.name,
      })),
      sites: sites.map((site) => ({
        id: site.id,
        projectId: site.projectId,
        organizationId: site.organizationId,
        label: `${site.project.name} · ${site.name}`,
      })),
      thresholdProfiles: thresholdProfiles.map((profile) => ({ id: profile.id, label: profile.slug })),
      clusterProfiles: clusterProfiles.map((profile) => ({ id: profile.id, label: profile.name })),
    };
  }

  findProjectParent(projectId: string) {
    return this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, organizationId: true, slug: true, name: true },
    });
  }

  findSiteForAction(siteId: string) {
    return this.prisma.site.findUnique({
      where: { id: siteId },
      select: {
        id: true,
        organizationId: true,
        projectId: true,
        slug: true,
        name: true,
        url: true,
        timezone: true,
        enabled: true,
        version: true,
      },
    });
  }

  async createSite(input: CreateSiteInput, organizationId: string) {
    try {
      return await this.prisma.site.create({
        data: {
          organizationId,
          projectId: input.projectId,
          slug: input.slug,
          name: input.name,
          url: input.url,
          timezone: input.timezone,
          enabled: input.enabled,
        },
        select: { id: true, version: true },
      });
    } catch (error) {
      translateWriteError(error);
    }
  }

  async updateSite(input: UpdateSiteInput, organizationId: string): Promise<boolean> {
    try {
      const result = await this.prisma.site.updateMany({
        where: { id: input.id, organizationId, version: input.version },
        data: {
          slug: input.slug,
          name: input.name,
          url: input.url,
          timezone: input.timezone,
          enabled: input.enabled,
          version: { increment: 1 },
        },
      });
      return result.count === 1;
    } catch (error) {
      translateWriteError(error);
    }
  }

  findProviderConnectionForAction(id: string) {
    return this.prisma.providerConnection.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        siteId: true,
        site: { select: { projectId: true } },
        provider: true,
        externalId: true,
        enabled: true,
        settingsJson: true,
        version: true,
      },
    }).then((record) => record ? {
      id: record.id,
      organizationId: record.organizationId,
      siteId: record.siteId,
      projectId: record.site.projectId,
      provider: record.provider,
      externalId: record.externalId,
      enabled: record.enabled,
      settingsJson: asSettingsJson(record.settingsJson),
      version: record.version,
    } : null);
  }

  async createProviderConnection(input: CreateProviderConnectionInput, organizationId: string) {
    try {
      return await this.prisma.providerConnection.create({
        data: {
          organizationId,
          siteId: input.siteId,
          provider: input.provider,
          externalId: input.externalId,
          enabled: input.enabled,
          settingsJson: input.settingsJson ?? Prisma.JsonNull,
        },
        select: { id: true, version: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ProjectRegistryAdminError("PROVIDER_CONNECTION_REFERENCE_INVALID");
      }
      translateWriteError(error);
    }
  }

  async updateProviderConnection(input: UpdateProviderConnectionInput, organizationId: string): Promise<boolean> {
    const result = await this.prisma.providerConnection.updateMany({
      where: { id: input.id, organizationId, version: input.version },
      data: {
        externalId: input.externalId,
        enabled: input.enabled,
        settingsJson: input.settingsJson ?? Prisma.JsonNull,
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  async confirmMetricaGoals(input: ConfirmMetricaGoalsInput, organizationId: string) {
    const connection = await this.prisma.providerConnection.findFirst({
      where: { organizationId, siteId: input.siteId, provider: "YANDEX_METRIKA", enabled: true },
      select: { id: true, settingsJson: true, site: { select: { projectId: true, name: true } } },
    });
    if (!connection) throw new ProjectRegistryAdminError("PROVIDER_CONNECTION_NOT_FOUND_OR_FORBIDDEN");
    const suggestions = readGoalSuggestions(connection.settingsJson);
    const allowedIds = new Set(suggestions.flatMap((item) => item.candidates.map((candidate) => candidate.goalId)));
    if (!allowedIds.has(input.leadGoalId) || !allowedIds.has(input.phoneGoalId)) {
      throw new ProjectRegistryAdminError("METRIKA_GOAL_MAPPING_INVALID");
    }
    const definitions = [
      { externalGoalId: input.leadGoalId, label: "Основная заявка", category: "LEAD_SUBMIT" as const, direction: "PRIMARY" as const },
      { externalGoalId: input.phoneGoalId, label: "Раскрытие телефона", category: "PHONE_CLICK" as const, direction: "SECONDARY" as const },
    ];
    for (const definition of definitions) {
      const goal = await this.prisma.goalDefinition.upsert({
        where: { projectId_externalGoalId: { projectId: connection.site.projectId, externalGoalId: definition.externalGoalId } },
        update: { label: definition.label, category: definition.category, direction: definition.direction, includeInSeoConversion: true, version: { increment: 1 } },
        create: { organizationId, projectId: connection.site.projectId, ...definition, includeInSeoConversion: true },
        select: { id: true },
      });
      await this.prisma.goalDefinitionSite.upsert({
        where: { goalDefinitionId_siteId: { goalDefinitionId: goal.id, siteId: input.siteId } },
        update: { organizationId },
        create: { organizationId, goalDefinitionId: goal.id, siteId: input.siteId },
      });
    }
    await this.prisma.providerConnection.update({ where: { id: connection.id }, data: { status: "CONNECTED", statusCode: null, connectedAt: new Date(), lastCheckedAt: new Date(), settingsJson: { goalProfile: "seo-conversion", selectedGoals: definitions.map((item) => ({ externalGoalId: item.externalGoalId, category: item.category })) } } });
    await this.prisma.notification.upsert({
      where: { dedupKey: `metrica-connected:${input.siteId}` },
      update: { severity: "SUCCESS", title: "Метрика подключена", message: "Цели заявки и раскрытия телефона подтверждены.", occurredAt: new Date() },
      create: { organizationId, projectId: connection.site.projectId, siteId: input.siteId, category: "INTEGRATION", severity: "SUCCESS", visibility: "PLATFORM_TEAM", title: "Метрика подключена", message: "Цели заявки и раскрытия телефона подтверждены.", route: `/admin/providers/?site=${input.siteId}`, sourceType: "ProviderConnection", sourceId: connection.id, dedupKey: `metrica-connected:${input.siteId}`, occurredAt: new Date() },
    });
    return { projectId: connection.site.projectId, connectionId: connection.id };
  }

  findGoalDefinitionForAction(id: string) {
    return this.prisma.goalDefinition.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        projectId: true,
        externalGoalId: true,
        label: true,
        category: true,
        direction: true,
        includeInSeoConversion: true,
        version: true,
        siteScopes: { select: { siteId: true } },
      },
    }).then((record) => record ? {
      ...record,
      siteIds: record.siteScopes.map((scope) => scope.siteId),
    } : null);
  }

  async createGoalDefinition(input: CreateGoalDefinitionInput, organizationId: string) {
    try {
      return await this.prisma.goalDefinition.create({
        data: {
          organizationId,
          projectId: input.projectId,
          externalGoalId: input.externalGoalId,
          label: input.label,
          category: input.category,
          direction: input.direction,
          includeInSeoConversion: input.includeInSeoConversion,
        },
        select: { id: true, version: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ProjectRegistryAdminError("GOAL_DEFINITION_REFERENCE_INVALID");
      }
      translateWriteError(error);
    }
  }

  async updateGoalDefinition(input: UpdateGoalDefinitionInput, organizationId: string): Promise<boolean> {
    const result = await this.prisma.goalDefinition.updateMany({
      where: { id: input.id, organizationId, version: input.version },
      data: {
        label: input.label,
        category: input.category,
        direction: input.direction,
        includeInSeoConversion: input.includeInSeoConversion,
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  async replaceGoalDefinitionSiteScopes(goalDefinitionId: string, organizationId: string, siteIds: string[]) {
    await this.prisma.goalDefinitionSite.deleteMany({ where: { goalDefinitionId } });
    if (siteIds.length === 0) return;
    await this.prisma.goalDefinitionSite.createMany({
      data: siteIds.map((siteId) => ({ organizationId, goalDefinitionId, siteId })),
      skipDuplicates: true,
    });
  }

  async assertProjectSiteScope(projectId: string, organizationId: string, siteIds: string[]) {
    const expected = new Set(siteIds).size;
    if (expected === 0) return;
    const count = await this.prisma.site.count({
      where: { id: { in: siteIds }, projectId, organizationId },
    });
    if (count !== expected) {
      throw new ProjectRegistryAdminError("GOAL_DEFINITION_REFERENCE_INVALID");
    }
  }

  findTrackedQuerySetForAction(id: string) {
    return this.prisma.trackedQuerySet.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        siteId: true,
        source: true,
        baselineLabel: true,
        expectedCount: true,
        version: true,
        queries: {
          where: { enabled: true },
          orderBy: { normalizedQuery: "asc" },
          select: { query: true },
        },
      },
    }).then((record) => record ? {
      ...record,
      queries: record.queries.map((query) => query.query),
    } : null);
  }

  async createTrackedQuerySet(input: CreateTrackedQuerySetInput, organizationId: string) {
    try {
      return await this.prisma.trackedQuerySet.create({
        data: {
          organizationId,
          siteId: input.siteId,
          source: input.source,
          baselineLabel: input.baselineLabel,
          expectedCount: input.queries.length,
        },
        select: { id: true, version: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ProjectRegistryAdminError("TRACKED_QUERY_SET_REFERENCE_INVALID");
      }
      translateWriteError(error);
    }
  }

  async updateTrackedQuerySet(input: UpdateTrackedQuerySetInput, organizationId: string): Promise<boolean> {
    const result = await this.prisma.trackedQuerySet.updateMany({
      where: { id: input.id, organizationId, version: input.version },
      data: {
        source: input.source,
        baselineLabel: input.baselineLabel,
        expectedCount: input.queries.length,
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  async replaceTrackedQueries(trackedQuerySetId: string, organizationId: string, queries: string[]) {
    const normalizedQueries = queries.map((query) => ({
      query,
      normalizedQuery: normalizeTrackedQuery(query),
    }));
    await this.prisma.trackedQuery.updateMany({
      where: { trackedQuerySetId, enabled: true },
      data: { enabled: false, organizationId },
    });
    if (normalizedQueries.length > 0) {
      await this.prisma.trackedQuery.createMany({
        data: normalizedQueries.map((query) => ({
          organizationId,
          trackedQuerySetId,
          query: query.query,
          normalizedQuery: query.normalizedQuery,
          enabled: true,
        })),
        skipDuplicates: true,
      });
      await this.prisma.trackedQuery.updateMany({
        where: {
          trackedQuerySetId,
          normalizedQuery: { in: normalizedQueries.map((query) => query.normalizedQuery) },
        },
        data: { enabled: true, organizationId },
      });
    }
  }

  async findThresholdProfileForAction(id: string) {
    const record = await this.prisma.thresholdProfile.findUnique({
      where: { id },
      select: thresholdProfileSelect,
    });
    return record
      ? {
          id: record.id,
          slug: record.slug,
          minimumShows: record.minimumShows,
          maximumCtrPercent: decimal(record.maximumCtrPercent),
          maximumAveragePosition: decimal(record.maximumAveragePosition),
          showsDropPercent: decimal(record.showsDropPercent),
          clicksDropPercent: decimal(record.clicksDropPercent),
          positionWorsenedDelta: decimal(record.positionWorsenedDelta),
          pagesInSearchDropPercent: decimal(record.pagesInSearchDropPercent),
          organicVisitsDropPercent: decimal(record.organicVisitsDropPercent),
          goalConversionDropPercent: decimal(record.goalConversionDropPercent),
          version: record.version,
        }
      : null;
  }

  async createThresholdProfile(input: CreateThresholdProfileInput) {
    try {
      return await this.prisma.thresholdProfile.create({
        data: input,
        select: { id: true, version: true },
      });
    } catch (error) {
      translateWriteError(error);
    }
  }

  async updateThresholdProfile(input: UpdateThresholdProfileInput): Promise<boolean> {
    try {
      const result = await this.prisma.thresholdProfile.updateMany({
        where: { id: input.id, version: input.version },
        data: {
          minimumShows: input.minimumShows,
          maximumCtrPercent: input.maximumCtrPercent,
          maximumAveragePosition: input.maximumAveragePosition,
          showsDropPercent: input.showsDropPercent,
          clicksDropPercent: input.clicksDropPercent,
          positionWorsenedDelta: input.positionWorsenedDelta,
          pagesInSearchDropPercent: input.pagesInSearchDropPercent,
          organicVisitsDropPercent: input.organicVisitsDropPercent,
          goalConversionDropPercent: input.goalConversionDropPercent,
          version: { increment: 1 },
        },
      });
      return result.count === 1;
    } catch (error) {
      translateWriteError(error);
    }
  }

  findQueryClusterProfileForAction(id: string) {
    return this.prisma.queryClusterProfile.findUnique({ where: { id }, select: clusterProfileSelect }).then((record) =>
      record ? toQueryClusterProfileListItem(record) : null,
    );
  }

  async createQueryClusterProfile(input: CreateQueryClusterProfileInput) {
    try {
      return await this.prisma.queryClusterProfile.create({
        data: { slug: input.slug, name: input.name },
        select: { id: true, version: true },
      });
    } catch (error) {
      translateWriteError(error);
    }
  }

  async updateQueryClusterProfile(input: UpdateQueryClusterProfileInput): Promise<boolean> {
    try {
      const result = await this.prisma.queryClusterProfile.updateMany({
        where: { id: input.id, version: input.version },
        data: { name: input.name, version: { increment: 1 } },
      });
      return result.count === 1;
    } catch (error) {
      translateWriteError(error);
    }
  }

  async replaceQueryClusterGroups(profileId: string, groups: CreateQueryClusterProfileInput["groups"]) {
    await this.prisma.queryClusterGroup.deleteMany({ where: { profileId } });
    if (groups.length === 0) return;
    await this.prisma.queryClusterGroup.createMany({
      data: groups.map((group) => ({
        profileId,
        slug: group.slug,
        label: group.label,
        order: group.order,
        brandTermsJson: group.brandTerms,
        termsJson: group.terms,
      })),
    });
  }

  async appendAudit(input: PlatformAdminAuditInput) {
    await this.prisma.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: "USER",
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeMarker: input.beforeMarker ?? Prisma.JsonNull,
        afterMarker: input.afterMarker,
        source: "platform-admin",
        correlationId: input.correlationId,
      },
    });
  }
}
