import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ProjectEditorialKey, ReplaceEntityEditorialInput, ReplaceEntityMediaOrderPolicyInput } from "../contracts.ts";
import { ProjectStateError } from "../domain/project-state-error.ts";
import type {
  EditorialAuditInput,
  EntityEditorialRepository,
  StoredEntityEditorial,
  StoredEntityMediaOrderPolicy,
} from "../application/ports/entity-editorial-repository.ts";

function faqFromJson(value: unknown): StoredEntityEditorial["faq"] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { question: string; answer: string } => Boolean(
    item && typeof item === "object"
    && typeof (item as { question?: unknown }).question === "string"
    && typeof (item as { answer?: unknown }).answer === "string",
  ));
}

function markerJson(marker: Record<string, string | number | boolean>): Prisma.InputJsonObject {
  return { ...marker };
}

function editorialKey(key: ProjectEditorialKey) {
  return {
    organizationId: key.organizationId,
    projectId: key.projectId,
    entityType: key.entityType,
    entityUid: key.entityUid,
  };
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new ProjectStateError("PROJECT_EDITORIAL_STALE");
    if (error.code === "P2003") throw new ProjectStateError("PROJECT_EDITORIAL_REFERENCE_INVALID");
  }
  throw error;
}

export class PrismaEntityEditorialRepository implements EntityEditorialRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async projectExists(organizationId: string, projectId: string): Promise<boolean> {
    return await this.transaction.project.count({ where: { organizationId, id: projectId } }) === 1;
  }

  async findEditorial(key: ProjectEditorialKey): Promise<StoredEntityEditorial | null> {
    const row = await this.transaction.entityEditorial.findUnique({
      where: { organizationId_projectId_entityType_entityUid: editorialKey(key) },
    });
    return row ? { ...row, faq: faqFromJson(row.faq) } : null;
  }

  findPolicy(key: ProjectEditorialKey): Promise<StoredEntityMediaOrderPolicy | null> {
    return this.transaction.entityMediaOrderPolicy.findUnique({
      where: { organizationId_projectId_entityType_entityUid: editorialKey(key) },
    });
  }

  async replaceEditorial(input: ReplaceEntityEditorialInput, mediaOrderPolicyVersion: number | null): Promise<number | null> {
    const data = {
      shortDescription: input.shortDescription || null,
      description: input.description || null,
      faq: input.faq,
      presentationNotes: input.presentationNotes || null,
      mediaOrder: input.mediaOrder,
      mediaOrderPolicyVersion,
    };
    try {
      if (input.version === 0) {
        const created = await this.transaction.entityEditorial.create({
          data: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            entityType: input.entityType,
            entityUid: input.entityUid,
            ...data,
          },
          select: { version: true },
        });
        return created.version;
      }
      const updated = await this.transaction.entityEditorial.updateMany({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          entityType: input.entityType,
          entityUid: input.entityUid,
          version: input.version,
        },
        data: { ...data, version: { increment: 1 } },
      });
      return updated.count === 1 ? input.version + 1 : null;
    } catch (error) {
      translateWriteError(error);
    }
  }

  async replacePolicy(input: ReplaceEntityMediaOrderPolicyInput): Promise<{ version: number; overrideCleared: boolean } | null> {
    try {
      const nextVersion = input.version + 1;
      const key = {
        organizationId: input.organizationId,
        projectId: input.projectId,
        entityType: input.entityType,
        entityUid: input.entityUid,
      };
      const editorial = await this.transaction.entityEditorial.findUnique({
        where: { organizationId_projectId_entityType_entityUid: key },
        select: { mediaOrder: true },
      });
      const overrideCleared = (editorial?.mediaOrder.length ?? 0) > 0;
      if (input.version === 0) {
        await this.transaction.entityMediaOrderPolicy.create({
          data: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            entityType: input.entityType,
            entityUid: input.entityUid,
            sourceMediaOrder: input.sourceMediaOrder,
            isImageOrderChangeAllowed: input.isImageOrderChangeAllowed,
          },
        });
        return { version: nextVersion, overrideCleared };
      }
      const updated = await this.transaction.entityMediaOrderPolicy.updateMany({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          entityType: input.entityType,
          entityUid: input.entityUid,
          version: input.version,
        },
        data: {
          sourceMediaOrder: input.sourceMediaOrder,
          isImageOrderChangeAllowed: input.isImageOrderChangeAllowed,
          version: { increment: 1 },
        },
      });
      return updated.count === 1 ? { version: nextVersion, overrideCleared } : null;
    } catch (error) {
      translateWriteError(error);
    }
  }

  async appendAudit(input: EditorialAuditInput): Promise<void> {
    await this.transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        entityType: input.action === "entity-editorial.replace" ? "EntityEditorial" : "EntityMediaOrderPolicy",
        entityId: `${input.entityType}:${input.entityUid}`,
        beforeMarker: input.beforeMarker ? markerJson(input.beforeMarker) : Prisma.JsonNull,
        afterMarker: markerJson(input.afterMarker),
        source: "project-state",
        correlationId: input.correlationId,
      },
    });
  }
}
