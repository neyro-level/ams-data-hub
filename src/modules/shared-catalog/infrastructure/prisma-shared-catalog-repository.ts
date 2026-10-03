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

export class PrismaSharedCatalogRepository implements SharedCatalogRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async createDeveloper(input: DeveloperWrite): Promise<CatalogWriteResult> {
    try {
      return await this.transaction.developer.create({
        data: {
          uid: input.uid, name: input.name, normalizedName: input.normalizedName,
          lifecycle: input.lifecycle,
          aliases: { create: aliases(input.aliases, input.normalizedAliases) },
        },
        select: { uid: true, version: true },
      });
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
      return { uid: input.uid, version: input.version + 1 };
    } catch (error) { translateWriteError(error); }
  }

  async createDevelopment(input: DevelopmentWrite): Promise<CatalogWriteResult> {
    try {
      return await this.transaction.development.create({
        data: {
          uid: input.uid, developerUid: input.developerUid, cityUid: input.cityUid,
          districtUid: input.districtUid, name: input.name, normalizedName: input.normalizedName,
          lifecycle: input.lifecycle,
          aliases: { create: aliases(input.aliases, input.normalizedAliases) },
        }, select: { uid: true, version: true },
      });
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
      return { uid: input.uid, version: input.version + 1 };
    } catch (error) { translateWriteError(error); }
  }

  async createBuilding(input: BuildingWrite): Promise<CatalogWriteResult> {
    try {
      return await this.transaction.building.create({
        data: {
          uid: input.uid, developmentUid: input.developmentUid, label: input.label,
          normalizedLabel: input.normalizedLabel, floors: input.floors,
          commissioningYear: input.commissioningYear, commissioningQuarter: input.commissioningQuarter,
          constructionStatus: input.constructionStatus, material: input.material,
          housingClass: input.housingClass, lifecycle: input.lifecycle,
          aliases: { create: aliases(input.aliases, input.normalizedAliases) },
        }, select: { uid: true, version: true },
      });
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
      return { uid: input.uid, version: input.version + 1 };
    } catch (error) { translateWriteError(error); }
  }

  async merge(input: MergeSharedCatalogEntityInput): Promise<CatalogWriteResult | null> {
    try {
      if (input.entityType === "DEVELOPER") {
        const target = await this.transaction.developer.findFirst({ where: { uid: input.targetUid, mergedIntoUid: null }, select: { uid: true } });
        if (!target) return null;
        const source = await this.transaction.developer.updateMany({
          where: { uid: input.sourceUid, version: input.sourceVersion, mergedIntoUid: null },
          data: { mergedIntoUid: input.targetUid, lifecycle: "ARCHIVED", version: { increment: 1 } },
        });
        if (source.count !== 1) return null;
        await this.transaction.development.updateMany({ where: { developerUid: input.sourceUid }, data: { developerUid: input.targetUid, version: { increment: 1 } } });
      } else if (input.entityType === "DEVELOPMENT") {
        const target = await this.transaction.development.findFirst({ where: { uid: input.targetUid, mergedIntoUid: null }, select: { uid: true } });
        if (!target) return null;
        const source = await this.transaction.development.updateMany({
          where: { uid: input.sourceUid, version: input.sourceVersion, mergedIntoUid: null },
          data: { mergedIntoUid: input.targetUid, lifecycle: "ARCHIVED", version: { increment: 1 } },
        });
        if (source.count !== 1) return null;
        await this.transaction.building.updateMany({ where: { developmentUid: input.sourceUid }, data: { developmentUid: input.targetUid, version: { increment: 1 } } });
      } else {
        const target = await this.transaction.building.findFirst({ where: { uid: input.targetUid, mergedIntoUid: null }, select: { uid: true } });
        if (!target) return null;
        const source = await this.transaction.building.updateMany({
          where: { uid: input.sourceUid, version: input.sourceVersion, mergedIntoUid: null },
          data: { mergedIntoUid: input.targetUid, lifecycle: "ARCHIVED", version: { increment: 1 } },
        });
        if (source.count !== 1) return null;
      }
      return { uid: input.sourceUid, version: input.sourceVersion + 1 };
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
      return result.count === 1 ? { uid: input.uid, version: input.version + 1 } : null;
    } catch (error) { translateWriteError(error); }
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
