import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { scanOperationalAlerts, signalOperationalAlert, type OwnerAlertDeliveryPort, type OperationalAlertNotification } from "../../src/modules/notifications/server.ts";
import { OUTBOX_WORKER_RUNTIME } from "../../src/modules/platform-operations/index.ts";
import { runInSystemJobDatabaseTransaction } from "../../src/platform/database/transaction.ts";

class CapturingOwnerDelivery implements OwnerAlertDeliveryPort {
  readonly alerts: OperationalAlertNotification[] = [];
  async notifyOwner(alert: OperationalAlertNotification) { this.alerts.push(alert); }
}

describe("operational alerts persistence", () => {
  it("persists six redacted alert conditions without real recipient configuration", async () => {
    const suffix = randomUUID();
    const now = new Date("2026-10-05T12:00:00.000Z");
    const stale = new Date("2026-10-04T10:00:00.000Z");
    const setup = await runInSystemJobDatabaseTransaction({ jobName: "alert-fixture", correlationId: suffix }, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Alert Org ${suffix}`, slug: `alert-org-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Alert Project ${suffix}`, slug: `alert-project-${suffix}` } });
      const source = await transaction.source.create({ data: {
        organizationId: organization.id,
        projectId: project.id,
        sourceKey: `alert-${suffix}`,
        name: "Synthetic stale source",
        adapterKey: "yrl-xml",
        adapterVersion: "1",
        profileKey: "realty",
        profileVersion: "1",
        datasetType: "MIXED_REALTY",
        schedulePolicy: { mode: "SCHEDULED", cadenceMinutes: 60 },
        enabled: true,
        lastSuccessAt: stale,
      } });
      const delivery = await transaction.deliveryRun.create({ data: { organizationId: organization.id, projectId: project.id, publishSequence: 91, manifestKey: `snapshots/${project.id}/91/manifest.json`, manifestSha256: "b".repeat(64), status: "APPLIED", publishedAt: stale, appliedAt: stale } });
      const heartbeat = await transaction.runtimeHeartbeat.create({ data: { runtime: OUTBOX_WORKER_RUNTIME, workerId: `alert-worker-${suffix}`, startedAt: stale, heartbeatAt: stale } });
      return { organizationId: organization.id, projectId: project.id, sourceId: source.id, deliveryId: delivery.id, heartbeatId: heartbeat.id };
    });
    const ownerDelivery = new CapturingOwnerDelivery();

    const scheduled = await scanOperationalAlerts(now, ownerDelivery);
    await signalOperationalAlert({ kind: "IMPORT_SUSPICIOUS", organizationId: setup.organizationId, projectId: setup.projectId, sourceType: "SourceRevision", sourceId: `${setup.sourceId}:suspicious`, occurredAt: now }, ownerDelivery);
    await signalOperationalAlert({ kind: "IMPORT_CRITICAL", organizationId: setup.organizationId, projectId: setup.projectId, sourceType: "SourceRevision", sourceId: `${setup.sourceId}:critical`, occurredAt: now, safeErrorCode: "CRITICAL_ISSUE" }, ownerDelivery);
    await signalOperationalAlert({ kind: "BACKUP_FAILED", organizationId: null, projectId: null, sourceType: "BackupRun", sourceId: `backup-${suffix}`, occurredAt: now, safeErrorCode: "BACKUP_VERIFY_FAILED" }, ownerDelivery);
    const duplicate = await scanOperationalAlerts(now, ownerDelivery);

    expect(scheduled).toMatchObject({ evaluated: 3, created: 3 });
    expect(duplicate).toMatchObject({ evaluated: 3, created: 0 });
    expect(ownerDelivery.alerts).toHaveLength(6);
    const rows = await runInSystemJobDatabaseTransaction({ jobName: "alert-proof", correlationId: randomUUID() }, (transaction) => transaction.notification.findMany({
      where: { dedupKey: { startsWith: "operations-alert:" }, OR: [{ organizationId: setup.organizationId }, { sourceId: setup.heartbeatId }, { sourceId: `backup-${suffix}` }] },
      select: { visibility: true, title: true, message: true, dedupKey: true },
    }));
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.visibility === "PLATFORM_ADMIN_ONLY")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("recipient@example");
  });
});
