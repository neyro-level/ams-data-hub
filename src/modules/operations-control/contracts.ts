export type FleetSourceHealth =
  | "DISABLED"
  | "NEVER_RUN"
  | "GOOD"
  | "STALE"
  | "ATTENTION";

export interface FleetSourceView {
  sourceId: string;
  name: string;
  enabled: boolean;
  health: FleetSourceHealth;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  hasLastGoodRevision: boolean;
  issueCode: "LATEST_ATTEMPT_NOT_GOOD" | "NO_SUCCESS_YET" | "STALE_SUCCESS" | null;
  latestImport: {
    status: string;
    recordCount: number;
    invalidRecordCount: number;
    failureCode: string | null;
    startedAt: string;
    completedAt: string | null;
  } | null;
}

export interface FleetProjectView {
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  projectStatus: string;
  serviceState: string;
  ackCredentialVersion?: number | null;
  operationalRequests: FleetOperationalRequestView[];
  sources: FleetSourceView[];
  currentSnapshot: {
    publishSequence: number;
    publishedAt: string;
  } | null;
  latestDelivery: {
    publishSequence: number;
    status: string;
    publishedAt: string;
    acknowledgedAt: string | null;
    safeErrorCode: string | null;
  } | null;
  issueCount: number;
}

export interface FleetFailedJobView {
  jobRunId: string;
  organizationName: string | null;
  jobType: string;
  attempt: number;
  safeErrorCode: string | null;
  startedAt: string;
}

export interface FleetDashboard {
  generatedAt: string;
  dataSafety: {
    jobsFrozen: boolean;
    frozenAt: string | null;
    reconciledAt: string | null;
  };
  summary: {
    organizations: number;
    projects: number;
    sources: number;
    projectsWithIssues: number;
    unacknowledgedDeliveries: number;
    failedJobs: number;
  };
  projects: FleetProjectView[];
  failedJobs: FleetFailedJobView[];
  alerts: FleetAlertView[];
  auditEvents: FleetAuditEventView[];
}

export interface FleetAlertView {
  alertId: string;
  organizationName: string | null;
  projectName: string | null;
  severity: string;
  title: string;
  message: string;
  occurredAt: string;
}

export interface FleetAuditEventView {
  auditEventId: string;
  organizationName: string | null;
  action: string;
  entityType: string;
  createdAt: string;
}

export class OperationsControlError extends Error {
  constructor(public readonly code:
    | "OPERATIONS_CONTROL_ADMIN_ACCESS_DENIED"
    | "OPERATIONS_CONTROL_REFERENCE_INVALID"
    | "OPERATIONS_CONTROL_IDEMPOTENCY_CONFLICT") {
    super(code);
    this.name = "OperationsControlError";
  }
}

export interface FleetSourceRecord {
  id: string;
  name: string;
  enabled: boolean;
  schedulePolicy: unknown;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastGoodRevisionId: string | null;
  latestImport: {
    status: string;
    recordCount: number;
    invalidRecordCount: number;
    failureCode: string | null;
    startedAt: Date;
    completedAt: Date | null;
  } | null;
}

export interface FleetProjectRecord {
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  projectStatus: string;
  serviceState: string;
  ackCredentialVersion?: number | null;
  operationalRequests?: FleetOperationalRequestRecord[];
  sources: FleetSourceRecord[];
  currentSnapshot: { publishSequence: number; publishedAt: Date } | null;
  latestDelivery: {
    publishSequence: number;
    status: string;
    publishedAt: Date;
    acknowledgedAt: Date | null;
    safeErrorCode: string | null;
  } | null;
}

export interface FleetOperationalRequestRecord {
  requestId: string;
  action: string;
  status: "REQUESTED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  safeErrorCode: string | null;
  resultSummary?: FleetOperationalResultView | null;
}
export type FleetOperationalResultView =
  | { action: "SNAPSHOT_BUILD" | "SNAPSHOT_PUBLISH"; buildInputId: string; publishSequence: number }
  | { action: "SNAPSHOT_ROLLBACK"; sourcePublishSequence: number; publishSequence: number }
  | { action: "ACK_ROTATE"; phase: "STAGE" | "PROMOTE"; credentialVersion: number }
  | { action: "SUSPICIOUS_APPROVE" | "SUSPICIOUS_REJECT"; sourceRevisionId: string };
export interface FleetOperationalRequestView extends Omit<FleetOperationalRequestRecord, "requestedAt" | "startedAt" | "finishedAt"> {
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface FleetFailedJobRecord {
  jobRunId: string;
  organizationName: string | null;
  jobType: string;
  attempt: number;
  safeErrorCode: string | null;
  startedAt: Date;
}

export interface FleetAuditEventRecord {
  auditEventId: string;
  organizationName: string | null;
  action: string;
  entityType: string;
  createdAt: Date;
}

export interface FleetAlertRecord {
  alertId: string;
  organizationName: string | null;
  projectName: string | null;
  severity: string;
  title: string;
  message: string;
  occurredAt: Date;
}

export interface FleetDataSafetyRecord {
  jobsFrozen: boolean;
  frozenAt: Date | null;
  reconciledAt: Date | null;
}
import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);

