import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { defineCommand } from "../../../platform/commands/define-command.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { markAllNotificationsReadInputSchema, notificationIdInputSchema, notificationListQuerySchema, NotificationAccessError, type NotificationListQuery, type NotificationListResult } from "../domain/notification.ts";

export type NotificationAudience = { userId: string; includeAdminOnly: boolean };
export interface NotificationRepository {
  list(audience: NotificationAudience, query: NotificationListQuery): Promise<NotificationListResult>;
  recent(audience: NotificationAudience, limit: number): Promise<NotificationListResult>;
  canRead(audience: NotificationAudience, notificationId: string): Promise<boolean>;
  setRead(userId: string, notificationId: string, read: boolean): Promise<void>;
  markAllRead(audience: NotificationAudience, before: string): Promise<number>;
  filterOptions(audience: NotificationAudience): Promise<{ organizations: Array<{ id: string; name: string }>; projects: Array<{ id: string; name: string }>; sites: Array<{ id: string; name: string }> }>;
}

function audienceFor(principal: PrincipalContext): NotificationAudience {
  if (principal.kind === "platform-admin") return { userId: principal.userId, includeAdminOnly: true };
  if (principal.kind === "platform-analyst") return { userId: principal.userId, includeAdminOnly: false };
  throw new NotificationAccessError("NOTIFICATION_ACCESS_DENIED");
}

export function createNotificationService(dependencies: { createRepository(transaction?: DatabaseTransaction): NotificationRepository }) {
  async function listNotifications(principal: PrincipalContext, raw: NotificationListQuery) {
    return dependencies.createRepository().list(audienceFor(principal), notificationListQuerySchema.parse(raw));
  }
  async function getNotificationSummary(principal: PrincipalContext) {
    return dependencies.createRepository().recent(audienceFor(principal), 8);
  }
  async function getNotificationFilterOptions(principal: PrincipalContext) { return dependencies.createRepository().filterOptions(audienceFor(principal)); }
  const setNotificationRead = defineCommand<PrincipalContext, typeof notificationIdInputSchema, { notificationId: string; read: boolean }>({
    name: "notifications.set-read", input: notificationIdInputSchema,
    authorize: (principal) => { audienceFor(principal); },
    execute: async ({ principal, input, transaction }) => {
      const audience = audienceFor(principal); const repository = dependencies.createRepository(transaction);
      if (!await repository.canRead(audience, input.notificationId)) throw new NotificationAccessError("NOTIFICATION_NOT_FOUND");
      await repository.setRead(audience.userId, input.notificationId, input.read); return input;
    },
  });
  const markAllNotificationsRead = defineCommand<PrincipalContext, typeof markAllNotificationsReadInputSchema, { count: number }>({
    name: "notifications.mark-all-read", input: markAllNotificationsReadInputSchema,
    authorize: (principal) => { audienceFor(principal); },
    execute: async ({ principal, input, transaction }) => {
      const audience = audienceFor(principal); const count = await dependencies.createRepository(transaction).markAllRead(audience, input.before ?? new Date().toISOString()); return { count };
    },
  });
  return { listNotifications, getNotificationSummary, getNotificationFilterOptions, setNotificationRead, markAllNotificationsRead };
}
