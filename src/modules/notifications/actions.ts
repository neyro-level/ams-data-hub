"use server";

import { defineAction } from "../../platform/actions/define-action.ts";
import { getNotificationSummary, markAllNotificationsRead, setNotificationRead, NotificationAccessError } from "./server.ts";

function mapError(error: unknown) {
  if (error instanceof NotificationAccessError) return { code: error.code, message: error.code === "NOTIFICATION_ACCESS_DENIED" ? "Уведомления недоступны для этой роли." : "Уведомление не найдено." };
  return null;
}

export const getNotificationSummaryAction = defineAction<Record<string, never>, Awaited<ReturnType<typeof getNotificationSummary>>>({ execute: ({ principal }) => getNotificationSummary(principal), mapError });
export const setNotificationReadAction = defineAction<{ notificationId: string; read: boolean }, Awaited<ReturnType<typeof setNotificationRead>>>({ execute: ({ principal, input }) => setNotificationRead(principal, input), mapError, revalidate: [{ path: "/notifications/" }] });
export const markAllNotificationsReadAction = defineAction<Record<string, never>, Awaited<ReturnType<typeof markAllNotificationsRead>>>({ execute: ({ principal }) => markAllNotificationsRead(principal, {}), mapError, revalidate: [{ path: "/notifications/" }] });
