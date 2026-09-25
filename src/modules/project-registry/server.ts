import "server-only";

import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import type { PrincipalContext } from "../../platform/authorization/principal.ts";
import { requirePlatformAdmin } from "../../platform/authorization/principal-factories.ts";
import {
  runInPrincipalDatabaseTransaction,
  type DatabaseTransaction,
} from "../../platform/database/transaction.ts";
import {
  createProjectInputSchema,
  updateProjectInputSchema,
  type CreateProjectInput,
  type ProjectFormOptions,
  type ProjectListItem,
  type ProjectListQuery,
  type ProjectListResult,
  type UpdateProjectInput,
} from "./contracts.ts";

type PrismaStore = PrismaClient | DatabaseTransaction;

const projectSelect = {
  id: true,
  organizationId: true,
  slug: true,
  name: true,
  description: true,
  status: true,
  version: true,
  updatedAt: true,
  organization: { select: { name: true } },
} satisfies Prisma.ProjectSelect;

function toProjectListItem(record: Prisma.ProjectGetPayload<{ select: typeof projectSelect }>): ProjectListItem {
  return {
    id: record.id,
    organizationId: record.organizationId,
    organizationName: record.organization.name,
    slug: record.slug,
    name: record.name,
    description: record.description,
    status: record.status,
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function projectWhere(search: string): Prisma.ProjectWhereInput {
  if (!search) return {};
  return {
    OR: [
      { name: { contains: search, mode: "insensitive" } },
      { slug: { contains: search, mode: "insensitive" } },
      { organization: { name: { contains: search, mode: "insensitive" } } },
    ],
  };
}

function translateProjectWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new Error("PROJECT_SLUG_CONFLICT");
    if (error.code === "P2003") throw new Error("PROJECT_REFERENCE_INVALID");
  }
  throw error;
}

class ProjectRegistryRepository {
  constructor(private readonly prisma: PrismaStore) {}

  async listProjects(query: ProjectListQuery): Promise<ProjectListResult> {
    const where = projectWhere(query.search);
    const orderBy: Prisma.ProjectOrderByWithRelationInput =
      query.sort === "createdAt" || query.sort === "updatedAt"
        ? { [query.sort]: query.direction }
        : query.sort === "status"
          ? { status: query.direction }
          : { name: query.direction };
    const [total, records] = await Promise.all([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: projectSelect,
      }),
    ]);
    return {
      items: records.map(toProjectListItem),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listFormOptions(): Promise<ProjectFormOptions> {
    const organizations = await this.prisma.organization.findMany({
      orderBy: { name: "asc" },
      take: 100,
      select: { id: true, name: true },
    });
    return { organizations };
  }

  async createProject(input: CreateProjectInput) {
    try {
      return await this.prisma.project.create({
        data: {
          organizationId: input.organizationId,
          slug: input.slug,
          name: input.name,
          description: input.description || null,
          status: input.status,
        },
        select: { id: true, version: true },
      });
    } catch (error) {
      translateProjectWriteError(error);
    }
  }

  findProjectForAction(projectId: string) {
    return this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        organizationId: true,
        slug: true,
        name: true,
        description: true,
        status: true,
        version: true,
      },
    });
  }

  async updateProject(input: UpdateProjectInput): Promise<boolean> {
    try {
      const result = await this.prisma.project.updateMany({
        where: {
          id: input.projectId,
          organizationId: input.organizationId,
          version: input.version,
        },
        data: {
          slug: input.slug,
          name: input.name,
          description: input.description || null,
          status: input.status,
          version: { increment: 1 },
        },
      });
      return result.count === 1;
    } catch (error) {
      translateProjectWriteError(error);
    }
  }

  async appendAudit(input: {
    actorId: string;
    action: string;
    entityId: string;
    organizationId: string;
    beforeMarker: Prisma.InputJsonValue | null;
    afterMarker: Prisma.InputJsonValue | null;
    correlationId: string;
  }) {
    await this.prisma.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: "USER",
        actorId: input.actorId,
        action: input.action,
        entityType: "Project",
        entityId: input.entityId,
        beforeMarker: input.beforeMarker ?? Prisma.JsonNull,
        afterMarker: input.afterMarker ?? Prisma.JsonNull,
        source: "project-registry",
        correlationId: input.correlationId,
      },
    });
  }
}

function requireProjectAdmin(principal: PrincipalContext) {
  return requirePlatformAdmin(principal);
}

export async function listProjects(principal: PrincipalContext, query: ProjectListQuery) {
  requireProjectAdmin(principal);
  return runInPrincipalDatabaseTransaction(principal, (transaction) =>
    new ProjectRegistryRepository(transaction).listProjects(query),
  );
}

export async function getProjectRegistryFormOptions(principal: PrincipalContext) {
  requireProjectAdmin(principal);
  return runInPrincipalDatabaseTransaction(principal, (transaction) =>
    new ProjectRegistryRepository(transaction).listFormOptions(),
  );
}

export async function createProject(principal: PrincipalContext, rawInput: CreateProjectInput) {
  const actor = requireProjectAdmin(principal);
  const input = createProjectInputSchema.parse(rawInput);
  return runInPrincipalDatabaseTransaction(principal, async (transaction) => {
    const repository = new ProjectRegistryRepository(transaction);
    const project = await repository.createProject(input);
    await repository.appendAudit({
      actorId: actor.userId,
      action: "project.create",
      entityId: project.id,
      organizationId: input.organizationId,
      beforeMarker: null,
      afterMarker: { name: input.name, slug: input.slug, status: input.status, version: project.version },
      correlationId: actor.correlationId,
    });
    return { projectId: project.id, version: project.version };
  });
}

export async function updateProject(principal: PrincipalContext, rawInput: UpdateProjectInput) {
  const actor = requireProjectAdmin(principal);
  const input = updateProjectInputSchema.parse(rawInput);
  return runInPrincipalDatabaseTransaction(principal, async (transaction) => {
    const repository = new ProjectRegistryRepository(transaction);
    const project = await repository.findProjectForAction(input.projectId);
    if (!project || project.version !== input.version || project.organizationId !== input.organizationId) {
      throw new Error("PROJECT_NOT_FOUND_OR_STALE");
    }
    const updated = await repository.updateProject(input);
    if (!updated) throw new Error("PROJECT_NOT_FOUND_OR_STALE");
    const version = input.version + 1;
    await repository.appendAudit({
      actorId: actor.userId,
      action: "project.update",
      entityId: input.projectId,
      organizationId: input.organizationId,
      beforeMarker: {
        name: project.name,
        slug: project.slug,
        description: project.description,
        status: project.status,
        version: project.version,
      },
      afterMarker: {
        name: input.name,
        slug: input.slug,
        description: input.description || null,
        status: input.status,
        version,
      },
      correlationId: actor.correlationId,
    });
    return { projectId: input.projectId, version };
  });
}

export async function listProjectTreesForUser(principal: PrincipalContext) {
  return runInPrincipalDatabaseTransaction(principal, (transaction) => {
    if (principal.kind === "platform-admin" || principal.kind === "platform-staff") {
      return transaction.project.findMany({
        orderBy: [{ organization: { name: "asc" } }, { name: "asc" }],
        take: 100,
        select: { id: true, slug: true, name: true, organization: { select: { slug: true, name: true } } },
      });
    }
    if (principal.kind !== "tenant-user") return Promise.resolve([]);
    return transaction.project.findMany({
      where: { organizationId: principal.organizationId },
      orderBy: { name: "asc" },
      take: 100,
      select: { id: true, slug: true, name: true, organization: { select: { slug: true, name: true } } },
    });
  });
}
