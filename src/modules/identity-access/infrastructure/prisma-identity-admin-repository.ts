import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts";
import { randomUUID } from "node:crypto";
import { createLocalAccountIssuer } from "better-auth/db";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { getPrismaClient } from "../../../platform/database/prisma/client.ts";
import {
  IdentityAdminError,
  type CreateMembershipInput,
  type CreateOrganizationInput,
  type IdentityAdminFormOptions,
  type IdentityAdminListQuery,
  type IdentityAdminUserListItem,
  type MembershipListItem,
  type MembershipListResult,
  type OrganizationListItem,
  type OrganizationListResult,
  type UpdateMembershipInput,
  type UpdateOrganizationInput,
} from "../domain/admin-identity.ts";
import type {
  IdentityAdminAuditInput,
  IdentityAdminRepository,
  ProvisionClientPersistenceInput,
} from "../application/ports/identity-admin-repository.ts";

const organizationSelect = {
  id: true,
  slug: true,
  name: true,
  version: true,
  updatedAt: true,
  _count: { select: { members: true, projects: true } },
} satisfies Prisma.OrganizationSelect;

const membershipSelect = {
  id: true,
  organizationId: true,
  version: true,
  tenantRole: true,
  updatedAt: true,
  organization: { select: { name: true } },
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.MemberSelect;

const actionMembershipSelect = {
  id: true,
  organizationId: true,
  userId: true,
  tenantRole: true,
  version: true,
} satisfies Prisma.MemberSelect;

type PrismaStore = PrismaClient | DatabaseTransaction;
type SelectedOrganization = Prisma.OrganizationGetPayload<{
  select: typeof organizationSelect;
}>;
type SelectedMembership = Prisma.MemberGetPayload<{
  select: typeof membershipSelect;
}>;

function organizationWhere(search: string): Prisma.OrganizationWhereInput {
  if (!search) return {};
  return {
    OR: [
      { name: { contains: search, mode: "insensitive" } },
      { slug: { contains: search, mode: "insensitive" } },
    ],
  };
}

function membershipWhere(search: string): Prisma.MemberWhereInput {
  if (!search) return {};
  return {
    OR: [
      { user: { name: { contains: search, mode: "insensitive" } } },
      { user: { email: { contains: search, mode: "insensitive" } } },
      { organization: { name: { contains: search, mode: "insensitive" } } },
    ],
  };
}

function toOrganizationListItem(record: SelectedOrganization): OrganizationListItem {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    version: record.version,
    membershipCount: record._count.members,
    projectCount: record._count.projects,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toMembershipListItem(record: SelectedMembership): MembershipListItem {
  return {
    id: record.id,
    organizationId: record.organizationId,
    organizationName: record.organization.name,
    userId: record.user.id,
    userName: record.user.name,
    userEmail: record.user.email,
    tenantRole: record.tenantRole,
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target.join(",")
        : "";
      if (target.includes("slug")) {
        throw new IdentityAdminError("ORGANIZATION_SLUG_CONFLICT");
      }
      throw new IdentityAdminError("MEMBERSHIP_ALREADY_EXISTS");
    }
    if (error.code === "P2003") {
      throw new IdentityAdminError("MEMBERSHIP_REFERENCE_INVALID");
    }
  }
  throw error;
}

export class PrismaIdentityAdminRepository implements IdentityAdminRepository {
  constructor(private readonly injectedPrisma?: PrismaStore) {}

  private get prisma(): PrismaStore {
    return this.injectedPrisma ?? getPrismaClient();
  }
  async listOrganizations(
    query: IdentityAdminListQuery,
  ): Promise<OrganizationListResult> {
    const where = organizationWhere(query.search);
    const orderBy: Prisma.OrganizationOrderByWithRelationInput =
      query.sort === "createdAt" || query.sort === "updatedAt"
        ? { [query.sort]: query.direction }
        : { name: query.direction };
    const [total, records] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: organizationSelect,
      }),
    ]);
    return {
      items: records.map(toOrganizationListItem),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listMemberships(
    query: IdentityAdminListQuery,
  ): Promise<MembershipListResult> {
    const normalizedSearch = query.search.trim();
    const where = membershipWhere(normalizedSearch);
    const tenantRole =
      normalizedSearch.toUpperCase() === "ORG_OWNER" ||
      normalizedSearch.toUpperCase() === "ORG_MEMBER" ||
      normalizedSearch.toUpperCase() === "VIEWER"
        ? normalizedSearch.toUpperCase()
        : null;
    const scopedWhere: Prisma.MemberWhereInput = tenantRole
      ? { ...where, tenantRole: tenantRole as MembershipListItem["tenantRole"] }
      : where;
    const orderBy: Prisma.MemberOrderByWithRelationInput =
      query.sort === "status"
        ? { tenantRole: query.direction }
        : query.sort === "name"
          ? { user: { name: query.direction } }
          : query.sort === "createdAt"
            ? { createdAt: query.direction }
            : { updatedAt: query.direction };
    const total = await this.prisma.member.count({ where: scopedWhere });
    const records = (await this.prisma.member.findMany({
      where: scopedWhere,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: membershipSelect,
    })) as SelectedMembership[];
    return {
      items: records.map(toMembershipListItem),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listFormOptions(): Promise<IdentityAdminFormOptions> {
    const [organizations, users] = await Promise.all([
      this.prisma.organization.findMany({
        orderBy: { name: "asc" },
        take: 100,
        select: { id: true, name: true },
      }),
      this.prisma.user.findMany({
        where: { disabledAt: null },
        orderBy: { name: "asc" },
        take: 100,
        select: { id: true, name: true, email: true },
      }),
    ]);

    return {
      organizations,
      users: users.map((user) => ({ id: user.id, label: `${user.name} · ${user.email}` })),
    };
  }

  async listUsers(): Promise<IdentityAdminUserListItem[]> {
    const users = await this.prisma.user.findMany({
      where: { username: { not: null } },
      orderBy: { name: "asc" },
      take: 200,
      select: {
        id: true,
        name: true,
        username: true,
        disabledAt: true,
        members: {
          orderBy: { organization: { name: "asc" } },
          select: { id: true, tenantRole: true, organization: { select: { name: true } } },
        },
      },
    });
    return users.flatMap((user) => user.username ? [{
      id: user.id,
      name: user.name,
      username: user.username,
      disabled: user.disabledAt !== null,
      memberships: user.members.map((member) => ({
        id: member.id,
        organizationName: member.organization.name,
        tenantRole: member.tenantRole,
      })),
    }] : []);
  }

  async provisionClient(input: ProvisionClientPersistenceInput) {
    try {
      const organization = await this.prisma.organization.create({
        data: { name: input.organizationName, slug: input.organizationSlug },
        select: { id: true },
      });
      const project = await this.prisma.project.create({
        data: {
          organizationId: organization.id,
          name: input.projectName,
          slug: input.projectSlug,
          status: "ACTIVE",
          thresholdProfileId: input.thresholdProfileId,
          clusterProfileId: input.clusterProfileId,
        },
        select: { id: true },
      });
      const userId = randomUUID();
      const user = await this.prisma.user.create({
        data: {
          id: userId,
          name: input.userName,
          username: input.username,
          email: `${input.username}@users.impulse.invalid`,
          emailVerified: false,
          systemRole: "CLIENT_VIEWER",
        },
        select: { id: true },
      });
      await this.prisma.account.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          issuer: createLocalAccountIssuer("credential"),
          accountId: user.id,
          providerId: "credential",
          password: input.passwordHash,
        },
      });
      const membership = await this.prisma.member.create({
        data: { organizationId: organization.id, userId: user.id, tenantRole: input.tenantRole },
        select: { id: true },
      });
      const siteIds: string[] = [];
      for (const siteInput of input.sites) {
        const site = await this.prisma.site.create({
          data: {
            organizationId: organization.id,
            projectId: project.id,
            name: siteInput.name,
            slug: siteInput.slug,
            url: siteInput.url,
            timezone: siteInput.timezone,
            enabled: true,
          },
          select: { id: true },
        });
        siteIds.push(site.id);

        await this.prisma.providerConnection.createMany({
          data: ["YANDEX_METRIKA", "YANDEX_WEBMASTER", "TOPVISOR"].map((provider) => ({
            organizationId: organization.id,
            siteId: site.id,
            provider: provider as "YANDEX_METRIKA" | "YANDEX_WEBMASTER" | "TOPVISOR",
            enabled: true,
            status: "PENDING" as const,
            settingsJson: provider === "TOPVISOR" ? {
              region: {
                name: siteInput.regionName,
                countryCode: siteInput.regionCountryCode,
                yandexKey: siteInput.yandexRegionKey,
                googleKey: siteInput.googleRegionKey,
              },
            } : Prisma.JsonNull,
          })),
        });
        await this.prisma.searchTarget.createMany({
          data: [
            ["YANDEX", "DESKTOP", siteInput.yandexRegionKey],
            ["YANDEX", "MOBILE", siteInput.yandexRegionKey],
            ["GOOGLE", "DESKTOP", siteInput.googleRegionKey],
            ["GOOGLE", "MOBILE", siteInput.googleRegionKey],
          ].map(([engine, device, regionKey]) => ({
            organizationId: organization.id,
            siteId: site.id,
            engine: engine as "YANDEX" | "GOOGLE",
            device: device as "DESKTOP" | "MOBILE",
            regionKey: String(regionKey),
            regionName: siteInput.regionName,
          })),
        });
        const querySet = await this.prisma.trackedQuerySet.create({
          data: {
            organizationId: organization.id,
            siteId: site.id,
            source: "TOPVISOR",
            baselineLabel: "Основное ядро",
            expectedCount: siteInput.queries.length,
          },
          select: { id: true },
        });
        await this.prisma.trackedQuery.createMany({
          data: siteInput.queries.map((query) => ({
            organizationId: organization.id,
            trackedQuerySetId: querySet.id,
            query,
            normalizedQuery: query.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim(),
          })),
        });

        const outboxEvent = await this.prisma.outboxEvent.create({
          data: {
            organizationId: organization.id,
            topic: "site.integrations.setup.requested",
            payload: { siteId: site.id, projectId: project.id, projectSlug: input.projectSlug },
            correlationId: input.correlationId,
          },
          select: { id: true },
        });
        await this.prisma.idempotencyKey.create({
          data: {
            organizationId: organization.id,
            organizationScope: organization.id,
            scope: "site.integration.setup",
            key: site.id,
            requestHash: site.id,
            status: "COMPLETED",
            response: { outboxEventId: outboxEvent.id },
            outboxEventId: outboxEvent.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        await this.prisma.notification.create({
          data: {
            organizationId: organization.id,
            projectId: project.id,
            siteId: site.id,
            category: "ONBOARDING",
            severity: "INFO",
            visibility: "PLATFORM_TEAM",
            title: `Сайт «${siteInput.name}» создан`,
            message: "Начата автоматическая проверка Метрики, Вебмастера и Topvisor.",
            route: `/admin/sites/?site=${site.id}`,
            sourceType: "Site",
            sourceId: site.id,
            dedupKey: `site-created:${site.id}`,
            occurredAt: new Date(),
          },
        });
      }
      return { organizationId: organization.id, projectId: project.id, userId: user.id, membershipId: membership.id, siteIds };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          const target = String(error.meta?.target ?? "");
          const modelName = String(error.meta?.modelName ?? "");
          if (target.includes("username") || target.includes("email")) throw new IdentityAdminError("USER_LOGIN_CONFLICT");
          if (modelName === "Project") throw new IdentityAdminError("PROJECT_SLUG_CONFLICT");
          if (modelName === "Site") throw new IdentityAdminError("SITE_SLUG_CONFLICT");
          throw new IdentityAdminError("ORGANIZATION_SLUG_CONFLICT");
        }
        if (error.code === "P2003") throw new IdentityAdminError("PROJECT_REFERENCE_INVALID");
      }
      throw error;
    }
  }

  async resetUserPassword(userId: string, passwordHash: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return false;
    const account = await this.prisma.account.updateMany({
      where: { userId, providerId: "credential" },
      data: { password: passwordHash },
    });
    await this.prisma.session.deleteMany({ where: { userId } });
    return account.count === 1;
  }

  async setUserEnabled(userId: string, enabled: boolean): Promise<boolean> {
    const result = await this.prisma.user.updateMany({
      where: { id: userId },
      data: { disabledAt: enabled ? null : new Date() },
    });
    if (!enabled) await this.prisma.session.deleteMany({ where: { userId } });
    return result.count === 1;
  }

  async createOrganization(input: CreateOrganizationInput) {
    try {
      return await this.prisma.organization.create({
        data: {
          slug: input.slug,
          name: input.name,
        },
        select: { id: true, version: true },
      });
    } catch (error) {
      translateWriteError(error);
    }
  }

  findOrganizationForAction(organizationId: string) {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, slug: true, name: true, version: true },
    });
  }

  async updateOrganization(input: UpdateOrganizationInput): Promise<boolean> {
    try {
      const result = await this.prisma.organization.updateMany({
        where: {
          id: input.organizationId,
          version: input.version,
        },
        data: {
          slug: input.slug,
          name: input.name,
          version: { increment: 1 },
        },
      });
      return result.count === 1;
    } catch (error) {
      translateWriteError(error);
    }
  }

  async createMembership(input: CreateMembershipInput) {
    try {
      return await this.prisma.member.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId,
          tenantRole: input.tenantRole,
        },
        select: { id: true, version: true },
      });
    } catch (error) {
      translateWriteError(error);
    }
  }

  findMembershipForAction(input: {
    organizationId: string;
    membershipId: string;
  }) {
    return this.prisma.member.findFirst({
      where: {
        id: input.membershipId,
        organizationId: input.organizationId,
      },
      select: actionMembershipSelect,
    });
  }

  async updateMembership(input: UpdateMembershipInput): Promise<boolean> {
    const result = await this.prisma.member.updateMany({
      where: {
        id: input.membershipId,
        organizationId: input.organizationId,
        version: input.version,
      },
      data: {
        tenantRole: input.tenantRole,
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  async removeMembership(input: {
    organizationId: string;
    membershipId: string;
    version: number;
  }): Promise<boolean> {
    const result = await this.prisma.member.deleteMany({
      where: {
        id: input.membershipId,
        organizationId: input.organizationId,
        version: input.version,
      },
    });
    return result.count === 1;
  }

  async appendAudit(input: IdentityAdminAuditInput): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: "USER",
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeMarker: input.beforeMarker ?? Prisma.JsonNull,
        afterMarker: input.afterMarker ?? Prisma.JsonNull,
        source: "identity-access",
        correlationId: input.correlationId,
      },
    });
  }
}
