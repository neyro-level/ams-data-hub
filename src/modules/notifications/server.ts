import { createNotificationService } from "./application/notification-service.ts";
import { PrismaNotificationRepository } from "./infrastructure/prisma-notification-repository.ts";

const service = createNotificationService({ createRepository: (transaction) => new PrismaNotificationRepository(transaction) });
export const { listNotifications, getNotificationSummary, getNotificationFilterOptions, setNotificationRead, markAllNotificationsRead } = service;
export type { NotificationListItem, NotificationListQuery, NotificationListResult } from "./domain/notification.ts";
export { NotificationAccessError, notificationCategorySchema } from "./domain/notification.ts";
