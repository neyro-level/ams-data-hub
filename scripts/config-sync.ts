import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { GoalCategory,
GoalDirection,
ProjectStatus,
Provider,
RankingSource, } from "../src/generated/prisma/client.ts"
import {
  clientRegistrySchema,
  clusterProfileSchema,
  goalProfileSchema,
  thresholdsSchema,
  type ClusterProfile,
  type ClientRegistry,
  type GoalProfile,
  type SiteRegistry,
  type ThresholdsConfig,
} from "../src/shared/schemas/registry.ts";
import { createPrismaContext } from "../src/platform/database/prisma/context.ts";
import {
  formatDatabaseTargetSummary,
  inspectDatabaseTarget,
} from "../src/platform/config/database-target.ts";
import {
  trackedQuerySetSchema,
  type TrackedQuerySet,
} from "../src/shared/schemas/tracked-query.ts";

const args = process.argv.slice(2);
const sourceIndex = args.indexOf("--source");
const sourceArg = sourceIndex >= 0 ? args[sourceIndex + 1] : undefined;
const applyChanges = args.includes("--apply");

if (!sourceArg || sourceArg.startsWith("--")) {
  throw new Error("Usage: config:sync --source <private-path> [--apply]");
}

const sourceRoot = path.resolve(process.cwd(), sourceArg);
const databaseEnvironment = {
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_HOST: process.env.DATABASE_HOST,
  DATABASE_PORT: process.env.DATABASE_PORT,
  DATABASE_USER: process.env.DATABASE_USER,
  DATABASE_PASSWORD: process.env.DATABASE_PASSWORD,
  DATABASE_NAME: process.env.DATABASE_NAME,
  DATABASE_SSLMODE: process.env.DATABASE_SSLMODE,
  APP_ENV: process.env.APP_ENV,
  NODE_ENV: process.env.NODE_ENV,
};
const target = inspectDatabaseTarget(databaseEnvironment);
console.error(`database_target=${formatDatabaseTargetSummary(target)}`);
const database = createPrismaContext(databaseEnvironment);
const { prisma } = database;

type ChangeKind = "CREATE" | "UPDATE" | "DELETE_OR_DISABLE" | "UNCHANGED";
type ChangeSummary = Record<ChangeKind, string[]>;

