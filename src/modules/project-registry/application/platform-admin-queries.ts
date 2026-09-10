import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import {
  goalDefinitionListQuerySchema,
  providerConnectionListQuerySchema,
  queryClusterProfileListQuerySchema,
  siteListQuerySchema,
  thresholdProfileListQuerySchema,
  trackedQuerySetListQuerySchema,
} from "../domain/platform-admin.ts";
import {
  requirePlatformProfileManagement,
  requireProjectRegistryReadScope,
} from "./platform-admin-authorization.ts";
import type { PlatformAdminQueryRepository } from "./ports/platform-admin-query-repository.ts";

export interface PlatformAdminQueryDependencies {
  createRepository(scope: ReturnType<typeof requireProjectRegistryReadScope>): PlatformAdminQueryRepository;
}

export function createPlatformAdminQueries(
  dependencies: PlatformAdminQueryDependencies,
) {
  const withManagementRepository = (principal: PrincipalContext) =>
    dependencies.createRepository(requireProjectRegistryReadScope(principal));

  async function listSites(principal: PrincipalContext, rawQuery: Partial<Parameters<typeof siteListQuerySchema.parse>[0]>) {
    return withManagementRepository(principal).listSites(siteListQuerySchema.parse(rawQuery));
  }

  async function listProviderConnections(
    principal: PrincipalContext,
    rawQuery: Partial<Parameters<typeof providerConnectionListQuerySchema.parse>[0]>,
  ) {
    return withManagementRepository(principal).listProviderConnections(
      providerConnectionListQuerySchema.parse(rawQuery),
    );
  }

  async function listGoalDefinitions(
    principal: PrincipalContext,
    rawQuery: Partial<Parameters<typeof goalDefinitionListQuerySchema.parse>[0]>,
  ) {
    return withManagementRepository(principal).listGoalDefinitions(
      goalDefinitionListQuerySchema.parse(rawQuery),
    );
  }

  async function listTrackedQuerySets(
    principal: PrincipalContext,
    rawQuery: Partial<Parameters<typeof trackedQuerySetListQuerySchema.parse>[0]>,
  ) {
    return withManagementRepository(principal).listTrackedQuerySets(
      trackedQuerySetListQuerySchema.parse(rawQuery),
    );
  }

  async function listThresholdProfiles(
    principal: PrincipalContext,
    rawQuery: Partial<Parameters<typeof thresholdProfileListQuerySchema.parse>[0]>,
  ) {
    requirePlatformProfileManagement(principal);
    return withManagementRepository(principal).listThresholdProfiles(
      thresholdProfileListQuerySchema.parse(rawQuery),
    );
  }

  async function listQueryClusterProfiles(
    principal: PrincipalContext,
    rawQuery: Partial<Parameters<typeof queryClusterProfileListQuerySchema.parse>[0]>,
  ) {
    requirePlatformProfileManagement(principal);
    return withManagementRepository(principal).listQueryClusterProfiles(
      queryClusterProfileListQuerySchema.parse(rawQuery),
    );
  }

  async function getProjectRegistryAdminFormOptions(principal: PrincipalContext) {
    return withManagementRepository(principal).listFormOptions();
  }

  return {
    listSites,
    listProviderConnections,
    listGoalDefinitions,
    listTrackedQuerySets,
    listThresholdProfiles,
    listQueryClusterProfiles,
    getProjectRegistryAdminFormOptions,
  };
}
