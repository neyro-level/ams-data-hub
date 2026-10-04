import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ReplaceProjectPublicContactInput } from "../contracts.ts";
import { ProjectStateError } from "../domain/project-state-error.ts";
import type { ProjectPublicContactAuditInput, ProjectPublicContactRepository, StoredProjectPublicContact } from "../application/ports/project-public-contact-repository.ts";

function markerToJson(marker: NonNullable<ProjectPublicContactAuditInput["beforeMarker"]>): Prisma.InputJsonObject {
  return {
    hasEmail: marker.hasEmail,
    hasAddress: marker.hasAddress,
    messengerCount: marker.messengerCount,
    hasHours: marker.hasHours,
    version: marker.version,
  };
}

function toStored(contact: { phone: string; email: string | null; addressPublic: string | null; messengers: unknown; hours: string | null; version: number }): StoredProjectPublicContact {
  return {
    ...contact,
    messengers: Array.isArray(contact.messengers) ? contact.messengers.filter((value): value is string => typeof value === "string") : [],
  };
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new ProjectStateError("PROJECT_PUBLIC_CONTACT_STALE");
    if (error.code === "P2003") throw new ProjectStateError("PROJECT_PUBLIC_CONTACT_REFERENCE_INVALID");
  }
  throw error;
}

export class PrismaProjectPublicContactRepository implements ProjectPublicContactRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async projectExists(organizationId: string, projectId: string): Promise<boolean> {
    return await this.transaction.project.count({ where: { organizationId, id: projectId } }) === 1;
  }

  async find(organizationId: string, projectId: string): Promise<StoredProjectPublicContact | null> {
    const contact = await this.transaction.projectPublicContact.findUnique({
      where: { organizationId_projectId: { organizationId, projectId } },
      select: { phone: true, email: true, addressPublic: true, messengers: true, hours: true, version: true },
    });
    return contact ? toStored(contact) : null;
  }

  async replace(input: ReplaceProjectPublicContactInput): Promise<number | null> {
    const data = {
      phone: input.phone,
      email: input.email || null,
      addressPublic: input.addressPublic || null,
      messengers: input.messengers,
      hours: input.hours || null,
    };
    try {
      if (input.version === 0) {
        const created = await this.transaction.projectPublicContact.create({
          data: { organizationId: input.organizationId, projectId: input.projectId, ...data },
          select: { version: true },
        });
        return created.version;
      }
      const updated = await this.transaction.projectPublicContact.updateMany({
        where: { organizationId: input.organizationId, projectId: input.projectId, version: input.version },
        data: { ...data, version: { increment: 1 } },
      });
      return updated.count === 1 ? input.version + 1 : null;
    } catch (error) {
      translateWriteError(error);
    }
  }

  async appendAudit(input: ProjectPublicContactAuditInput): Promise<void> {
    await this.transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: "USER",
        actorId: input.actorId,
        action: "project-public-contact.replace",
        entityType: "ProjectPublicContact",
        entityId: input.projectId,
        beforeMarker: input.beforeMarker ? markerToJson(input.beforeMarker) : Prisma.JsonNull,
        afterMarker: markerToJson(input.afterMarker),
        source: "project-state",
        correlationId: input.correlationId,
      },
    });
  }
}
