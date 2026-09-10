import { Prisma } from "../../../generated/prisma/client.ts";
import type { ScopedDb } from "../../../platform/database/scoped-db.ts";
import type {
  ProjectAuditInput,
  ProjectReferenceRepository,
} from "../application/ports/project-reference-repository.ts";
import type {
  CreateProjectInput,
  ProjectStatus,
  UpdateProjectSettingsInput,
} from "../domain/project.ts";
import { ProjectError } from "../domain/project.ts";

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new ProjectError("PROJECT_SLUG_CONFLICT");
    if (error.code === "P2003") throw new ProjectError("PROJECT_REFERENCE_INVALID");
  }
  throw error;
}

export class PrismaProjectReferenceRepository implements ProjectReferenceRepository {
  constructor(private readonly scopedDb: ScopedDb) {}

  async findForAction(projectId: string) {
    return this.scopedDb.transaction.project.findFirst({
      where: { id: projectId, organizationId: this.scopedDb.organizationId },
      select: {
        id: true,
        organizationId: true,
        name: true,
        slug: true,
        status: true,
        thresholdProfileId: true,
        clusterProfileId: true,
        version: true,
      },
    });
  }

  async create(input: CreateProjectInput) {
    try {
      return await this.scopedDb.transaction.project.create({
        data: {
          organizationId: this.scopedDb.organizationId,
          slug: input.slug,
          name: input.name,
          status: input.status,
          thresholdProfileId: input.thresholdProfileId,
          clusterProfileId: input.clusterProfileId,
        },
        select: { id: true, version: true },
      });
    } catch (error) {
      translateWriteError(error);
    }
  }

  async updateStatus(input: {
    projectId: string;
    expectedVersion: number;
    status: ProjectStatus;
  }): Promise<boolean> {
    const result = await this.scopedDb.transaction.project.updateMany({
      where: {
        id: input.projectId,
        organizationId: this.scopedDb.organizationId,
        version: input.expectedVersion,
      },
      data: { status: input.status, version: { increment: 1 } },
    });
    return result.count === 1;
  }

  async updateSettings(
    input: Pick<
      UpdateProjectSettingsInput,
      "projectId" | "version" | "name" | "thresholdProfileId" | "clusterProfileId"
    >,
  ): Promise<boolean> {
    try {
      const result = await this.scopedDb.transaction.project.updateMany({
        where: {
          id: input.projectId,
          organizationId: this.scopedDb.organizationId,
          version: input.version,
        },
        data: {
          name: input.name,
          thresholdProfileId: input.thresholdProfileId,
          clusterProfileId: input.clusterProfileId,
          version: { increment: 1 },
        },
      });
      return result.count === 1;
    } catch (error) {
      translateWriteError(error);
    }
  }

  async appendAudit(input: ProjectAuditInput): Promise<void> {
    await this.scopedDb.transaction.auditEvent.create({
      data: {
        organizationId: this.scopedDb.organizationId,
        actorType: "USER",
        actorId: input.actorId,
        action: input.action,
        entityType: "Project",
        entityId: input.projectId,
        beforeMarker: input.beforeMarker ?? Prisma.JsonNull,
        afterMarker: input.afterMarker,
        source: "project-registry",
        correlationId: input.correlationId,
      },
    });
  }
}
