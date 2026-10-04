import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type {
  CreateBuildingInput,
  CreateDeveloperInput,
  CreateDevelopmentInput,
  MergeSharedCatalogEntityInput,
  RelinkSharedCatalogEntityInput,
  UpdateBuildingInput,
  UpdateDeveloperInput,
  UpdateDevelopmentInput,
} from "../contracts.ts";
import type {
  CatalogAuditInput,
  CatalogChangedEntity,
  CatalogRevisionInput,
  CatalogWriteResult,
  SharedCatalogRepository,
} from "../application/ports/shared-catalog-repository.ts";
import { SharedCatalogError } from "../domain/shared-catalog-error.ts";

type DeveloperWrite = CreateDeveloperInput & { uid: string; normalizedName: string; normalizedAliases: string[] };
type DeveloperUpdate = UpdateDeveloperInput & { normalizedName: string; normalizedAliases: string[] };
type DevelopmentWrite = CreateDevelopmentInput & { uid: string; normalizedName: string; normalizedAliases: string[] };
type DevelopmentUpdate = UpdateDevelopmentInput & { normalizedName: string; normalizedAliases: string[] };
type BuildingWrite = CreateBuildingInput & { uid: string; normalizedLabel: string; normalizedAliases: string[] };
type BuildingUpdate = UpdateBuildingInput & { normalizedLabel: string; normalizedAliases: string[] };

function aliases(values: string[], normalizedValues: string[]) {
  return values.map((value, index) => ({ value, normalizedValue: normalizedValues[index]! }));
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new SharedCatalogError("SHARED_CATALOG_CONFLICT");
    if (error.code === "P2003") throw new SharedCatalogError("SHARED_CATALOG_REFERENCE_INVALID");
  }
  throw error;
}

function changedEntity(
  entityType: CatalogChangedEntity["entityType"],
  uid: string,
  version: number,
  changeKind: CatalogChangedEntity["changeKind"],
): CatalogChangedEntity {
  return { entityType, uid, version, changeKind };
}

function snapshotValue(value: unknown): Prisma.InputJsonObject {
  return { value: value as Prisma.InputJsonValue };
}