export const operationalActionSchema = z.enum([
  "RUN_SOURCE",
  "SUSPICIOUS_APPROVE",
  "SUSPICIOUS_REJECT",
  "SNAPSHOT_BUILD",
  "SNAPSHOT_PUBLISH",
  "SNAPSHOT_ROLLBACK",
  "ACK_ROTATE",
]);

export const requestOperationalActionInputSchema = z.object({
  action: operationalActionSchema,
  organizationId: identifierSchema,
  projectId: identifierSchema,
  sourceId: z.string().trim().max(128).default(""),
  sourceRevisionId: z.string().trim().max(128).default(""),
  buildInputId: z.string().trim().max(128).optional(),
  sourcePublishSequence: z.coerce.number().int().positive().optional(),
  ackRotationPhase: z.enum(["STAGE", "PROMOTE"]).optional(),
  ackCredentialVersion: z.number().int().positive().max(2_147_483_646).optional(),
  reason: z.string().trim().max(500).default(""),
  idempotencyKey: identifierSchema,
}).superRefine((value, context) => {
  if (value.action === "ACK_ROTATE" && (!value.ackRotationPhase || value.ackCredentialVersion === undefined)) {
    context.addIssue({ code: "custom", path: ["ackRotationPhase"], message: "Укажите фазу и ожидаемую версию ACK credential" });
  }
  if (value.action !== "ACK_ROTATE" && (value.ackRotationPhase !== undefined || value.ackCredentialVersion !== undefined)) {
    context.addIssue({ code: "custom", path: ["ackRotationPhase"], message: "ACK параметры допустимы только для ACK_ROTATE" });
  }
  if (value.action === "SNAPSHOT_PUBLISH" && !/^[A-Za-z0-9_-]{1,128}$/u.test(value.buildInputId ?? "")) {
    context.addIssue({ code: "custom", path: ["buildInputId"], message: "Укажите точный ID завершённой сборки" });
  }
  if (["RUN_SOURCE", "SUSPICIOUS_APPROVE", "SUSPICIOUS_REJECT"].includes(value.action) && !value.sourceId) {
    context.addIssue({ code: "custom", path: ["sourceId"], message: "Выберите источник" });
  }
  if (["SUSPICIOUS_APPROVE", "SUSPICIOUS_REJECT"].includes(value.action) && !value.sourceRevisionId) {
    context.addIssue({ code: "custom", path: ["sourceRevisionId"], message: "Укажите revision" });
  }
  if (["SUSPICIOUS_APPROVE", "SUSPICIOUS_REJECT"].includes(value.action) && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Обоснование обязательно" });
  }
  if (value.action === "SNAPSHOT_ROLLBACK" && value.sourcePublishSequence === undefined) {
    context.addIssue({ code: "custom", path: ["sourcePublishSequence"], message: "Укажите исходный sequence" });
  }
});

export const freezeJobsInputSchema = z.object({ reason: z.string().trim().min(3).max(255) });
export const unfreezeJobsInputSchema = z.object({});

export type OperationalAction = z.infer<typeof operationalActionSchema>;
export const operationalExecutionActionSchema = operationalActionSchema.exclude(["RUN_SOURCE"]);
export const operationalActionIntentSchema = z.object({
  schemaVersion: z.literal(1),
  organizationId: identifierSchema,
  projectId: identifierSchema,
  requestId: identifierSchema,
  action: operationalExecutionActionSchema,
}).strict();
export const OPERATIONAL_ACTION_TOPICS: Readonly<Record<z.infer<typeof operationalExecutionActionSchema>, string>> = Object.freeze({
  SNAPSHOT_BUILD: "operations-control.snapshot.build.request",
  SNAPSHOT_PUBLISH: "operations-control.snapshot.publish.request",
  SNAPSHOT_ROLLBACK: "operations-control.snapshot.rollback.request",
  ACK_ROTATE: "operations-control.ack.rotate.request",
  SUSPICIOUS_APPROVE: "operations-control.suspicious.approve.request",
  SUSPICIOUS_REJECT: "operations-control.suspicious.reject.request",
});
export type RequestOperationalActionInput = z.infer<typeof requestOperationalActionInputSchema>;
export type FreezeJobsInput = z.infer<typeof freezeJobsInputSchema>;
export type UnfreezeJobsInput = z.infer<typeof unfreezeJobsInputSchema>;
