import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { runInProjectPrincipalDatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  projectCatalogSelectionQuerySchema,
  type ProjectCatalogSelectionQuery,
  type ProjectCatalogSnapshotSelection,
} from "../contracts.ts";
import { SharedCatalogError } from "../domain/shared-catalog-error.ts";

function requireSubscriptionReader(principal: PrincipalContext, organizationId: string) {
  if (principal.kind === "platform-admin") return;
  if (principal.organizationId !== organizationId) {
    throw new SharedCatalogError("SHARED_CATALOG_SUBSCRIPTION_ACCESS_DENIED");
  }
}

export async function getProjectCatalogSnapshotSelection(
  principal: PrincipalContext,
  rawQuery: ProjectCatalogSelectionQuery,
): Promise<ProjectCatalogSnapshotSelection> {
  const query = projectCatalogSelectionQuerySchema.parse(rawQuery);
  requireSubscriptionReader(principal, query.organizationId);
  return runInProjectPrincipalDatabaseTransaction(principal, query.projectId, async (transaction) => {
    const subscription = await transaction.projectCatalogSubscription.findUnique({
      where: { organizationId_projectId: query },
      include: {
        cities: { orderBy: { cityUid: "asc" }, select: { cityUid: true } },
        selections: { orderBy: { developmentUid: "asc" }, select: { developmentUid: true, decision: true } },
      },
    });
    if (!subscription) throw new SharedCatalogError("SHARED_CATALOG_SUBSCRIPTION_NOT_FOUND");
    const cityUids = subscription.cities.map((city) => city.cityUid);
    const included = subscription.selections.filter((selection) => selection.decision === "INCLUDE").map((selection) => selection.developmentUid);
    const excluded = subscription.selections.filter((selection) => selection.decision === "EXCLUDE").map((selection) => selection.developmentUid);
    const developments = await transaction.development.findMany({
      where: {
        lifecycle: "ACTIVE",
        mergedIntoUid: null,
        developer: { lifecycle: "ACTIVE", mergedIntoUid: null },
        uid: subscription.mode === "CURATED" ? { in: included, notIn: excluded } : { notIn: excluded },
        ...(subscription.mode === "ALL_SHARED" ? { cityUid: { in: cityUids } } : {}),
      },
      orderBy: { uid: "asc" },
      select: {
        uid: true, developerUid: true, cityUid: true,
        buildings: { where: { lifecycle: "ACTIVE", mergedIntoUid: null }, orderBy: { uid: "asc" }, select: { uid: true } },
      },
    });
    return {
      organizationId: query.organizationId,
      projectId: query.projectId,
      mode: subscription.mode,
      version: subscription.version,
      cityUids,
      developments: developments.map((development) => ({
        uid: development.uid,
        developerUid: development.developerUid,
        cityUid: development.cityUid,
        buildingUids: development.buildings.map((building) => building.uid),
      })),
    };
  });
}
