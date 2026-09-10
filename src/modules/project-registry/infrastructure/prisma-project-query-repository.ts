import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts";
import type {
  ProjectFormOptions,
  ProjectListItem,
  ProjectListQuery,
  ProjectQueryRepository,
  ProjectReadScope,
} from "../application/ports/project-query-repository.ts";

const projectSelect = {
  id: true,
  organizationId: true,
  slug: true,
  name: true,
  status: true,
  version: true,
  thresholdProfileId: true,
  clusterProfileId: true,
  updatedAt: true,
  organization: { select: { name: true } },
  thresholdProfile: { select: { slug: true } },
  clusterProfile: { select: { name: true } },
} satisfies Prisma.ProjectSelect;

type SelectedProject = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;

function toListItem(project: SelectedProject): ProjectListItem {
  return {
    id: project.id,
    organizationId: project.organizationId,
    organizationName: project.organization.name,
    slug: project.slug,
    name: project.name,
    status: project.status,
    version: project.version,
    thresholdProfileId: project.thresholdProfileId,
    thresholdProfileSlug: project.thresholdProfile.slug,
    clusterProfileId: project.clusterProfileId,
    clusterProfileName: project.clusterProfile.name,
    updatedAt: project.updatedAt.toISOString(),
  };
}

export class PrismaProjectQueryRepository implements ProjectQueryRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly scope: ProjectReadScope,
  ) {}

  private tenantWhere(): Prisma.ProjectWhereInput {
    return this.scope.kind === "tenant"
      ? { organizationId: this.scope.organizationId }
      : {};
  }

  async list(query: ProjectListQuery) {
    const where: Prisma.ProjectWhereInput = {
      ...this.tenantWhere(),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { slug: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.ProjectOrderByWithRelationInput = {
      [query.sort]: query.direction,
    };
    const [projects, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: projectSelect,
      }),
      this.prisma.project.count({ where }),
    ]);
    return {
      items: projects.map(toListItem),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async findById(projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ...this.tenantWhere() },
      select: projectSelect,
    });
    return project ? toListItem(project) : null;
  }

  countSites(projectId: string): Promise<number> {
    return this.prisma.site.count({
      where: {
        projectId,
        ...(this.scope.kind === "tenant"
          ? { organizationId: this.scope.organizationId }
          : {}),
      },
    });
  }

  async listFormOptions(): Promise<ProjectFormOptions> {
    const [organizations, thresholdProfiles, clusterProfiles] = await this.prisma.$transaction([
      this.prisma.organization.findMany({
        where: this.scope.kind === "tenant" ? { id: this.scope.organizationId } : undefined,
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      this.prisma.thresholdProfile.findMany({
        orderBy: { slug: "asc" },
        select: { id: true, slug: true },
      }),
      this.prisma.queryClusterProfile.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    return {
      organizations,
      thresholdProfiles: thresholdProfiles.map((profile) => ({
        id: profile.id,
        label: profile.slug,
      })),
      clusterProfiles: clusterProfiles.map((profile) => ({
        id: profile.id,
        label: profile.name,
      })),
    };
  }
}
