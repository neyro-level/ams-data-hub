import { Prisma } from "../../../generated/prisma/client.ts";
import type {
  MonitoringProjectRecord,
  MonitoringRepository,
} from "../application/ports/monitoring-repository.ts";
import { getPrismaClient } from "../../../platform/database/prisma/client.ts";

export class PrismaMonitoringRepository implements MonitoringRepository {
  async ping(): Promise<void> {
    await getPrismaClient().$queryRaw(Prisma.sql`SELECT 1`);
  }

  async listActiveProjectSlugs(): Promise<string[]> {
    const projects = await getPrismaClient().project.findMany({
      where: { status: "ACTIVE" },
      orderBy: { slug: "asc" },
      select: { slug: true },
    });
    return projects.map((project) => project.slug);
  }

  async findProjectBySlug(projectSlug: string): Promise<MonitoringProjectRecord | null> {
    const project = await getPrismaClient().project.findUnique({
      where: { slug: projectSlug },
      select: {
        id: true,
        organizationId: true,
        slug: true,
        name: true,
        status: true,
        clusterProfile: {
          select: {
            slug: true,
            name: true,
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
          },
        },
        thresholdProfile: {
          select: {
            minimumShows: true,
            maximumCtrPercent: true,
            maximumAveragePosition: true,
            showsDropPercent: true,
            clicksDropPercent: true,
            positionWorsenedDelta: true,
            pagesInSearchDropPercent: true,
            organicVisitsDropPercent: true,
            goalConversionDropPercent: true,
          },
        },
        sites: {
          orderBy: { slug: "asc" },
          select: {
            slug: true,
            name: true,
            url: true,
            timezone: true,
            enabled: true,
            providerConnections: {
              select: {
                provider: true,
                externalId: true,
                enabled: true,
                status: true,
                settingsJson: true,
              },
            },
            trackedQuerySet: {
              select: {
                baselineLabel: true,
                expectedCount: true,
                queries: {
                  orderBy: { normalizedQuery: "asc" },
                  select: {
                    query: true,
                    baselineCurrentPosition: true,
                    baselinePreviousPosition: true,
                  },
                },
              },
            },
          },
        },
        goalDefinitions: {
          orderBy: { externalGoalId: "asc" },
          select: {
            externalGoalId: true,
            label: true,
            category: true,
            direction: true,
            includeInSeoConversion: true,
            siteScopes: {
              select: {
                site: {
                  select: {
                    slug: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!project) {
      return null;
    }

    return {
      projectId: project.id,
      organizationId: project.organizationId,
      projectSlug: project.slug,
      name: project.name,
      enabled: project.status !== "DISABLED",
      clusterProfileSlug: project.clusterProfile.slug,
      clusterProfileName: project.clusterProfile.name,
      clusterGroups: project.clusterProfile.groups.map((group) => ({
        slug: group.slug,
        label: group.label,
        order: group.order,
        brandTerms: Array.isArray(group.brandTermsJson)
          ? group.brandTermsJson.filter((item): item is string => typeof item === "string")
          : [],
        terms: Array.isArray(group.termsJson)
          ? group.termsJson.filter((item): item is string => typeof item === "string")
          : [],
      })),
      threshold: {
        minimumShows: project.thresholdProfile.minimumShows,
        maximumCtrPercent: Number(project.thresholdProfile.maximumCtrPercent),
        maximumAveragePosition: Number(project.thresholdProfile.maximumAveragePosition),
        showsDropPercent: Number(project.thresholdProfile.showsDropPercent),
        clicksDropPercent: Number(project.thresholdProfile.clicksDropPercent),
        positionWorsenedDelta: Number(project.thresholdProfile.positionWorsenedDelta),
        pagesInSearchDropPercent: Number(project.thresholdProfile.pagesInSearchDropPercent),
        organicVisitsDropPercent: Number(project.thresholdProfile.organicVisitsDropPercent),
        goalConversionDropPercent: Number(project.thresholdProfile.goalConversionDropPercent),
      },
      sites: project.sites.map((site) => ({
        siteSlug: site.slug,
        name: site.name,
        siteUrl: site.url,
        timezone: site.timezone,
        enabled: site.enabled,
        providerConnections: site.providerConnections.map((connection) => ({
          provider: connection.provider,
          externalId: connection.externalId,
          enabled: connection.enabled,
          status: connection.status,
          settingsJson: connection.settingsJson,
        })),
      })),
      goalDefinitions: project.goalDefinitions.map((goal) => ({
        externalGoalId: goal.externalGoalId,
        label: goal.label,
        category: goal.category,
        direction: goal.direction,
        includeInSeoConversion: goal.includeInSeoConversion,
        siteSlugs: goal.siteScopes.map((scope) => scope.site.slug),
      })),
      trackedQuerySets: project.sites.flatMap((site) =>
        site.trackedQuerySet
          ? [
              {
                siteSlug: site.slug,
                baselineLabel: site.trackedQuerySet.baselineLabel,
                expectedCount: site.trackedQuerySet.expectedCount,
                queries: site.trackedQuerySet.queries.map((query) => ({
                  query: query.query,
                  baselineCurrentPosition: query.baselineCurrentPosition,
                  baselinePreviousPosition: query.baselinePreviousPosition,
                })),
              },
            ]
          : [],
      ),
    };
  }
}