function createChangeSummary(): ChangeSummary {
  return { CREATE: [], UPDATE: [], DELETE_OR_DISABLE: [], UNCHANGED: [] };
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function projectStatusForClient(client: ClientRegistry) {
  if (!client.enabled) return ProjectStatus.DISABLED;
  return client.sites.some((site) => site.enabled) ? ProjectStatus.ACTIVE : ProjectStatus.PLANNED;
}

function goalCategoryToEnum(category: string) {
  switch (category) {
    case "lead_submit":
      return GoalCategory.LEAD_SUBMIT;
    case "phone_click":
      return GoalCategory.PHONE_CLICK;
    case "messenger_click":
      return GoalCategory.MESSENGER_CLICK;
    case "form_start":
      return GoalCategory.FORM_START;
    case "file_download":
      return GoalCategory.FILE_DOWNLOAD;
    default:
      return GoalCategory.OTHER;
  }
}

function goalDirectionToEnum(direction: string) {
  return direction === "primary" ? GoalDirection.PRIMARY : GoalDirection.SECONDARY;
}

function normalizeTrackedQuery(query: string) {
  return query.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim();
}

function providerRowsForSite(site: SiteRegistry) {
  return [
    {
      provider: Provider.YANDEX_WEBMASTER,
      externalId: site.webmaster.expectedHostUrl,
      enabled: site.webmaster.enabled,
      settingsJson: { expectedHostUrl: site.webmaster.expectedHostUrl },
    },
    {
      provider: Provider.YANDEX_METRIKA,
      externalId: site.metrica.counterId,
      enabled: site.metrica.enabled,
      settingsJson: { goalProfile: site.metrica.goalProfile },
    },
    {
      provider: Provider.TOPVISOR,
      externalId: site.topvisor.projectId === null ? null : String(site.topvisor.projectId),
      enabled: site.topvisor.enabled,
      settingsJson: { regionIndex: site.topvisor.regionIndex },
    },
  ];
}

async function readJsonDirectory<T>(relativeDir: string, schema: { parse: (value: unknown) => T }) {
  const fullDir = path.join(sourceRoot, relativeDir);
  const names = (await readdir(fullDir)).filter((name) => name.endsWith(".json")).sort();
  const items: T[] = [];
  for (const name of names) {
    const payload = JSON.parse(await readFile(path.join(fullDir, name), "utf8"));
    items.push(schema.parse(payload));
  }
  return items;
}

async function buildChangeSummary(input: {
  thresholds: ThresholdsConfig;
  clusterProfiles: ClusterProfile[];
  clientConfigs: ClientRegistry[];
  goalProfiles: GoalProfile[];
  trackedQuerySets: TrackedQuerySet[];
}) {
  const summary = createChangeSummary();
  const threshold = await prisma.thresholdProfile.findUnique({ where: { slug: "default" } });
  const desiredThreshold = {
    minimumShows: input.thresholds.queryOpportunity.minimumShows,
    maximumCtrPercent: input.thresholds.queryOpportunity.maximumCtrPercent,
    maximumAveragePosition: input.thresholds.queryOpportunity.maximumAveragePosition,
    showsDropPercent: input.thresholds.trendAlerts.showsDropPercent,
    clicksDropPercent: input.thresholds.trendAlerts.clicksDropPercent,
    positionWorsenedDelta: input.thresholds.trendAlerts.positionWorsenedDelta,
    pagesInSearchDropPercent: input.thresholds.trendAlerts.pagesInSearchDropPercent,
    organicVisitsDropPercent: input.thresholds.trendAlerts.organicVisitsDropPercent,
    goalConversionDropPercent: input.thresholds.trendAlerts.goalConversionDropPercent,
  };
  if (!threshold) {
    summary.CREATE.push("threshold-profile:default");
  } else {
    const currentThreshold = {
      minimumShows: threshold.minimumShows,
      maximumCtrPercent: Number(threshold.maximumCtrPercent),
      maximumAveragePosition: Number(threshold.maximumAveragePosition),
      showsDropPercent: Number(threshold.showsDropPercent),
      clicksDropPercent: Number(threshold.clicksDropPercent),
      positionWorsenedDelta: Number(threshold.positionWorsenedDelta),
      pagesInSearchDropPercent: Number(threshold.pagesInSearchDropPercent),
      organicVisitsDropPercent: Number(threshold.organicVisitsDropPercent),
      goalConversionDropPercent: Number(threshold.goalConversionDropPercent),
    };
    summary[sameJson(currentThreshold, desiredThreshold) ? "UNCHANGED" : "UPDATE"].push(
      "threshold-profile:default",
    );
  }

  for (const profile of input.clusterProfiles) {
    const current = await prisma.queryClusterProfile.findUnique({
      where: { slug: profile.profileSlug },
      include: { groups: { orderBy: { order: "asc" } } },
    });
    if (!current) {
      summary.CREATE.push(`query-cluster-profile:${profile.profileSlug}`);
      continue;
    }
    const desired = {
      name: profile.name,
      groups: profile.groups.map((group, order) => ({
        slug: group.slug,
        label: group.label,
        order,
        brandTermsJson: profile.brandTerms,
        termsJson: group.terms,
      })),
    };
    const actual = {
      name: current.name,
      groups: current.groups.map((group) => ({
        slug: group.slug,
        label: group.label,
        order: group.order,
        brandTermsJson: group.brandTermsJson,
        termsJson: group.termsJson,
      })),
    };
    summary[sameJson(actual, desired) ? "UNCHANGED" : "UPDATE"].push(
      `query-cluster-profile:${profile.profileSlug}`,
    );
    const desiredSlugs = new Set(profile.groups.map((group) => group.slug));
    for (const group of current.groups) {
      if (!desiredSlugs.has(group.slug)) {
        summary.DELETE_OR_DISABLE.push(
          `query-cluster-group:${profile.profileSlug}/${group.slug}:leave-as-is`,
        );
      }
    }
  }

  for (const client of input.clientConfigs) {
    const current = await prisma.project.findUnique({
      where: { slug: client.clientSlug },
      include: {
        organization: true,
        sites: {
          include: {
            providerConnections: true,
            trackedQuerySet: { include: { queries: true } },
          },
        },
        goalDefinitions: { include: { siteScopes: { include: { site: true } } } },
      },
    });
    if (!current) {
      summary.CREATE.push(`project:${client.clientSlug}`);
      continue;
    }

    const desiredSiteSlugs = new Set(client.sites.map((site) => site.siteSlug));
    let changed =
      current.name !== client.name ||
      current.organization.name !== client.name ||
      current.status !== projectStatusForClient(client) ||
      current.sites.some((site) => !desiredSiteSlugs.has(site.slug)) ||
      client.sites.some((site) => {
        const row = current.sites.find((candidate) => candidate.slug === site.siteSlug);
        if (
          !row ||
          row.name !== site.name ||
          row.url !== site.siteUrl ||
          row.timezone !== site.timezone ||
          row.enabled !== site.enabled
        ) {
          return true;
        }
        return providerRowsForSite(site).some((provider) => {
          const existing = row.providerConnections.find(
            (candidate) => candidate.provider === provider.provider,
          );
          return (
            !existing ||
            existing.externalId !== provider.externalId ||
            existing.enabled !== provider.enabled ||
            !sameJson(existing.settingsJson, provider.settingsJson)
          );
        });
      });

    for (const site of current.sites) {
      if (!desiredSiteSlugs.has(site.slug) && site.enabled) {
        summary.DELETE_OR_DISABLE.push(`site:${client.clientSlug}/${site.slug}:disable`);
      }
    }

    const desiredGoals = input.goalProfiles.find((profile) => profile.clientSlug === client.clientSlug);
    if (desiredGoals) {
      const goalIds = new Set(desiredGoals.goals.map((goal) => goal.goalId));
      for (const desiredGoal of desiredGoals.goals) {
        const existing = current.goalDefinitions.find(
          (goal) => goal.externalGoalId === desiredGoal.goalId,
        );
        const currentSiteSlugs =
          existing?.siteScopes.map((scope) => scope.site.slug).sort() ?? [];
        const desiredGoalSiteSlugs = [...desiredGoal.siteSlugs].sort();
        if (
          !existing ||
          existing.label !== desiredGoal.label ||
          existing.category !== goalCategoryToEnum(desiredGoal.category) ||
          existing.direction !== goalDirectionToEnum(desiredGoal.direction) ||
          existing.includeInSeoConversion !== desiredGoal.includeInSeoConversion ||
          !sameJson(currentSiteSlugs, desiredGoalSiteSlugs)
        ) {
          changed = true;
        }
      }
      for (const goal of current.goalDefinitions) {
        if (!goalIds.has(goal.externalGoalId)) {
          changed = true;
          summary.DELETE_OR_DISABLE.push(
            `goal-definition:${client.clientSlug}/${goal.externalGoalId}:leave-as-is`,
          );
        }
      }
    }

    for (const desiredSet of input.trackedQuerySets.filter(
      (set) => set.clientSlug === client.clientSlug,
    )) {
      const site = current.sites.find((candidate) => candidate.slug === desiredSet.siteSlug);
      const existingQueries = site?.trackedQuerySet?.queries ?? [];
      const desiredQueries = new Set(
        desiredSet.queries.map((query) => normalizeTrackedQuery(query.query)),
      );
      if (
        !site?.trackedQuerySet ||
        site.trackedQuerySet.baselineLabel !== desiredSet.baselineLabel ||
        site.trackedQuerySet.expectedCount !== desiredSet.expectedCount ||
        desiredSet.queries.some((query) => {
          const normalized = normalizeTrackedQuery(query.query);
          const existing = existingQueries.find(
            (candidate) => candidate.normalizedQuery === normalized,
          );
          return (
            !existing ||
            existing.query !== query.query ||
            !existing.enabled ||
            existing.baselineCurrentPosition !== query.position.current ||
            existing.baselinePreviousPosition !== query.position.baseline
          );
        })
      ) {
        changed = true;
      }
      for (const query of existingQueries) {
        if (!desiredQueries.has(query.normalizedQuery) && query.enabled) {
          changed = true;
          summary.DELETE_OR_DISABLE.push(
            `tracked-query:${client.clientSlug}/${desiredSet.siteSlug}/${query.id}:disable`,
          );
        }
      }
    }

    summary[changed ? "UPDATE" : "UNCHANGED"].push(`project:${client.clientSlug}`);
  }

  return summary;
}

async function main() {
  const thresholds = thresholdsSchema.parse(
    JSON.parse(await readFile(path.join(sourceRoot, "thresholds.json"), "utf8")),
  );
  const clusterProfiles = await readJsonDirectory("clusters", clusterProfileSchema);
  const clientConfigs = await readJsonDirectory("clients", clientRegistrySchema);
  const goalProfiles = await readJsonDirectory("goals", goalProfileSchema);
  const trackedQuerySets = await readJsonDirectory("tracked-queries", trackedQuerySetSchema);
  const changes = await buildChangeSummary({
    thresholds,
    clusterProfiles,
    clientConfigs,
    goalProfiles,
    trackedQuerySets,
  });

  if (!applyChanges) {
    console.log(JSON.stringify({ mode: "dry-run", source: path.basename(sourceRoot), changes }, null, 2));
    return;
  }

  const thresholdProfile = await prisma.thresholdProfile.upsert({
    where: { slug: "default" },
    update: {
      minimumShows: thresholds.queryOpportunity.minimumShows,
      maximumCtrPercent: thresholds.queryOpportunity.maximumCtrPercent.toString(),
      maximumAveragePosition: thresholds.queryOpportunity.maximumAveragePosition.toString(),
      showsDropPercent: thresholds.trendAlerts.showsDropPercent.toString(),
      clicksDropPercent: thresholds.trendAlerts.clicksDropPercent.toString(),
      positionWorsenedDelta: thresholds.trendAlerts.positionWorsenedDelta.toString(),
      pagesInSearchDropPercent: thresholds.trendAlerts.pagesInSearchDropPercent.toString(),
      organicVisitsDropPercent: thresholds.trendAlerts.organicVisitsDropPercent.toString(),
      goalConversionDropPercent: thresholds.trendAlerts.goalConversionDropPercent.toString(),
    },
    create: {
      slug: "default",
      minimumShows: thresholds.queryOpportunity.minimumShows,
      maximumCtrPercent: thresholds.queryOpportunity.maximumCtrPercent.toString(),
      maximumAveragePosition: thresholds.queryOpportunity.maximumAveragePosition.toString(),
      showsDropPercent: thresholds.trendAlerts.showsDropPercent.toString(),
      clicksDropPercent: thresholds.trendAlerts.clicksDropPercent.toString(),
      positionWorsenedDelta: thresholds.trendAlerts.positionWorsenedDelta.toString(),
      pagesInSearchDropPercent: thresholds.trendAlerts.pagesInSearchDropPercent.toString(),
      organicVisitsDropPercent: thresholds.trendAlerts.organicVisitsDropPercent.toString(),
      goalConversionDropPercent: thresholds.trendAlerts.goalConversionDropPercent.toString(),
    },
  });

  for (const profile of clusterProfiles) {
    const clusterProfile = await prisma.queryClusterProfile.upsert({
      where: { slug: profile.profileSlug },
      update: { name: profile.name },
      create: {
        slug: profile.profileSlug,
        name: profile.name,
      },
    });

    for (const [index, group] of profile.groups.entries()) {
      await prisma.queryClusterGroup.upsert({
        where: {
          profileId_slug: {
            profileId: clusterProfile.id,
            slug: group.slug,
          },
        },
        update: {
          label: group.label,
          order: index,
          brandTermsJson: profile.brandTerms,
          termsJson: group.terms,
        },
        create: {
          profileId: clusterProfile.id,
          slug: group.slug,
          label: group.label,
          order: index,
          brandTermsJson: profile.brandTerms,
          termsJson: group.terms,
        },
      });
    }
  }

  for (const client of clientConfigs) {
    const clusterProfile = await prisma.queryClusterProfile.findUniqueOrThrow({
      where: { slug: client.clusterProfile },
    });
    const goalProfile = goalProfiles.find((item) => item.clientSlug === client.clientSlug) ?? null;

    const organization = await prisma.organization.upsert({
      where: { slug: client.clientSlug },
      update: { name: client.name },
      create: {
        slug: client.clientSlug,
        name: client.name,
      },
    });

    const project = await prisma.project.upsert({
      where: { slug: client.clientSlug },
      update: {
        name: client.name,
        status: projectStatusForClient(client),
        organizationId: organization.id,
        thresholdProfileId: thresholdProfile.id,
        clusterProfileId: clusterProfile.id,
      },
      create: {
        slug: client.clientSlug,
        name: client.name,
        status: projectStatusForClient(client),
        organizationId: organization.id,
        thresholdProfileId: thresholdProfile.id,
        clusterProfileId: clusterProfile.id,
      },
    });

    const siteIdsBySlug: Record<string, string> = {};
    const incomingSiteSlugs = client.sites.map((site) => site.siteSlug);
    const sitesToDisable = await prisma.site.findMany({
      where: { projectId: project.id, slug: { notIn: incomingSiteSlugs }, enabled: true },
      select: { id: true },
    });
    if (sitesToDisable.length > 0) {
      const siteIds = sitesToDisable.map((site) => site.id);
      await prisma.providerConnection.updateMany({
        where: { siteId: { in: siteIds }, enabled: true },
        data: { enabled: false },
      });
      await prisma.site.updateMany({
        where: { id: { in: siteIds } },
        data: { enabled: false },
      });
    }

    for (const site of client.sites) {
      const siteRecord = await prisma.site.upsert({
        where: {
          projectId_slug: {
            projectId: project.id,
            slug: site.siteSlug,
          },
        },
        update: {
          name: site.name,
          url: site.siteUrl,
          timezone: site.timezone,
          enabled: site.enabled,
          organizationId: organization.id,
        },
        create: {
          projectId: project.id,
          slug: site.siteSlug,
          name: site.name,
          url: site.siteUrl,
          timezone: site.timezone,
          enabled: site.enabled,
          organizationId: organization.id,
        },
      });

      siteIdsBySlug[site.siteSlug] = siteRecord.id;

      const providerRows = providerRowsForSite(site);

      for (const row of providerRows) {
        await prisma.providerConnection.upsert({
          where: {
            siteId_provider: {
              siteId: siteRecord.id,
              provider: row.provider,
            },
          },
          update: {
            externalId: row.externalId,
            enabled: row.enabled,
            settingsJson: row.settingsJson,
            organizationId: organization.id,
          },
          create: {
            siteId: siteRecord.id,
            provider: row.provider,
            externalId: row.externalId,
            enabled: row.enabled,
            settingsJson: row.settingsJson,
            organizationId: organization.id,
          },
        });
      }
    }

    if (goalProfile) {
      for (const goal of goalProfile.goals) {
        const goalRecord = await prisma.goalDefinition.upsert({
          where: {
            projectId_externalGoalId: {
              projectId: project.id,
              externalGoalId: goal.goalId,
            },
          },
          update: {
            label: goal.label,
            category: goalCategoryToEnum(goal.category),
            direction: goalDirectionToEnum(goal.direction),
            includeInSeoConversion: goal.includeInSeoConversion,
            organizationId: organization.id,
          },
          create: {
            projectId: project.id,
            externalGoalId: goal.goalId,
            label: goal.label,
            category: goalCategoryToEnum(goal.category),
            direction: goalDirectionToEnum(goal.direction),
            includeInSeoConversion: goal.includeInSeoConversion,
            organizationId: organization.id,
          },
        });

        for (const siteSlug of goal.siteSlugs) {
          const siteId = siteIdsBySlug[siteSlug];
          if (!siteId) {
            throw new Error(`Unknown site slug in goal scope: ${client.clientSlug}/${siteSlug}`);
          }
          await prisma.goalDefinitionSite.upsert({
            where: {
              goalDefinitionId_siteId: {
                goalDefinitionId: goalRecord.id,
                siteId,
              },
            },
            update: {},
            create: {
              goalDefinitionId: goalRecord.id,
              siteId,
              organizationId: organization.id,
            },
          });
        }
      }
    }

    const trackedQuerySet = trackedQuerySets.find(
      (item) => item.clientSlug === client.clientSlug,
    );

    if (trackedQuerySet) {
      const siteId = siteIdsBySlug[trackedQuerySet.siteSlug];
      if (!siteId) {
        throw new Error(`Unknown tracked-query site: ${trackedQuerySet.clientSlug}/${trackedQuerySet.siteSlug}`);
      }

      const trackedSetRecord = await prisma.trackedQuerySet.upsert({
        where: { siteId },
        update: {
          source: RankingSource.OWNER_PROVIDED,
          baselineLabel: trackedQuerySet.baselineLabel,
          expectedCount: trackedQuerySet.expectedCount,
          organizationId: organization.id,
        },
        create: {
          siteId,
          source: RankingSource.OWNER_PROVIDED,
          baselineLabel: trackedQuerySet.baselineLabel,
          expectedCount: trackedQuerySet.expectedCount,
          organizationId: organization.id,
        },
      });

      const incomingQueries = trackedQuerySet.queries.map((query) => normalizeTrackedQuery(query.query));
      await prisma.trackedQuery.updateMany({
        where: {
          trackedQuerySetId: trackedSetRecord.id,
          normalizedQuery: { notIn: incomingQueries },
          enabled: true,
        },
        data: { enabled: false },
      });

      for (const query of trackedQuerySet.queries) {
        const normalizedQuery = normalizeTrackedQuery(query.query);
        await prisma.trackedQuery.upsert({
          where: {
            trackedQuerySetId_normalizedQuery: {
              trackedQuerySetId: trackedSetRecord.id,
              normalizedQuery,
            },
          },
          update: {
            query: query.query,
            enabled: true,
            baselineCurrentPosition: query.position.current,
            baselinePreviousPosition: query.position.baseline,
            organizationId: organization.id,
          },
          create: {
            trackedQuerySetId: trackedSetRecord.id,
            query: query.query,
            normalizedQuery,
            enabled: true,
            baselineCurrentPosition: query.position.current,
            baselinePreviousPosition: query.position.baseline,
            organizationId: organization.id,
          },
        });
      }
    }
  }

  const projectCount = await prisma.project.count();
  const siteCount = await prisma.site.count();
  const trackedQueryCount = await prisma.trackedQuery.count();
  console.log(
    JSON.stringify(
      {
        mode: "apply",
        source: path.basename(sourceRoot),
        changes,
        projectCount,
        siteCount,
        trackedQueryCount,
      },
      null,
      2,
    ),
  );
}

main()
  .finally(async () => {
    await database.close();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Configuration sync failed");
    process.exit(1);
  });
