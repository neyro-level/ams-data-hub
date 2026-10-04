import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { CatalogAdminData, CatalogAdminQuery } from "../contracts.ts";
import { requireSharedCatalogAdmin } from "./shared-catalog-authorization.ts";

export async function getCatalogAdminData(
  principal: PrincipalContext,
  query: CatalogAdminQuery,
): Promise<CatalogAdminData> {
  requireSharedCatalogAdmin(principal);
  const search = query.q || undefined;
  const lifecycle = query.lifecycle === "ALL" ? undefined : query.lifecycle;

  return runInPrincipalDatabaseTransaction(principal, async (transaction) => {
    const [developers, developments, buildings, regions, cities, districts, developerOptions, developmentOptions] = await Promise.all([
      transaction.developer.findMany({
        where: {
          lifecycle,
          ...(query.developerUid ? { uid: query.developerUid } : {}),
          ...((query.regionUid || query.cityUid) ? { developments: { some: {
            ...(query.cityUid ? { cityUid: query.cityUid } : {}),
            ...(query.regionUid ? { city: { regionUid: query.regionUid } } : {}),
          } } } : {}),
          ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { aliases: { some: { value: { contains: search, mode: "insensitive" } } } }] } : {}),
        },
        orderBy: { name: "asc" }, take: 100,
        include: { aliases: { orderBy: { value: "asc" } }, _count: { select: { developments: true } } },
      }),
      transaction.development.findMany({
        where: {
          lifecycle,
          ...(query.cityUid ? { cityUid: query.cityUid } : {}),
          ...(query.regionUid ? { city: { regionUid: query.regionUid } } : {}),
          ...(query.developerUid ? { developerUid: query.developerUid } : {}),
          ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { aliases: { some: { value: { contains: search, mode: "insensitive" } } } }] } : {}),
        },
        orderBy: { name: "asc" }, take: 100,
        include: {
          aliases: { orderBy: { value: "asc" } }, developer: { select: { name: true } },
          city: { select: { name: true } }, district: { select: { name: true } },
          _count: { select: { buildings: true } },
        },
      }),
      transaction.building.findMany({
        where: {
          lifecycle,
          development: {
            ...(query.cityUid ? { cityUid: query.cityUid } : {}),
            ...(query.regionUid ? { city: { regionUid: query.regionUid } } : {}),
            ...(query.developerUid ? { developerUid: query.developerUid } : {}),
          },
          ...(search ? { OR: [{ label: { contains: search, mode: "insensitive" } }, { aliases: { some: { value: { contains: search, mode: "insensitive" } } } }] } : {}),
        },
        orderBy: { label: "asc" }, take: 100,
        include: { aliases: { orderBy: { value: "asc" } }, development: { select: { name: true } } },
      }),
      transaction.region.findMany({ orderBy: { name: "asc" }, select: { uid: true, name: true } }),
      transaction.city.findMany({ orderBy: { name: "asc" }, select: { uid: true, regionUid: true, name: true } }),
      transaction.district.findMany({ orderBy: { name: "asc" }, select: { uid: true, cityUid: true, name: true } }),
      transaction.developer.findMany({ where: { mergedIntoUid: null }, orderBy: { name: "asc" }, select: { uid: true, name: true } }),
      transaction.development.findMany({ where: { mergedIntoUid: null }, orderBy: { name: "asc" }, select: { uid: true, name: true } }),
    ]);

    const historyTargets = [
      ...developers.map((item) => ({ entityType: "DEVELOPER" as const, entityUid: item.uid })),
      ...developments.map((item) => ({ entityType: "DEVELOPMENT" as const, entityUid: item.uid })),
      ...buildings.map((item) => ({ entityType: "BUILDING" as const, entityUid: item.uid })),
    ];
    const history = historyTargets.length === 0 ? [] : await transaction.catalogEntityVersion.findMany({
      where: { OR: historyTargets },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      include: {
        changeSet: { select: { action: true, source: true, actorId: true } },
        provenance: { orderBy: { fieldPath: "asc" }, select: { fieldPath: true } },
      },
    });

    return {
      developers: developers.map((item) => ({ uid: item.uid, name: item.name, lifecycle: item.lifecycle, version: item.version, aliases: item.aliases.map((alias) => alias.value), developmentCount: item._count.developments, updatedAt: item.updatedAt.toISOString() })),
      developments: developments.map((item) => ({ uid: item.uid, developerUid: item.developerUid, developerName: item.developer.name, cityUid: item.cityUid, cityName: item.city.name, districtUid: item.districtUid, districtName: item.district?.name ?? null, name: item.name, lifecycle: item.lifecycle, version: item.version, aliases: item.aliases.map((alias) => alias.value), buildingCount: item._count.buildings, updatedAt: item.updatedAt.toISOString() })),
      buildings: buildings.map((item) => ({ uid: item.uid, developmentUid: item.developmentUid, developmentName: item.development.name, label: item.label, floors: item.floors, commissioningYear: item.commissioningYear, commissioningQuarter: item.commissioningQuarter, constructionStatus: item.constructionStatus, material: item.material, housingClass: item.housingClass, lifecycle: item.lifecycle, version: item.version, aliases: item.aliases.map((alias) => alias.value), updatedAt: item.updatedAt.toISOString() })),
      history: history.map((item) => ({
        id: item.id,
        entityType: item.entityType,
        entityUid: item.entityUid,
        version: item.version,
        changeKind: item.changeKind,
        action: item.changeSet.action,
        source: item.changeSet.source,
        actorId: item.changeSet.actorId,
        changedFields: item.provenance.map((fact) => fact.fieldPath),
        createdAt: item.createdAt.toISOString(),
      })),
      options: { developers: developerOptions, developments: developmentOptions, regions, cities, districts },
    };
  });
}
