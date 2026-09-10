import { z } from "zod";

export const notificationCategorySchema = z.enum(["ONBOARDING", "INTEGRATION", "REPORT", "RANKING", "COMPETITOR", "DATA_FRESHNESS", "QUEUE", "ACCESS"]);
export const notificationListQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
  state: z.enum(["all", "unread", "attention"]).default("all"),
  organizationId: z.string().trim().optional(),
  projectId: z.string().trim().optional(),
  siteId: z.string().trim().optional(),
  category: notificationCategorySchema.optional(),
});
export const notificationIdInputSchema = z.object({ notificationId: z.string().trim().min(1), read: z.boolean() });
export const markAllNotificationsReadInputSchema = z.object({ before: z.string().datetime().optional() });

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;
export type NotificationListItem = {
  id: string;
  category: NotificationCategory;
  severity: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  title: string;
  message: string;
  route: string | null;
  occurredAt: string;
  organizationName: string | null;
  projectName: string | null;
  siteName: string | null;
  read: boolean;
};
export type NotificationListResult = { items: NotificationListItem[]; total: number; page: number; pageSize: number; unreadCount: number };

export class NotificationAccessError extends Error {
  constructor(public readonly code: "NOTIFICATION_ACCESS_DENIED" | "NOTIFICATION_NOT_FOUND") { super(code); this.name = "NotificationAccessError"; }
}
