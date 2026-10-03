import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { collectDatabasePages } from "../../../platform/database/collect-pages.ts";
import type {
  CreateProjectInput,
  ProjectFormOptions,
  ProjectListItem,
  ProjectListQuery,
  ProjectListResult,
  UpdateProjectInput,
} from "../contracts.ts";
import type {
  ProjectAuditInput,
  ProjectRegistryRepository,
  ProjectTreeItem,
} from "../application/ports/project-registry-repository.ts";
import { ProjectRegistryError } from "../domain/project-registry-error.ts";

const projectSelect = {
  id: true,
  organizationId: true,
  slug: true,
  name: true,
  description: true,
  status: true,
  serviceState: true,
  siteBaseUrl: true,
  publicUrlPolicyVersion: true,
  notes: true,
  version: true,
  updatedAt: true,
  organization: { select: { name: true } },
} satisfies Prisma.ProjectSelect;

type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;

function toProjectListItem(record: ProjectRow): ProjectListItem {
  return {
    id: record.id,
    organizationId: record.organizationId,
    organizationName: record.organization.name,
    slug: record.slug,
    name: record.name,
    description: record.description,
    status: record.status,
    serviceState: record.serviceState,
    siteBaseUrl: record.siteBaseUrl,
    publicUrlPolicyVersion: record.publicUrlPolicyVersion,
    notes: record.notes,
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
    if (error.code === "P2002") {
      throw new ProjectRegistryError("PROJECT_SLUG_CONFLICT");
    }
    if (error.code === "P2003") {
      throw new ProjectRegistryError("PROJECT_REFERENCE_INVALID");
    }
  }
  throw error;
}

export class PrismaProjectRegistryRepository implements ProjectRegistryRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async listProjects(query: ProjectListQuery): Promise<ProjectListResult> {
    const where = projectWhere(query.search);
    const orderBy: Prisma.ProjectOrderByWithRelationInput =
      query.sort === "createdAt" || query.sort === "updatedAt"
        ? { [query.sort]: query.direction }
        : query.sort === "status"
          ? { status: query.direction }
          : { name: query.direction };
    const [total, records] = await Promise.all([
      this.transaction.project.count({ where }),
      this.transaction.project.findMany({
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
    const organizations = await collectDatabasePages(({ skip, take }) =>
      this.transaction.organization.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip,
        take,
        select: { id: true, name: true },
      }));
    return { organizations };
  }

  listProjectTrees(): Promise<ProjectTreeItem[]> {
    return collectDatabasePages(({ skip, take }) =>
      this.transaction.project.findMany({
        orderBy: [{ organization: { name: "asc" } }, { name: "asc" }, { id: "asc" }],
        skip,
        take,
        select: {
          id: true,
          slug: true,
          name: true,
          organization: { select: { slug: true, name: true } },
        },
      }));
  }

  async createProject(input: CreateProjectInput) {
    try {
      return await this.transaction.project.create({
        data: {
          organizationId: input.organizationId,
          slug: input.slug,
          name: input.name,
          description: input.description || null,
          status: input.status,
          serviceState: input.serviceState,
          siteBaseUrl: input.siteBaseUrl || null,
          publicUrlPolicyVersion: input.publicUrlPolicyVersion || null,
          notes: input.notes || null,
        },
        select: { id: true, version: true },
      });
    } catch (error) {
      translateProjectWriteError(error);
    }
  }

  findProjectForAction(input: { organizationId: string; projectId: string }) {
    return this.transaction.project.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId },
      select: {
        id: true,
        organizationId: true,
        slug: true,
        name: true,
        description: true,
        status: true,
        serviceState: true,
        siteBaseUrl: true,
        publicUrlPolicyVersion: true,
        notes: true,
        version: true,
      },
    });
  }

  async updateProject(input: UpdateProjectInput): Promise<boolean> {
    try {
      const result = await this.transaction.project.updateMany({
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
          serviceState: input.serviceState,
          siteBaseUrl: input.siteBaseUrl || null,
          publicUrlPolicyVersion: input.publicUrlPolicyVersion || null,
          notes: input.notes || null,
          version: { increment: 1 },
        },
      });
      return result.count === 1;
    } catch (error) {
      translateProjectWriteError(error);
    }
  }

  async appendAudit(input: ProjectAuditInput): Promise<void> {
    await this.transaction.auditEvent.create({
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
