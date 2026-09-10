import { defineCommand } from "../../../platform/commands/define-command.ts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import {
  nextResourceVersion,
  confirmMetricaGoalsInputSchema,
  ProjectRegistryAdminError,
  saveGoalDefinitionInputSchema,
  saveProviderConnectionInputSchema,
  saveQueryClusterProfileInputSchema,
  saveSiteInputSchema,
  saveThresholdProfileInputSchema,
  saveTrackedQuerySetInputSchema,
} from "../domain/platform-admin.ts";
import {
  requirePlatformProfileManagement,
  requireProjectRegistryManagementScope,
} from "./platform-admin-authorization.ts";
import type { PlatformAdminReferenceRepository } from "./ports/platform-admin-reference-repository.ts";

export interface ProjectRegistryAdminCommandResult {
  id: string;
  version: number;
}

export interface PlatformAdminCommandDependencies {
  createRepository(transaction: Parameters<Parameters<typeof defineCommand>[0]["execute"]>[0]["transaction"]): PlatformAdminReferenceRepository;
}

export function createPlatformAdminCommands(
  dependencies: PlatformAdminCommandDependencies,
) {
  const saveSite = defineCommand<
    PrincipalContext,
    typeof saveSiteInputSchema,
    ProjectRegistryAdminCommandResult
  >({
    name: "saveSite",
    input: saveSiteInputSchema,
    authorize: (principal) => {
      if (principal.kind !== "platform-admin" && principal.kind !== "tenant-user") {
        throw new ProjectRegistryAdminError("PROJECT_REGISTRY_ADMIN_ACCESS_DENIED");
      }
    },
    execute: async ({ principal, input, transaction }) => {
      const repository = dependencies.createRepository(transaction);
      if ("id" in input) {
        const existing = await repository.findSiteForAction(input.id);
        if (!existing) {
          throw new ProjectRegistryAdminError("SITE_NOT_FOUND_OR_FORBIDDEN");
        }
        const scope = requireProjectRegistryManagementScope(
          principal,
          existing.organizationId,
        );
        if (existing.version !== input.version) {
          throw new ProjectRegistryAdminError("SITE_STALE");
        }
        const updated = await repository.updateSite(input, scope.organizationId);
        if (!updated) {
          throw new ProjectRegistryAdminError("SITE_STALE");
        }
        const version = nextResourceVersion(input.version, "SITE_STALE");
        await repository.appendAudit({
          actorId: scope.actorId,
          organizationId: scope.organizationId,
          action: "site.update",
          entityType: "Site",
          entityId: input.id,
          beforeMarker: {
            projectId: existing.projectId,
            slug: existing.slug,
            name: existing.name,
            enabled: existing.enabled,
            version: input.version,
          },
          afterMarker: {
            projectId: existing.projectId,
            slug: input.slug,
            name: input.name,
            enabled: input.enabled,
            version,
          },
          correlationId: scope.correlationId,
        });
        return { id: input.id, version };
      }

      const project = await repository.findProjectParent(input.projectId);
      if (!project) {
        throw new ProjectRegistryAdminError("SITE_REFERENCE_INVALID");
      }
      const scope = requireProjectRegistryManagementScope(
        principal,
        project.organizationId,
      );
      const created = await repository.createSite(input, scope.organizationId);
      await repository.appendAudit({
        actorId: scope.actorId,
        organizationId: scope.organizationId,
        action: "site.create",
        entityType: "Site",
        entityId: created.id,
        beforeMarker: null,
        afterMarker: {
          projectId: project.id,
          slug: input.slug,
          name: input.name,
          enabled: input.enabled,
          version: created.version,
        },
        correlationId: scope.correlationId,
      });
      return { id: created.id, version: created.version };
    },
  });

  const saveProviderConnection = defineCommand<
    PrincipalContext,
    typeof saveProviderConnectionInputSchema,
    ProjectRegistryAdminCommandResult
  >({
    name: "saveProviderConnection",
    input: saveProviderConnectionInputSchema,
    authorize: (principal) => {
      if (principal.kind !== "platform-admin" && principal.kind !== "tenant-user") {
        throw new ProjectRegistryAdminError("PROJECT_REGISTRY_ADMIN_ACCESS_DENIED");
      }
    },
    execute: async ({ principal, input, transaction }) => {
      const repository = dependencies.createRepository(transaction);
      if ("id" in input) {
        const existing = await repository.findProviderConnectionForAction(input.id);
        if (!existing) {
          throw new ProjectRegistryAdminError(
            "PROVIDER_CONNECTION_NOT_FOUND_OR_FORBIDDEN",
          );
        }
        const scope = requireProjectRegistryManagementScope(
          principal,
          existing.organizationId,
        );
        if (existing.version !== input.version) {
          throw new ProjectRegistryAdminError("PROVIDER_CONNECTION_STALE");
        }
        const updated = await repository.updateProviderConnection(
          input,
          scope.organizationId,
        );
        if (!updated) {
          throw new ProjectRegistryAdminError("PROVIDER_CONNECTION_STALE");
        }
        const version = nextResourceVersion(
          input.version,
          "PROVIDER_CONNECTION_STALE",
        );
        await repository.appendAudit({
          actorId: scope.actorId,
          organizationId: scope.organizationId,
          action: "provider-connection.update",
          entityType: "ProviderConnection",
          entityId: input.id,
          beforeMarker: {
            siteId: existing.siteId,
            provider: existing.provider,
            enabled: existing.enabled,
            externalId: existing.externalId,
            version: input.version,
          },
          afterMarker: {
            siteId: existing.siteId,
            provider: existing.provider,
            enabled: input.enabled,
            externalId: input.externalId,
            version,
          },
          correlationId: scope.correlationId,
        });
        return { id: input.id, version };
      }

      const site = await repository.findSiteForAction(input.siteId);
      if (!site) {
        throw new ProjectRegistryAdminError(
          "PROVIDER_CONNECTION_REFERENCE_INVALID",
        );
      }
      const scope = requireProjectRegistryManagementScope(
        principal,
        site.organizationId,
      );
      const created = await repository.createProviderConnection(
        input,
        scope.organizationId,
      );
      await repository.appendAudit({
        actorId: scope.actorId,
        organizationId: scope.organizationId,
        action: "provider-connection.create",
        entityType: "ProviderConnection",
        entityId: created.id,
        beforeMarker: null,
        afterMarker: {
          siteId: site.id,
          provider: input.provider,
          enabled: input.enabled,
          externalId: input.externalId,
          version: created.version,
        },
        correlationId: scope.correlationId,
      });
      return { id: created.id, version: created.version };
    },
  });

  const confirmMetricaGoals = defineCommand<PrincipalContext, typeof confirmMetricaGoalsInputSchema, { connectionId: string }>({
    name: "confirmMetricaGoals",
    input: confirmMetricaGoalsInputSchema,
    authorize: (principal) => { if (principal.kind !== "platform-admin") throw new ProjectRegistryAdminError("PROJECT_REGISTRY_ADMIN_ACCESS_DENIED"); },
    execute: async ({ principal, input, transaction }) => {
      if (principal.kind !== "platform-admin") throw new ProjectRegistryAdminError("PROJECT_REGISTRY_ADMIN_ACCESS_DENIED");
      const repository = dependencies.createRepository(transaction);
      const site = await repository.findSiteForAction(input.siteId);
      if (!site) throw new ProjectRegistryAdminError("PROVIDER_CONNECTION_NOT_FOUND_OR_FORBIDDEN");
      const scope = requireProjectRegistryManagementScope(principal, site.organizationId);
      const result = await repository.confirmMetricaGoals(input, scope.organizationId);
      await repository.appendAudit({ actorId: scope.actorId, organizationId: scope.organizationId, action: "metrica-goals.confirm", entityType: "ProviderConnection", entityId: result.connectionId, beforeMarker: null, afterMarker: { siteId: input.siteId, projectId: result.projectId, categories: ["LEAD_SUBMIT", "PHONE_CLICK"] }, correlationId: scope.correlationId });
      return { connectionId: result.connectionId };
    },
  });

  const saveGoalDefinition = defineCommand<
    PrincipalContext,
    typeof saveGoalDefinitionInputSchema,
    ProjectRegistryAdminCommandResult
  >({
    name: "saveGoalDefinition",
    input: saveGoalDefinitionInputSchema,
    authorize: (principal) => {
      if (principal.kind !== "platform-admin" && principal.kind !== "tenant-user") {
        throw new ProjectRegistryAdminError("PROJECT_REGISTRY_ADMIN_ACCESS_DENIED");
      }
    },
    execute: async ({ principal, input, transaction }) => {
      const repository = dependencies.createRepository(transaction);
      if ("id" in input) {
        const existing = await repository.findGoalDefinitionForAction(input.id);
        if (!existing) {
          throw new ProjectRegistryAdminError("GOAL_DEFINITION_NOT_FOUND_OR_FORBIDDEN");
        }
        const scope = requireProjectRegistryManagementScope(
          principal,
          existing.organizationId,
        );
        if (existing.version !== input.version) {
          throw new ProjectRegistryAdminError("GOAL_DEFINITION_STALE");
        }
        await repository.assertProjectSiteScope(
          existing.projectId,
          scope.organizationId,
          input.siteIds,
        );
        const updated = await repository.updateGoalDefinition(input, scope.organizationId);
        if (!updated) {
          throw new ProjectRegistryAdminError("GOAL_DEFINITION_STALE");
        }
        await repository.replaceGoalDefinitionSiteScopes(
          input.id,
          scope.organizationId,
          input.siteIds,
        );
        const version = nextResourceVersion(input.version, "GOAL_DEFINITION_STALE");
        await repository.appendAudit({
          actorId: scope.actorId,
          organizationId: scope.organizationId,
          action: "goal-definition.update",
          entityType: "GoalDefinition",
          entityId: input.id,
          beforeMarker: {
            projectId: existing.projectId,
            externalGoalId: existing.externalGoalId,
            includeInSeoConversion: existing.includeInSeoConversion,
            siteIds: existing.siteIds,
            version: input.version,
          },
          afterMarker: {
            projectId: existing.projectId,
            externalGoalId: existing.externalGoalId,
            includeInSeoConversion: input.includeInSeoConversion,
            siteIds: input.siteIds,
            version,
          },
          correlationId: scope.correlationId,
        });
        return { id: input.id, version };
      }

      const project = await repository.findProjectParent(input.projectId);
      if (!project) {
        throw new ProjectRegistryAdminError("GOAL_DEFINITION_REFERENCE_INVALID");
      }
      const scope = requireProjectRegistryManagementScope(
        principal,
        project.organizationId,
      );
      await repository.assertProjectSiteScope(project.id, scope.organizationId, input.siteIds);
      const created = await repository.createGoalDefinition(input, scope.organizationId);
      await repository.replaceGoalDefinitionSiteScopes(
        created.id,
        scope.organizationId,
        input.siteIds,
      );
      await repository.appendAudit({
        actorId: scope.actorId,
        organizationId: scope.organizationId,
        action: "goal-definition.create",
        entityType: "GoalDefinition",
        entityId: created.id,
        beforeMarker: null,
        afterMarker: {
          projectId: project.id,
          externalGoalId: input.externalGoalId,
          includeInSeoConversion: input.includeInSeoConversion,
          siteIds: input.siteIds,
          version: created.version,
        },
        correlationId: scope.correlationId,
      });
      return { id: created.id, version: created.version };
    },
  });

  const saveTrackedQuerySet = defineCommand<
    PrincipalContext,
    typeof saveTrackedQuerySetInputSchema,
    ProjectRegistryAdminCommandResult
  >({
    name: "saveTrackedQuerySet",
    input: saveTrackedQuerySetInputSchema,
    authorize: (principal) => {
      if (principal.kind !== "platform-admin" && principal.kind !== "tenant-user") {
        throw new ProjectRegistryAdminError("PROJECT_REGISTRY_ADMIN_ACCESS_DENIED");
      }
    },
    execute: async ({ principal, input, transaction }) => {
      const repository = dependencies.createRepository(transaction);
      if ("id" in input) {
        const existing = await repository.findTrackedQuerySetForAction(input.id);
        if (!existing) {
          throw new ProjectRegistryAdminError("TRACKED_QUERY_SET_NOT_FOUND_OR_FORBIDDEN");
        }
        const scope = requireProjectRegistryManagementScope(
          principal,
          existing.organizationId,
        );
        if (existing.version !== input.version) {
          throw new ProjectRegistryAdminError("TRACKED_QUERY_SET_STALE");
        }
        const updated = await repository.updateTrackedQuerySet(input, scope.organizationId);
        if (!updated) {
          throw new ProjectRegistryAdminError("TRACKED_QUERY_SET_STALE");
        }
        await repository.replaceTrackedQueries(input.id, scope.organizationId, input.queries);
        const version = nextResourceVersion(input.version, "TRACKED_QUERY_SET_STALE");
        await repository.appendAudit({
          actorId: scope.actorId,
          organizationId: scope.organizationId,
          action: "tracked-query-set.update",
          entityType: "TrackedQuerySet",
          entityId: input.id,
          beforeMarker: {
            siteId: existing.siteId,
            baselineLabel: existing.baselineLabel,
            expectedCount: existing.expectedCount,
            queries: existing.queries,
            version: input.version,
          },
          afterMarker: {
            siteId: existing.siteId,
            baselineLabel: input.baselineLabel,
            expectedCount: input.queries.length,
            queries: input.queries,
            version,
          },
          correlationId: scope.correlationId,
        });
        return { id: input.id, version };
      }

      const site = await repository.findSiteForAction(input.siteId);
      if (!site) {
        throw new ProjectRegistryAdminError("TRACKED_QUERY_SET_REFERENCE_INVALID");
      }
      const scope = requireProjectRegistryManagementScope(
        principal,
        site.organizationId,
      );
      const created = await repository.createTrackedQuerySet(input, scope.organizationId);
      await repository.replaceTrackedQueries(created.id, scope.organizationId, input.queries);
      await repository.appendAudit({
        actorId: scope.actorId,
        organizationId: scope.organizationId,
        action: "tracked-query-set.create",
        entityType: "TrackedQuerySet",
        entityId: created.id,
        beforeMarker: null,
        afterMarker: {
          siteId: site.id,
          baselineLabel: input.baselineLabel,
          expectedCount: input.queries.length,
          queries: input.queries,
          version: created.version,
        },
        correlationId: scope.correlationId,
      });
      return { id: created.id, version: created.version };
    },
  });

  const saveThresholdProfile = defineCommand<
    PrincipalContext,
    typeof saveThresholdProfileInputSchema,
    ProjectRegistryAdminCommandResult
  >({
    name: "saveThresholdProfile",
    input: saveThresholdProfileInputSchema,
    authorize: (principal) => {
      requirePlatformProfileManagement(principal);
    },
    execute: async ({ principal, input, transaction }) => {
      const repository = dependencies.createRepository(transaction);
      const scope = requirePlatformProfileManagement(principal);
      if ("id" in input) {
        const existing = await repository.findThresholdProfileForAction(input.id);
        if (!existing) {
          throw new ProjectRegistryAdminError("THRESHOLD_PROFILE_NOT_FOUND_OR_FORBIDDEN");
        }
        if (existing.version !== input.version) {
          throw new ProjectRegistryAdminError("THRESHOLD_PROFILE_STALE");
        }
        const updated = await repository.updateThresholdProfile(input);
        if (!updated) {
          throw new ProjectRegistryAdminError("THRESHOLD_PROFILE_STALE");
        }
        const version = nextResourceVersion(input.version, "THRESHOLD_PROFILE_STALE");
        await repository.appendAudit({
          actorId: scope.actorId,
          organizationId: null,
          action: "threshold-profile.update",
          entityType: "ThresholdProfile",
          entityId: input.id,
          beforeMarker: {
            slug: existing.slug,
            minimumShows: existing.minimumShows,
            version: input.version,
          },
          afterMarker: {
            slug: existing.slug,
            minimumShows: input.minimumShows,
            version,
          },
          correlationId: scope.correlationId,
        });
        return { id: input.id, version };
      }

      const created = await repository.createThresholdProfile(input);
      await repository.appendAudit({
        actorId: scope.actorId,
        organizationId: null,
        action: "threshold-profile.create",
        entityType: "ThresholdProfile",
        entityId: created.id,
        beforeMarker: null,
        afterMarker: {
          slug: input.slug,
          minimumShows: input.minimumShows,
          version: created.version,
        },
        correlationId: scope.correlationId,
      });
      return { id: created.id, version: created.version };
    },
  });

  const saveQueryClusterProfile = defineCommand<
    PrincipalContext,
    typeof saveQueryClusterProfileInputSchema,
    ProjectRegistryAdminCommandResult
  >({
    name: "saveQueryClusterProfile",
    input: saveQueryClusterProfileInputSchema,
    authorize: (principal) => {
      requirePlatformProfileManagement(principal);
    },
    execute: async ({ principal, input, transaction }) => {
      const repository = dependencies.createRepository(transaction);
      const scope = requirePlatformProfileManagement(principal);
      if ("id" in input) {
        const existing = await repository.findQueryClusterProfileForAction(input.id);
        if (!existing) {
          throw new ProjectRegistryAdminError(
            "QUERY_CLUSTER_PROFILE_NOT_FOUND_OR_FORBIDDEN",
          );
        }
        if (existing.version !== input.version) {
          throw new ProjectRegistryAdminError("QUERY_CLUSTER_PROFILE_STALE");
        }
        const updated = await repository.updateQueryClusterProfile(input);
        if (!updated) {
          throw new ProjectRegistryAdminError("QUERY_CLUSTER_PROFILE_STALE");
        }
        await repository.replaceQueryClusterGroups(input.id, input.groups);
        const version = nextResourceVersion(
          input.version,
          "QUERY_CLUSTER_PROFILE_STALE",
        );
        await repository.appendAudit({
          actorId: scope.actorId,
          organizationId: null,
          action: "query-cluster-profile.update",
          entityType: "QueryClusterProfile",
          entityId: input.id,
          beforeMarker: {
            slug: existing.slug,
            name: existing.name,
            groups: existing.groups.length,
            version: input.version,
          },
          afterMarker: {
            slug: existing.slug,
            name: input.name,
            groups: input.groups.length,
            version,
          },
          correlationId: scope.correlationId,
        });
        return { id: input.id, version };
      }

      const created = await repository.createQueryClusterProfile(input);
      await repository.replaceQueryClusterGroups(created.id, input.groups);
      await repository.appendAudit({
        actorId: scope.actorId,
        organizationId: null,
        action: "query-cluster-profile.create",
        entityType: "QueryClusterProfile",
        entityId: created.id,
        beforeMarker: null,
        afterMarker: {
          slug: input.slug,
          name: input.name,
          groups: input.groups.length,
          version: created.version,
        },
        correlationId: scope.correlationId,
      });
      return { id: created.id, version: created.version };
    },
  });

  return {
    saveSite,
    saveProviderConnection,
    confirmMetricaGoals,
    saveGoalDefinition,
    saveTrackedQuerySet,
    saveThresholdProfile,
    saveQueryClusterProfile,
  };
}
