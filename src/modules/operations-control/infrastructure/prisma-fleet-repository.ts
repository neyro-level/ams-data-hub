import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { FleetRepository } from "../application/ports/fleet-repository.ts";
import type { FleetFailedJobRecord, FleetProjectRecord } from "../contracts.ts";

export class PrismaFleetRepository implements FleetRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async getPlatformCounts() {
    const [organizations, failedJobs] = await Promise.all([
      this.transaction.organization.count(),
      this.transaction.jobRun.count({ where: { status: "FAILED" } }),
    ]);
    return { organizations, failedJobs };
  }

  async listProjects(): Promise<FleetProjectRecord[]> {
    const rows = await this.transaction.project.findMany({
      orderBy: [{ organization: { name: "asc" } }, { name: "asc" }],
      select: {
        id: true,
        organizationId: true,
        name: true,
        slug: true,
        status: true,
        serviceState: true,
        organization: { select: { name: true } },
        sources: {
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            enabled: true,
            schedulePolicy: true,
            lastAttemptAt: true,
            lastSuccessAt: true,
            lastGoodRevisionId: true,
          },
        },
        currentSnapshotManifest: {
          select: { publishSequence: true, publishedAt: true },
        },
        deliveryRuns: {
          orderBy: { publishSequence: "desc" },
          take: 1,
          select: {
            publishSequence: true,
            status: true,
            publishedAt: true,
            acknowledgedAt: true,
            safeErrorCode: true,
          },
        },
      },
    });
    return rows.map((row) => ({
      organizationId: row.organizationId,
      organizationName: row.organization.name,
      projectId: row.id,
      projectName: row.name,
      projectSlug: row.slug,
      projectStatus: row.status,
      serviceState: row.serviceState,
      sources: row.sources,
      currentSnapshot: row.currentSnapshotManifest,
      latestDelivery: row.deliveryRuns[0] ?? null,
    }));
  }

  async listRecentFailedJobs(limit: number): Promise<FleetFailedJobRecord[]> {
    const rows = await this.transaction.jobRun.findMany({
      where: { status: "FAILED" },
      orderBy: { startedAt: "desc" },
      take: limit,
      select: {
        id: true,
        jobType: true,
        attempt: true,
        safeErrorCode: true,
        startedAt: true,
        organization: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      jobRunId: row.id,
      organizationName: row.organization?.name ?? null,
      jobType: row.jobType,
      attempt: row.attempt,
      safeErrorCode: row.safeErrorCode,
      startedAt: row.startedAt,
    }));
  }

  async listRecentAuditEvents(limit: number) {
    const rows = await this.transaction.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        action: true,
        entityType: true,
        createdAt: true,
        organization: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      auditEventId: row.id,
      organizationName: row.organization?.name ?? null,
      action: row.action,
      entityType: row.entityType,
      createdAt: row.createdAt,
    }));
  }

  async getDataSafetyState() {
    return (await this.transaction.dataSafetyState.findUnique({
      where: { id: "global" },
      select: { jobsFrozen: true, frozenAt: true, reconciledAt: true },
    })) ?? { jobsFrozen: true, frozenAt: null, reconciledAt: null };
  }
}