export class PrismaSharedCatalogRepository implements SharedCatalogRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async createDeveloper(input: DeveloperWrite): Promise<CatalogWriteResult> {
    try {
      const result = await this.transaction.developer.create({
        data: {
          uid: input.uid, name: input.name, normalizedName: input.normalizedName,
          lifecycle: input.lifecycle,
          aliases: { create: aliases(input.aliases, input.normalizedAliases) },
        },
        select: { uid: true, version: true },
      });
      return { ...result, changedEntities: [changedEntity("DEVELOPER", result.uid, result.version, "CREATE")] };
    } catch (error) { translateWriteError(error); }
  }

  async updateDeveloper(input: DeveloperUpdate): Promise<CatalogWriteResult | null> {
    try {
      const updated = await this.transaction.developer.updateMany({
        where: { uid: input.uid, version: input.version, mergedIntoUid: null },
        data: { name: input.name, normalizedName: input.normalizedName, lifecycle: input.lifecycle, version: { increment: 1 } },
      });
      if (updated.count !== 1) return null;
      await this.transaction.developerAlias.deleteMany({ where: { developerUid: input.uid } });
      if (input.aliases.length) await this.transaction.developerAlias.createMany({
        data: aliases(input.aliases, input.normalizedAliases).map((alias) => ({ developerUid: input.uid, ...alias })),
      });
      return {
        uid: input.uid,
        version: input.version + 1,
        changedEntities: [changedEntity("DEVELOPER", input.uid, input.version + 1, "UPDATE")],
      };
    } catch (error) { translateWriteError(error); }
  }

  async createDevelopment(input: DevelopmentWrite): Promise<CatalogWriteResult> {
    try {
      const result = await this.transaction.development.create({
        data: {
          uid: input.uid, developerUid: input.developerUid, cityUid: input.cityUid,
          districtUid: input.districtUid, name: input.name, normalizedName: input.normalizedName,
          lifecycle: input.lifecycle,
          aliases: { create: aliases(input.aliases, input.normalizedAliases) },
        }, select: { uid: true, version: true },
      });
      return { ...result, changedEntities: [changedEntity("DEVELOPMENT", result.uid, result.version, "CREATE")] };
    } catch (error) { translateWriteError(error); }
  }

  async updateDevelopment(input: DevelopmentUpdate): Promise<CatalogWriteResult | null> {
    try {
      const updated = await this.transaction.development.updateMany({
        where: { uid: input.uid, version: input.version, mergedIntoUid: null },
        data: {
          developerUid: input.developerUid, cityUid: input.cityUid, districtUid: input.districtUid,
          name: input.name, normalizedName: input.normalizedName, lifecycle: input.lifecycle,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return null;
      await this.transaction.developmentAlias.deleteMany({ where: { developmentUid: input.uid } });
      if (input.aliases.length) await this.transaction.developmentAlias.createMany({
        data: aliases(input.aliases, input.normalizedAliases).map((alias) => ({ developmentUid: input.uid, ...alias })),
      });
      return {
        uid: input.uid,
        version: input.version + 1,
        changedEntities: [changedEntity("DEVELOPMENT", input.uid, input.version + 1, "UPDATE")],
      };
    } catch (error) { translateWriteError(error); }
  }

  async createBuilding(input: BuildingWrite): Promise<CatalogWriteResult> {
    try {
      const result = await this.transaction.building.create({
        data: {
          uid: input.uid, developmentUid: input.developmentUid, label: input.label,
          normalizedLabel: input.normalizedLabel, floors: input.floors,
          commissioningYear: input.commissioningYear, commissioningQuarter: input.commissioningQuarter,
          constructionStatus: input.constructionStatus, material: input.material,
          housingClass: input.housingClass, lifecycle: input.lifecycle,
          aliases: { create: aliases(input.aliases, input.normalizedAliases) },
        }, select: { uid: true, version: true },
      });
      return { ...result, changedEntities: [changedEntity("BUILDING", result.uid, result.version, "CREATE")] };
    } catch (error) { translateWriteError(error); }
  }

  async updateBuilding(input: BuildingUpdate): Promise<CatalogWriteResult | null> {
    try {
      const updated = await this.transaction.building.updateMany({
        where: { uid: input.uid, version: input.version, mergedIntoUid: null },
        data: {
          developmentUid: input.developmentUid, label: input.label,
          normalizedLabel: input.normalizedLabel, floors: input.floors,
          commissioningYear: input.commissioningYear, commissioningQuarter: input.commissioningQuarter,
          constructionStatus: input.constructionStatus, material: input.material,
          housingClass: input.housingClass, lifecycle: input.lifecycle, version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return null;
      await this.transaction.buildingAlias.deleteMany({ where: { buildingUid: input.uid } });
      if (input.aliases.length) await this.transaction.buildingAlias.createMany({
        data: aliases(input.aliases, input.normalizedAliases).map((alias) => ({ buildingUid: input.uid, ...alias })),
      });
      return {
        uid: input.uid,
        version: input.version + 1,
        changedEntities: [changedEntity("BUILDING", input.uid, input.version + 1, "UPDATE")],
      };
    } catch (error) { translateWriteError(error); }
  }

  async merge(input: MergeSharedCatalogEntityInput): Promise<CatalogWriteResult | null> {
    try {
      const changedEntities: CatalogChangedEntity[] = [];
      if (input.entityType === "DEVELOPER") {
        const target = await this.transaction.developer.findFirst({ where: { uid: input.targetUid, mergedIntoUid: null }, select: { uid: true } });
        if (!target) return null;
        const source = await this.transaction.developer.updateMany({
          where: { uid: input.sourceUid, version: input.sourceVersion, mergedIntoUid: null },
          data: { mergedIntoUid: input.targetUid, lifecycle: "ARCHIVED", version: { increment: 1 } },
        });
        if (source.count !== 1) return null;
        const dependants = await this.transaction.development.updateManyAndReturn({
          where: { developerUid: input.sourceUid },
          data: { developerUid: input.targetUid, version: { increment: 1 } },
          select: { uid: true, version: true },
        });
        changedEntities.push(...dependants.map((item) => changedEntity("DEVELOPMENT", item.uid, item.version, "MERGE_REASSIGN")));
      } else if (input.entityType === "DEVELOPMENT") {
        const target = await this.transaction.development.findFirst({ where: { uid: input.targetUid, mergedIntoUid: null }, select: { uid: true } });
        if (!target) return null;
        const source = await this.transaction.development.updateMany({
          where: { uid: input.sourceUid, version: input.sourceVersion, mergedIntoUid: null },
          data: { mergedIntoUid: input.targetUid, lifecycle: "ARCHIVED", version: { increment: 1 } },
        });
        if (source.count !== 1) return null;
        const dependants = await this.transaction.building.updateManyAndReturn({
          where: { developmentUid: input.sourceUid },
          data: { developmentUid: input.targetUid, version: { increment: 1 } },
          select: { uid: true, version: true },
        });
        changedEntities.push(...dependants.map((item) => changedEntity("BUILDING", item.uid, item.version, "MERGE_REASSIGN")));
      } else {
        const target = await this.transaction.building.findFirst({ where: { uid: input.targetUid, mergedIntoUid: null }, select: { uid: true } });
        if (!target) return null;
        const source = await this.transaction.building.updateMany({
          where: { uid: input.sourceUid, version: input.sourceVersion, mergedIntoUid: null },
          data: { mergedIntoUid: input.targetUid, lifecycle: "ARCHIVED", version: { increment: 1 } },
        });
        if (source.count !== 1) return null;
      }
      changedEntities.unshift(changedEntity(input.entityType, input.sourceUid, input.sourceVersion + 1, "MERGE"));
      return { uid: input.sourceUid, version: input.sourceVersion + 1, changedEntities };
    } catch (error) { translateWriteError(error); }
  }

  async relink(input: RelinkSharedCatalogEntityInput): Promise<CatalogWriteResult | null> {
    try {
      const result = input.entityType === "DEVELOPMENT"
        ? await this.transaction.development.updateMany({
            where: { uid: input.uid, version: input.version, mergedIntoUid: null },
            data: { developerUid: input.developerUid, cityUid: input.cityUid, districtUid: input.districtUid, version: { increment: 1 } },
          })
        : await this.transaction.building.updateMany({
            where: { uid: input.uid, version: input.version, mergedIntoUid: null },
            data: { developmentUid: input.developmentUid, version: { increment: 1 } },
          });
      return result.count === 1 ? {
        uid: input.uid,
        version: input.version + 1,
        changedEntities: [changedEntity(input.entityType, input.uid, input.version + 1, "RELINK")],
      } : null;
    } catch (error) { translateWriteError(error); }
  }

  private async readSnapshot(entity: CatalogChangedEntity): Promise<Prisma.InputJsonObject> {
    if (entity.entityType === "DEVELOPER") {
      const row = await this.transaction.developer.findUniqueOrThrow({
        where: { uid: entity.uid },
        include: { aliases: { orderBy: { normalizedValue: "asc" }, select: { value: true } } },
      });
      return {
        uid: row.uid, version: row.version, name: row.name, lifecycle: row.lifecycle,
        mergedIntoUid: row.mergedIntoUid, aliases: row.aliases.map((alias) => alias.value),
      };
    }
    if (entity.entityType === "DEVELOPMENT") {
      const row = await this.transaction.development.findUniqueOrThrow({
        where: { uid: entity.uid },
        include: { aliases: { orderBy: { normalizedValue: "asc" }, select: { value: true } } },
      });
      return {
        uid: row.uid, version: row.version, developerUid: row.developerUid,
        cityUid: row.cityUid, districtUid: row.districtUid, name: row.name,
        lifecycle: row.lifecycle, mergedIntoUid: row.mergedIntoUid,
        aliases: row.aliases.map((alias) => alias.value),
      };
    }
    const row = await this.transaction.building.findUniqueOrThrow({
      where: { uid: entity.uid },
      include: { aliases: { orderBy: { normalizedValue: "asc" }, select: { value: true } } },
    });
    return {
      uid: row.uid, version: row.version, developmentUid: row.developmentUid,
      label: row.label, floors: row.floors, commissioningYear: row.commissioningYear,
      commissioningQuarter: row.commissioningQuarter, constructionStatus: row.constructionStatus,
      material: row.material, housingClass: row.housingClass, lifecycle: row.lifecycle,
      mergedIntoUid: row.mergedIntoUid, aliases: row.aliases.map((alias) => alias.value),
    };
  }

  async appendRevision(input: CatalogRevisionInput): Promise<void> {
    if (input.entities.length === 0) throw new SharedCatalogError("SHARED_CATALOG_REVISION_EMPTY");
    const changeSet = await this.transaction.catalogChangeSet.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        source: "MANUAL_ADMIN",
        correlationId: input.correlationId,
      },
      select: { id: true },
    });

    for (const entity of input.entities) {
      const snapshot = await this.readSnapshot(entity);
      const previous = entity.version > 1
        ? await this.transaction.catalogEntityVersion.findUnique({
            where: { entityType_entityUid_version: {
              entityType: entity.entityType, entityUid: entity.uid, version: entity.version - 1,
            } },
            select: { snapshot: true },
          })
        : null;
      const previousSnapshot = previous?.snapshot && typeof previous.snapshot === "object" && !Array.isArray(previous.snapshot)
        ? previous.snapshot as Record<string, unknown>
        : null;
      const changedFields = Object.keys(snapshot).filter((field) =>
        !previousSnapshot || JSON.stringify(previousSnapshot[field]) !== JSON.stringify(snapshot[field]),
      );
      const version = await this.transaction.catalogEntityVersion.create({
        data: {
          changeSetId: changeSet.id,
          entityType: entity.entityType,
          entityUid: entity.uid,
          version: entity.version,
          changeKind: entity.changeKind,
          snapshot,
        },
        select: { id: true },
      });
      await this.transaction.factProvenance.createMany({
        data: changedFields.map((fieldPath) => ({
          changeSetId: changeSet.id,
          entityVersionId: version.id,
          entityType: entity.entityType,
          entityUid: entity.uid,
          fieldPath,
          valueSnapshot: snapshotValue(snapshot[fieldPath]),
          source: "MANUAL_ADMIN" as const,
          actorId: input.actorId,
        })),
      });
    }
  }

  async appendAudit(input: CatalogAuditInput): Promise<void> {
    await this.transaction.auditEvent.create({
      data: {
        organizationId: null, actorType: "USER", actorId: input.actorId,
        action: input.action, entityType: input.entityType, entityId: input.entityId,
        beforeMarker: input.beforeMarker ?? Prisma.JsonNull,
        afterMarker: input.afterMarker ?? Prisma.JsonNull,
        source: "shared-catalog", correlationId: input.correlationId,
      },
    });
  }
}
