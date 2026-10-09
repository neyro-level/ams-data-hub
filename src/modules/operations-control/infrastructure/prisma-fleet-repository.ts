import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { Prisma } from "../../../generated/prisma/client.ts";
import { projectOperationalResult } from "../domain/operational-request-presentation.ts";
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
        ackCredential: { select: { version: true } },
        operationalActionRequests: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25,
          select: { id: true, action: true, status: true, createdAt: true, startedAt: true, finishedAt: true, safeErrorCode: true },
        },
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
            revisions: {
              orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 1,
              select: { status: true, recordCount: true, invalidRecordCount: true, failureCode: true,
                startedAt: true, completedAt: true },
            },
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
      } satisfies Prisma.ProjectSelect,
    });
    const projects: FleetProjectRecord[] = [];
    for (const row of rows) {
      const ids = row.operationalActionRequests.map((request) => request.id);
      const results = ids.length ? await this.transaction.$queryRaw<{ id: string; result: unknown }[]>(Prisma.sql`
        SELECT id, CASE WHEN octet_length(result::text) <= 4096 THEN result ELSE NULL END AS result
        FROM "OperationalActionRequest" WHERE "organizationId"=${row.organizationId} AND "projectId"=${row.id}
        AND id IN (${Prisma.join(ids)}) AND status='SUCCEEDED'`) : [];
      const resultMap = new Map(results.map((result) => [result.id, result.result]));
      projects.push({
      organizationId: row.organizationId,
      organizationName: row.organization.name,
      projectId: row.id,
      projectName: row.name,
      projectSlug: row.slug,
      projectStatus: row.status,
      serviceState: row.serviceState,
      ackCredentialVersion: row.ackCredential?.version ?? null,
      operationalRequests: row.operationalActionRequests.map(({ id, createdAt, ...request }) => ({ requestId: id, requestedAt: createdAt, ...request,
        resultSummary: projectOperationalResult(request.action, request.status, resultMap.get(id)),
      })),
      sources: row.sources.map(({ revisions, ...source }) => ({ ...source, latestImport: revisions[0] ?? null })),
      currentSnapshot: row.currentSnapshotManifest,
      latestDelivery: row.deliveryRuns[0] ?? null,
      });
    }
    return projects;
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

  async listRecentAlerts(limit: number) {
    const rows = await this.transaction.notification.findMany({
      where: { route: "/admin/fleet/" },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit,
      select: { id: true, severity: true, title: true, message: true, occurredAt: true,
        organization: { select: { name: true } }, project: { select: { name: true } } },
    });
    return rows.map((row) => ({ alertId: row.id, organizationName: row.organization?.name ?? null,
      projectName: row.project?.name ?? null, severity: row.severity, title: row.title,
      message: row.message, occurredAt: row.occurredAt }));
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
