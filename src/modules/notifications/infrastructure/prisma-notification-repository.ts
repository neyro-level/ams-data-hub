import "server-only";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { getPrismaClient } from "../../../platform/database/prisma/client.ts";
import type { NotificationAudience, NotificationRepository } from "../application/notification-service.ts";
import type { NotificationListItem, NotificationListQuery } from "../domain/notification.ts";

type Store = PrismaClient | DatabaseTransaction;
const select = { id: true, category: true, severity: true, title: true, message: true, route: true, occurredAt: true, organization: { select: { name: true } }, project: { select: { name: true } }, site: { select: { name: true } }, reads: { select: { userId: true } } } satisfies Prisma.NotificationSelect;
type Row = Prisma.NotificationGetPayload<{ select: typeof select }>;

function visibilityWhere(audience: NotificationAudience): Prisma.NotificationWhereInput {
  return audience.includeAdminOnly ? {} : { visibility: "PLATFORM_TEAM" };
}
function queryWhere(audience: NotificationAudience, query: NotificationListQuery): Prisma.NotificationWhereInput {
  return { ...visibilityWhere(audience), ...(query.organizationId ? { organizationId: query.organizationId } : {}), ...(query.projectId ? { projectId: query.projectId } : {}), ...(query.siteId ? { siteId: query.siteId } : {}), ...(query.category ? { category: query.category } : {}), ...(query.state === "unread" ? { reads: { none: { userId: audience.userId } } } : {}), ...(query.state === "attention" ? { severity: { in: ["WARNING", "ERROR"] } } : {}) };
}
function dto(row: Row, userId: string): NotificationListItem { return { id: row.id, category: row.category, severity: row.severity, title: row.title, message: row.message, route: row.route, occurredAt: row.occurredAt.toISOString(), organizationName: row.organization?.name ?? null, projectName: row.project?.name ?? null, siteName: row.site?.name ?? null, read: row.reads.some((item) => item.userId === userId) }; }

export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly store: Store = getPrismaClient()) {}
  async list(audience: NotificationAudience, query: NotificationListQuery) {
    const where = queryWhere(audience, query);
    const [items, total, unreadCount] = await Promise.all([
      this.store.notification.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, select }),
      this.store.notification.count({ where }),
      this.store.notification.count({ where: { ...visibilityWhere(audience), reads: { none: { userId: audience.userId } } } }),
    ]);
    return { items: items.map((item) => dto(item, audience.userId)), total, page: query.page, pageSize: query.pageSize, unreadCount };
  }
  recent(audience: NotificationAudience, limit: number) { return this.list(audience, { page: 1, pageSize: limit, state: "all" }); }
  async canRead(audience: NotificationAudience, notificationId: string) { return Boolean(await this.store.notification.findFirst({ where: { id: notificationId, ...visibilityWhere(audience) }, select: { id: true } })); }
  async setRead(userId: string, notificationId: string, read: boolean) {
    if (read) await this.store.notificationRead.upsert({ where: { notificationId_userId: { notificationId, userId } }, update: { readAt: new Date() }, create: { notificationId, userId, readAt: new Date() } });
    else await this.store.notificationRead.deleteMany({ where: { notificationId, userId } });
  }
  async markAllRead(audience: NotificationAudience, before: string) {
    const ids = await this.store.notification.findMany({ where: { ...visibilityWhere(audience), occurredAt: { lte: new Date(before) }, reads: { none: { userId: audience.userId } } }, select: { id: true } });
    if (!ids.length) return 0;
    await this.store.notificationRead.createMany({ data: ids.map(({ id }) => ({ notificationId: id, userId: audience.userId, readAt: new Date() })), skipDuplicates: true }); return ids.length;
  }
  async filterOptions(audience: NotificationAudience) {
    const rows = await this.store.notification.findMany({ where: visibilityWhere(audience), select: { organization: { select: { id: true, name: true } }, project: { select: { id: true, name: true } }, site: { select: { id: true, name: true } } } });
    const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()].sort((left, right) => ("name" in left && "name" in right ? String(left.name).localeCompare(String(right.name), "ru") : 0));
    return { organizations: unique(rows.flatMap((row) => row.organization ? [row.organization] : [])), projects: unique(rows.flatMap((row) => row.project ? [row.project] : [])), sites: unique(rows.flatMap((row) => row.site ? [row.site] : [])) };
  }
}
