import { sourceSchedulePolicySchema } from "../../ingestion-core/index.ts";
import type {
  FleetDashboard,
  FleetFailedJobRecord,
  FleetProjectRecord,
  FleetProjectView,
  FleetSourceRecord,
  FleetSourceView,
} from "../contracts.ts";

const STALE_GRACE_MULTIPLIER = 2;

function sourceIssue(source: FleetSourceRecord, now: Date): FleetSourceView {
  const schedule = sourceSchedulePolicySchema.parse(source.schedulePolicy);
  const lastAttemptAt = source.lastAttemptAt?.toISOString() ?? null;
  const lastSuccessAt = source.lastSuccessAt?.toISOString() ?? null;

  const latestImport = source.latestImport ? {
    ...source.latestImport,
    startedAt: source.latestImport.startedAt.toISOString(),
    completedAt: source.latestImport.completedAt?.toISOString() ?? null,
  } : null;
  if (!source.enabled) {
    return { sourceId: source.id, name: source.name, enabled: false, health: "DISABLED", lastAttemptAt, lastSuccessAt, hasLastGoodRevision: source.lastGoodRevisionId !== null, issueCode: null, latestImport };
  }
  if (!source.lastAttemptAt) {
    return { sourceId: source.id, name: source.name, enabled: true, health: "NEVER_RUN", lastAttemptAt, lastSuccessAt, hasLastGoodRevision: false, issueCode: "NO_SUCCESS_YET", latestImport };
  }
  if (!source.lastSuccessAt || source.lastAttemptAt > source.lastSuccessAt) {
    return { sourceId: source.id, name: source.name, enabled: true, health: "ATTENTION", lastAttemptAt, lastSuccessAt, hasLastGoodRevision: source.lastGoodRevisionId !== null, issueCode: source.lastSuccessAt ? "LATEST_ATTEMPT_NOT_GOOD" : "NO_SUCCESS_YET", latestImport };
  }
  if (
    schedule.mode === "SCHEDULED"
    && now.getTime() - source.lastSuccessAt.getTime() > schedule.cadenceMinutes * 60_000 * STALE_GRACE_MULTIPLIER
  ) {
    return { sourceId: source.id, name: source.name, enabled: true, health: "STALE", lastAttemptAt, lastSuccessAt, hasLastGoodRevision: source.lastGoodRevisionId !== null, issueCode: "STALE_SUCCESS", latestImport };
  }
  return { sourceId: source.id, name: source.name, enabled: true, health: "GOOD", lastAttemptAt, lastSuccessAt, hasLastGoodRevision: source.lastGoodRevisionId !== null, issueCode: null, latestImport };
}

function toProject(project: FleetProjectRecord, now: Date): FleetProjectView {
  const sources = project.sources.map((source) => sourceIssue(source, now));
  const latestDelivery = project.latestDelivery
    ? {
        ...project.latestDelivery,
        publishedAt: project.latestDelivery.publishedAt.toISOString(),
        acknowledgedAt: project.latestDelivery.acknowledgedAt?.toISOString() ?? null,
      }
    : null;
  const operationalIssues = sources.filter((source) => source.issueCode !== null).length;
  const deliveryIssues = latestDelivery && ["FAILED", "STALE"].includes(latestDelivery.status) ? 1 : 0;
  return {
    organizationId: project.organizationId,
    organizationName: project.organizationName,
    projectId: project.projectId,
    projectName: project.projectName,
    projectSlug: project.projectSlug,
    projectStatus: project.projectStatus,
    serviceState: project.serviceState,
    ackCredentialVersion: project.ackCredentialVersion ?? null,
    operationalRequests: (project.operationalRequests ?? []).map((request) => ({
      requestId: request.requestId, action: request.action, status: request.status,
      requestedAt: request.requestedAt.toISOString(), startedAt: request.startedAt?.toISOString() ?? null,
      finishedAt: request.finishedAt?.toISOString() ?? null, safeErrorCode: request.safeErrorCode,
      resultSummary: request.resultSummary ?? null,
    })),
    sources,
    currentSnapshot: project.currentSnapshot
      ? { publishSequence: project.currentSnapshot.publishSequence, publishedAt: project.currentSnapshot.publishedAt.toISOString() }
      : null,
    latestDelivery,
    issueCount: operationalIssues + deliveryIssues,
  };
}

export function buildFleetDashboard(input: {
  projects: FleetProjectRecord[];
  failedJobs: FleetFailedJobRecord[];
  alerts: import("../contracts.ts").FleetAlertRecord[];
  auditEvents: import("../contracts.ts").FleetAuditEventRecord[];
  dataSafety: import("../contracts.ts").FleetDataSafetyRecord;
  organizationCount: number;
  failedJobCount: number;
  now: Date;
}): FleetDashboard {
  const projects = input.projects.map((project) => toProject(project, input.now));
  return {
    generatedAt: input.now.toISOString(),
    dataSafety: {
      jobsFrozen: input.dataSafety.jobsFrozen,
      frozenAt: input.dataSafety.frozenAt?.toISOString() ?? null,
      reconciledAt: input.dataSafety.reconciledAt?.toISOString() ?? null,
    },
    summary: {
      organizations: input.organizationCount,
      projects: projects.length,
      sources: projects.reduce((total, project) => total + project.sources.length, 0),
      projectsWithIssues: projects.filter((project) => project.issueCount > 0).length,
      unacknowledgedDeliveries: projects.filter((project) => project.latestDelivery?.status === "APPLIED").length,
      failedJobs: input.failedJobCount,
    },
    projects,
    failedJobs: input.failedJobs.map((job) => ({ ...job, startedAt: job.startedAt.toISOString() })),
    alerts: input.alerts.map((alert) => ({ ...alert, occurredAt: alert.occurredAt.toISOString() })),
    auditEvents: input.auditEvents.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  };
}
