import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ReplaceProjectCatalogSubscriptionInput } from "../contracts.ts";
import type {
  CatalogSubscriptionAuditInput,
  CatalogSubscriptionRepository,
} from "../application/ports/catalog-subscription-repository.ts";
import { SharedCatalogError } from "../domain/shared-catalog-error.ts";

function toJsonMarker(marker: NonNullable<CatalogSubscriptionAuditInput["beforeMarker"]>): Prisma.InputJsonObject {
  return {
    mode: marker.mode,
    version: marker.version,
    cityUids: marker.cityUids,
    selections: marker.selections.map((selection) => ({
      developmentUid: selection.developmentUid,
      decision: selection.decision,
    })),
  };
}

function translateSubscriptionWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new SharedCatalogError("SHARED_CATALOG_SUBSCRIPTION_STALE");
    if (error.code === "P2003") throw new SharedCatalogError("SHARED_CATALOG_REFERENCE_INVALID");
  }
  throw error;
}

export class PrismaCatalogSubscriptionRepository implements CatalogSubscriptionRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async projectExists(organizationId: string, projectId: string): Promise<boolean> {
    return (await this.transaction.project.count({ where: { id: projectId, organizationId } })) === 1;
  }

  async findSubscription(organizationId: string, projectId: string) {
    const subscription = await this.transaction.projectCatalogSubscription.findUnique({
      where: { organizationId_projectId: { organizationId, projectId } },
      include: {
        cities: { orderBy: { cityUid: "asc" }, select: { cityUid: true } },
        selections: { orderBy: { developmentUid: "asc" }, select: { developmentUid: true, decision: true } },
      },
    });
    return subscription ? {
      mode: subscription.mode,
      version: subscription.version,
      cityUids: subscription.cities.map((city) => city.cityUid),
      selections: subscription.selections,
    } : null;
  }

  countCities(cityUids: string[]): Promise<number> {
    return cityUids.length ? this.transaction.city.count({ where: { uid: { in: cityUids } } }) : Promise.resolve(0);
  }

  countDevelopments(developmentUids: string[]): Promise<number> {
    return developmentUids.length
      ? this.transaction.development.count({ where: { uid: { in: developmentUids }, mergedIntoUid: null } })
      : Promise.resolve(0);
  }

  async replaceSubscription(input: ReplaceProjectCatalogSubscriptionInput): Promise<number | null> {
    try {
      const nextVersion = input.version + 1;
      if (input.version === 0) {
        await this.transaction.projectCatalogSubscription.create({
          data: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            mode: input.mode,
            version: nextVersion,
            cities: { createMany: { data: input.cityUids.map((cityUid) => ({ cityUid })) } },
            selections: { createMany: { data: input.selections } },
          },
        });
        return nextVersion;
      }
      const updated = await this.transaction.projectCatalogSubscription.updateMany({
        where: { organizationId: input.organizationId, projectId: input.projectId, version: input.version },
        data: { mode: input.mode, version: { increment: 1 } },
      });
      if (updated.count !== 1) return null;
      await this.transaction.projectCatalogSubscriptionCity.deleteMany({
        where: { organizationId: input.organizationId, projectId: input.projectId },
      });
      await this.transaction.projectCatalogSubscriptionSelection.deleteMany({
        where: { organizationId: input.organizationId, projectId: input.projectId },
      });
      if (input.cityUids.length) await this.transaction.projectCatalogSubscriptionCity.createMany({
        data: input.cityUids.map((cityUid) => ({ organizationId: input.organizationId, projectId: input.projectId, cityUid })),
      });
      if (input.selections.length) await this.transaction.projectCatalogSubscriptionSelection.createMany({
        data: input.selections.map((selection) => ({ organizationId: input.organizationId, projectId: input.projectId, ...selection })),
      });
      return nextVersion;
    } catch (error) {
      translateSubscriptionWriteError(error);
    }
  }

  async appendAudit(input: CatalogSubscriptionAuditInput): Promise<void> {
    await this.transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: "USER",
        actorId: input.actorId,
        action: "catalog-subscription.replace",
        entityType: "ProjectCatalogSubscription",
        entityId: input.projectId,
        beforeMarker: input.beforeMarker ? toJsonMarker(input.beforeMarker) : Prisma.JsonNull,
        afterMarker: toJsonMarker(input.afterMarker),
        source: "shared-catalog",
        correlationId: input.correlationId,
      },
    });
  }
}
