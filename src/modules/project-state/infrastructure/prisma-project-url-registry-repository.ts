import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type {
  ChangeProjectUrlPathInput,
  CreateProjectUrlEntryInput,
  ProjectRedirectDto,
  ProjectUrlEntryDto,
  ProjectUrlEntryKey,
  RelinkProjectUrlEntryInput,
  ReplaceProjectUrlPolicyInput,
  TransitionProjectUrlLifecycleInput,
} from "../contracts.ts";
import type {
  ProjectUrlRegistryAuditInput,
  ProjectUrlRegistryRepository,
  StoredProjectUrlPolicy,
} from "../application/ports/project-url-registry-repository.ts";
import { ProjectStateError } from "../domain/project-state-error.ts";

const entryInclude = { reservation: { select: { publicUrlId: true } } } as const;

function toEntry(row: {
  id: string;
  entityType: ProjectUrlEntryDto["entityType"];
  entityUid: string;
  slug: string;
  canonicalPath: string;
  factualLifecycle: ProjectUrlEntryDto["factualLifecycle"];
  presentationLifecycle: ProjectUrlEntryDto["presentationLifecycle"];
  redirectTargetPath: string | null;
  version: number;
  publishedAt: Date | null;
  retiredAt: Date | null;
  reservation: { publicUrlId: string };
}): ProjectUrlEntryDto {
  return {
    urlEntryId: row.id,
    entityType: row.entityType,
    entityUid: row.entityUid,
    publicUrlId: row.reservation.publicUrlId,
    slug: row.slug,
    canonicalPath: row.canonicalPath,
    factualLifecycle: row.factualLifecycle,
    presentationLifecycle: row.presentationLifecycle,
    redirectTargetPath: row.redirectTargetPath,
    version: row.version,
    publishedAt: row.publishedAt,
    retiredAt: row.retiredAt,
  };
}

function policyTemplates(value: unknown): StoredProjectUrlPolicy["pathTemplates"] {
  return Array.isArray(value) ? value as StoredProjectUrlPolicy["pathTemplates"] : [];
}

function markerJson(marker: Record<string, string | number | boolean>): Prisma.InputJsonObject {
  return { ...marker };
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new ProjectStateError("PROJECT_URL_PATH_CONFLICT");
    if (error.code === "P2003") throw new ProjectStateError("PROJECT_URL_REFERENCE_INVALID");
  }
  throw error;
}

