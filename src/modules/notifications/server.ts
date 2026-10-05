import { createNotificationService } from "./application/notification-service.ts";
import { PrismaNotificationRepository } from "./infrastructure/prisma-notification-repository.ts";
import { createOperationalAlertService, type OwnerAlertDeliveryPort } from "./application/operational-alert-service.ts";
import type { OperationalAlertCandidate } from "./domain/operational-alert.ts";
import { PrismaOperationalAlertRepository } from "./infrastructure/prisma-operational-alert-repository.ts";
import { runInSystemJobDatabaseTransaction } from "../../platform/database/transaction.ts";

const service = createNotificationService({ createRepository: (transaction) => new PrismaNotificationRepository(transaction) });
export const { listNotifications, getNotificationSummary, getNotificationFilterOptions, setNotificationRead, markAllNotificationsRead } = service;
export type { NotificationListItem, NotificationListQuery, NotificationListResult } from "./domain/notification.ts";
export { NotificationAccessError, notificationCategorySchema } from "./domain/notification.ts";

export async function scanOperationalAlerts(now = new Date(), ownerDelivery?: OwnerAlertDeliveryPort) {
  const result = await runInSystemJobDatabaseTransaction(
    { jobName: "operations-alert-scan", correlationId: `operations-alert-scan-${now.getTime()}` },
    (transaction) => createOperationalAlertService({ repository: new PrismaOperationalAlertRepository(transaction) }).scan(now),
  );
  if (ownerDelivery) for (const alert of result.alerts) await ownerDelivery.notifyOwner(alert);
  return result;
}

export async function signalOperationalAlert(candidate: OperationalAlertCandidate, ownerDelivery?: OwnerAlertDeliveryPort) {
  const result = await runInSystemJobDatabaseTransaction(
    { jobName: "operations-alert-signal", correlationId: `operations-alert-signal-${candidate.kind}-${candidate.occurredAt.getTime()}` },
    (transaction) => createOperationalAlertService({ repository: new PrismaOperationalAlertRepository(transaction) }).signal(candidate),
  );
  if (ownerDelivery) for (const alert of result.alerts) await ownerDelivery.notifyOwner(alert);
  return result;
}

export type { OperationalAlertCandidate, OperationalAlertKind, OperationalAlertNotification } from "./domain/operational-alert.ts";
export type { OwnerAlertDeliveryPort } from "./application/operational-alert-service.ts";
