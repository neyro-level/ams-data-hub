import { describe, expect, it } from "vitest";
import { createOperationalAlertService, type OperationalAlertRepository, type OwnerAlertDeliveryPort } from "../src/modules/notifications/application/operational-alert-service.ts";
import type { OperationalAlertCandidate, OperationalAlertNotification } from "../src/modules/notifications/domain/operational-alert.ts";

const occurredAt = new Date("2026-10-04T04:00:00.000Z");
const scheduled: OperationalAlertCandidate[] = [
  { kind: "SOURCE_OVERDUE", organizationId: "org-1", projectId: "project-1", sourceType: "Source", sourceId: "source-1", occurredAt },
  { kind: "ACK_STALE", organizationId: "org-1", projectId: "project-1", sourceType: "DeliveryRun", sourceId: "delivery-1", occurredAt },
  { kind: "WORKER_FAILED", organizationId: null, projectId: null, sourceType: "RuntimeHeartbeat", sourceId: "worker-1", occurredAt, safeErrorCode: "WORKER_HEARTBEAT_STALE" },
];

class MemoryRepository implements OperationalAlertRepository {
  readonly notifications: OperationalAlertNotification[] = [];
  readonly keys = new Set<string>();
  async findScheduledCandidates() { return scheduled; }
  async createNotification(alert: OperationalAlertNotification) {
    if (this.keys.has(alert.dedupKey)) return false;
    this.keys.add(alert.dedupKey);
    this.notifications.push(alert);
    return true;
  }
}

class MemoryOwnerDelivery implements OwnerAlertDeliveryPort {
  readonly delivered: OperationalAlertNotification[] = [];
  async notifyOwner(alert: OperationalAlertNotification) { this.delivered.push(alert); }
}

describe("operational alerts", () => {
  it("covers every DH-08.3 condition and deduplicates repeated scans", async () => {
    const repository = new MemoryRepository();
    const ownerDelivery = new MemoryOwnerDelivery();
    const service = createOperationalAlertService({ repository, ownerDelivery });

    await service.scan(new Date("2026-10-05T04:00:00.000Z"));
    await service.signal({ kind: "IMPORT_SUSPICIOUS", organizationId: "org-1", projectId: "project-1", sourceType: "SourceRevision", sourceId: "revision-1", occurredAt });
    await service.signal({ kind: "IMPORT_CRITICAL", organizationId: "org-1", projectId: "project-1", sourceType: "SourceRevision", sourceId: "revision-2", occurredAt, safeErrorCode: "CRITICAL_ISSUE" });
    await service.signal({ kind: "BACKUP_FAILED", organizationId: null, projectId: null, sourceType: "BackupRun", sourceId: "backup-1", occurredAt, safeErrorCode: "BACKUP_VERIFY_FAILED" });
    const duplicate = await service.scan(new Date("2026-10-05T05:00:00.000Z"));

    expect(repository.notifications.map((item) => item.kind).sort()).toEqual([
      "ACK_STALE", "BACKUP_FAILED", "IMPORT_CRITICAL", "IMPORT_SUSPICIOUS", "SOURCE_OVERDUE", "WORKER_FAILED",
    ]);
    expect(ownerDelivery.delivered).toHaveLength(6);
    expect(duplicate).toMatchObject({ evaluated: 3, created: 0 });
    expect(repository.notifications.every((item) => item.visibility === "PLATFORM_ADMIN_ONLY" && item.route === "/admin/fleet/")).toBe(true);
    expect(JSON.stringify(repository.notifications)).not.toContain("recipient@example");
  });
});