export class PrismaProjectUrlRegistryRepository implements ProjectUrlRegistryRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  private async lockPath(projectId: string, path: string): Promise<void> {
    await this.transaction.$queryRaw(Prisma.sql`
      SELECT 1 AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`${projectId}:${path}`}, 0))) AS lock_call
    `);
  }

  private async lockPaths(projectId: string, paths: string[]): Promise<void> {
    for (const path of [...new Set(paths)].sort()) await this.lockPath(projectId, path);
  }

  async projectExists(organizationId: string, projectId: string): Promise<boolean> {
    return await this.transaction.project.count({ where: { organizationId, id: projectId } }) === 1;
  }

  async findPolicy(organizationId: string, projectId: string): Promise<StoredProjectUrlPolicy | null> {
    const row = await this.transaction.projectUrlPolicy.findUnique({
      where: { organizationId_projectId: { organizationId, projectId } },
    });
    return row ? { ...row, pathTemplates: policyTemplates(row.pathTemplates) } : null;
  }

  async hasEntries(organizationId: string, projectId: string): Promise<boolean> {
    return await this.transaction.projectUrlEntry.count({ where: { organizationId, projectId } }) > 0;
  }

  async replacePolicy(input: ReplaceProjectUrlPolicyInput): Promise<number | null> {
    try {
      if (input.version === 0) {
        const created = await this.transaction.projectUrlPolicy.create({
          data: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            policyKey: input.policyKey,
            pathTemplates: input.pathTemplates,
            reservedNamespaces: input.reservedNamespaces,
          },
          select: { version: true },
        });
        return created.version;
      }
      const updated = await this.transaction.projectUrlPolicy.updateMany({
        where: { organizationId: input.organizationId, projectId: input.projectId, version: input.version },
        data: {
          policyKey: input.policyKey,
          pathTemplates: input.pathTemplates,
          reservedNamespaces: input.reservedNamespaces,
          version: { increment: 1 },
        },
      });
      return updated.count === 1 ? input.version + 1 : null;
    } catch (error) {
      translateWriteError(error);
    }
  }

  async pathIsReserved(organizationId: string, projectId: string, path: string, exceptEntryId?: string): Promise<boolean> {
    const [entry, redirect, tombstone] = await Promise.all([
      this.transaction.projectUrlEntry.count({
        where: { organizationId, projectId, canonicalPath: path, ...(exceptEntryId ? { id: { not: exceptEntryId } } : {}) },
      }),
      this.transaction.projectRedirect.count({ where: { organizationId, projectId, fromPath: path } }),
      this.transaction.projectUrlTombstone.count({ where: { organizationId, projectId, canonicalPath: path } }),
    ]);
    return entry + redirect + tombstone > 0;
  }

  async createEntry(input: CreateProjectUrlEntryInput, publicUrlId: string): Promise<ProjectUrlEntryDto> {
    try {
      const subject = {
        organizationId: input.organizationId,
        projectId: input.projectId,
        subjectType: input.entityType,
        subjectUid: input.entityUid,
      };
      const existingReservation = await this.transaction.publicUrlIdReservation.findUnique({
        where: { organizationId_projectId_subjectType_subjectUid: subject },
      });
      const reservation = existingReservation ?? await this.transaction.publicUrlIdReservation.create({
        data: { ...subject, publicUrlId },
      });
      const row = await this.transaction.projectUrlEntry.create({
        data: { ...input, reservationId: reservation.id },
        include: entryInclude,
      });
      return toEntry(row);
    } catch (error) {
      translateWriteError(error);
    }
  }

  async findEntry(key: ProjectUrlEntryKey): Promise<ProjectUrlEntryDto | null> {
    const row = await this.transaction.projectUrlEntry.findFirst({
      where: { organizationId: key.organizationId, projectId: key.projectId, id: key.urlEntryId },
      include: entryInclude,
    });
    return row ? toEntry(row) : null;
  }

  async publishEntry(key: ProjectUrlEntryKey, version: number): Promise<ProjectUrlEntryDto | null> {
    const updated = await this.transaction.projectUrlEntry.updateMany({
      where: { organizationId: key.organizationId, projectId: key.projectId, id: key.urlEntryId, version },
      data: { publishedAt: new Date(), version: { increment: 1 } },
    });
    return updated.count === 1 ? this.findEntry(key) : null;
  }

  async changePath(input: ChangeProjectUrlPathInput): Promise<ProjectUrlEntryDto | null> {
    const previous = await this.findEntry(input);
    if (!previous || previous.version !== input.version) return null;
    try {
      await this.lockPaths(input.projectId, [previous.canonicalPath, input.canonicalPath]);
      const updated = await this.transaction.projectUrlEntry.updateMany({
        where: { organizationId: input.organizationId, projectId: input.projectId, id: input.urlEntryId, version: input.version },
        data: { slug: input.slug, canonicalPath: input.canonicalPath, version: { increment: 1 } },
      });
      if (updated.count !== 1) return null;
      if (previous.publishedAt) {
        await this.transaction.projectRedirect.create({
          data: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            urlEntryId: input.urlEntryId,
            fromPath: previous.canonicalPath,
            toPath: input.canonicalPath,
            reason: "SLUG_CHANGE",
          },
        });
      }
      return this.findEntry(input);
    } catch (error) {
      translateWriteError(error);
    }
  }

  async relinkEntry(input: RelinkProjectUrlEntryInput): Promise<ProjectUrlEntryDto | null> {
    try {
      const updated = await this.transaction.projectUrlEntry.updateMany({
        where: { organizationId: input.organizationId, projectId: input.projectId, id: input.urlEntryId, version: input.version },
        data: { entityType: input.entityType, entityUid: input.entityUid, version: { increment: 1 } },
      });
      return updated.count === 1 ? this.findEntry(input) : null;
    } catch (error) {
      translateWriteError(error);
    }
  }

  async transitionLifecycle(input: TransitionProjectUrlLifecycleInput): Promise<ProjectUrlEntryDto | null> {
    const previous = await this.findEntry(input);
    if (!previous || previous.version !== input.version) return null;
    try {
      await this.lockPaths(input.projectId, [previous.canonicalPath, ...(input.redirectTargetPath ? [input.redirectTargetPath] : [])]);
      if (input.presentationLifecycle === "REDIRECTED" && input.redirectTargetPath) {
        const targetCount = await this.transaction.projectUrlEntry.count({
          where: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            id: { not: input.urlEntryId },
            canonicalPath: input.redirectTargetPath,
            presentationLifecycle: { not: "GONE" },
          },
        });
        if (targetCount !== 1) throw new ProjectStateError("PROJECT_URL_REDIRECT_TARGET_INVALID");
      }
      const updated = await this.transaction.projectUrlEntry.updateMany({
        where: { organizationId: input.organizationId, projectId: input.projectId, id: input.urlEntryId, version: input.version },
        data: {
          factualLifecycle: input.factualLifecycle,
          presentationLifecycle: input.presentationLifecycle,
          redirectTargetPath: input.redirectTargetPath,
          retiredAt: input.presentationLifecycle === "GONE" ? new Date() : null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return null;
      if (input.presentationLifecycle === "REDIRECTED" && input.redirectTargetPath) {
        await this.transaction.projectRedirect.create({
          data: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            urlEntryId: input.urlEntryId,
            fromPath: previous.canonicalPath,
            toPath: input.redirectTargetPath,
            reason: input.reason,
          },
        });
      }
      if (input.presentationLifecycle === "GONE") {
        const reservation = await this.transaction.projectUrlEntry.findUniqueOrThrow({
          where: { id: input.urlEntryId },
          select: { reservationId: true },
        });
        await this.transaction.projectUrlTombstone.create({
          data: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            reservationId: reservation.reservationId,
            entityType: previous.entityType,
            entityUid: previous.entityUid,
            canonicalPath: previous.canonicalPath,
            reason: input.reason,
          },
        });
      }
      return this.findEntry(input);
    } catch (error) {
      translateWriteError(error);
    }
  }

  async listEntries(organizationId: string, projectId: string): Promise<ProjectUrlEntryDto[]> {
    const rows = await this.transaction.projectUrlEntry.findMany({
      where: { organizationId, projectId },
      include: entryInclude,
      orderBy: [{ entityType: "asc" }, { entityUid: "asc" }],
    });
    return rows.map(toEntry);
  }

  async listRedirects(organizationId: string, projectId: string): Promise<ProjectRedirectDto[]> {
    const rows = await this.transaction.projectRedirect.findMany({
      where: { organizationId, projectId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({ ...row, code: 301 as const }));
  }

  async appendAudit(input: ProjectUrlRegistryAuditInput): Promise<void> {
    await this.transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: "USER",
        actorId: input.actorId,
        action: input.action,
        entityType: input.action === "url-policy.replace" ? "ProjectUrlPolicy" : "ProjectUrlEntry",
        entityId: input.entityId,
        beforeMarker: input.beforeMarker ? markerJson(input.beforeMarker) : Prisma.JsonNull,
        afterMarker: markerJson(input.afterMarker),
        source: "project-state",
        correlationId: input.correlationId,
      },
    });
  }
}
