import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { OUTBOX_WORKER_RUNTIME, RUNTIME_HEARTBEAT_WRITE_INTERVAL_MS } from "../../platform-operations/index.ts";
import type { OperationalAlertRepository } from "../application/operational-alert-service.ts";
import type { OperationalAlertCandidate, OperationalAlertNotification } from "../domain/operational-alert.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export class PrismaOperationalAlertRepository implements OperationalAlertRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async findScheduledCandidates(now: Date): Promise<OperationalAlertCandidate[]> {
    const dayCutoff = new Date(now.getTime() - DAY_MS);
    const workerCutoff = new Date(now.getTime() - 2 * RUNTIME_HEARTBEAT_WRITE_INTERVAL_MS);
    const [sources, deliveries, workers] = await Promise.all([
      this.transaction.source.findMany({
        where: {
          enabled: true,
          schedulePolicy: { path: ["mode"], equals: "SCHEDULED" },
          OR: [{ lastSuccessAt: { lte: dayCutoff } }, { lastSuccessAt: null, createdAt: { lte: dayCutoff } }],
        },
        select: { id: true, organizationId: true, projectId: true, lastSuccessAt: true, createdAt: true },
      }),
      this.transaction.deliveryRun.findMany({
        where: { acknowledgedAt: null, publishedAt: { lte: dayCutoff }, status: { in: ["NOTIFIED", "DOWNLOADED", "APPLIED", "STALE"] } },
        select: { id: true, organizationId: true, projectId: true, publishedAt: true },
      }),
      this.transaction.runtimeHeartbeat.findFirst({
        where: { runtime: OUTBOX_WORKER_RUNTIME },
        orderBy: { heartbeatAt: "desc" },
        select: { id: true, heartbeatAt: true },
      }),
    ]);
    return [
      ...sources.map((source) => ({ kind: "SOURCE_OVERDUE" as const, organizationId: source.organizationId, projectId: source.projectId, sourceType: "Source", sourceId: source.id, occurredAt: source.lastSuccessAt ?? source.createdAt })),
      ...deliveries.map((delivery) => ({ kind: "ACK_STALE" as const, organizationId: delivery.organizationId, projectId: delivery.projectId, sourceType: "DeliveryRun", sourceId: delivery.id, occurredAt: delivery.publishedAt })),
      ...(workers && workers.heartbeatAt <= workerCutoff
        ? [{ kind: "WORKER_FAILED" as const, organizationId: null, projectId: null, sourceType: "RuntimeHeartbeat", sourceId: workers.id, occurredAt: workers.heartbeatAt, safeErrorCode: "WORKER_HEARTBEAT_STALE" }]
        : []),
    ];
  }

  async createNotification(alert: OperationalAlertNotification) {
    const result = await this.transaction.notification.createMany({
      data: [{
        organizationId: alert.organizationId,
        projectId: alert.projectId,
        category: alert.category,
        severity: alert.severity,
        visibility: alert.visibility,
        title: alert.title,
        message: alert.message,
        route: alert.route,
        sourceType: alert.sourceType,
        sourceId: alert.sourceId,
        dedupKey: alert.dedupKey,
        occurredAt: alert.occurredAt,
      }],
      skipDuplicates: true,
    });
    return result.count === 1;
  }
}
