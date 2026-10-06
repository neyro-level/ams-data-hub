import { z } from "zod";
import type { SourceSchedulePolicy } from "../contracts.ts";

export const SOURCE_IMPORT_QUEUE = "ingestion.source.run";
export const SOURCE_IMPORT_JOB_SCHEMA_VERSION = 1;
export const SOURCE_SCHEDULE_CRON = "*/5 * * * *";
export const SOURCE_MANUAL_REQUEST_TOPIC = "ingestion.source.manual.request";

export const sourceImportJobSchema = z.object({
  schemaVersion: z.literal(SOURCE_IMPORT_JOB_SCHEMA_VERSION),
  organizationId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  projectId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  sourceId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  trigger: z.enum(["SCHEDULED", "MANUAL"]),
  manualRequestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u).optional(),
}).strict().refine((job) => !job.manualRequestId || job.trigger === "MANUAL");

export const sourceManualRequestIntentSchema = z.object({
  schemaVersion: z.literal(1),
  organizationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  projectId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  sourceId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  manualRequestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
}).strict();

export type SourceImportJob = z.infer<typeof sourceImportJobSchema>;

export interface SourceSchedulingState {
  enabled: boolean;
  schedulePolicy: SourceSchedulePolicy;
  lastAttemptAt: Date | null;
  updatedAt: Date;
}

export function sourceJobKey(sourceId: string): string {
  return z.string().trim().min(1).parse(sourceId);
}

export function isSourceDueForAutomaticRun(
  source: SourceSchedulingState,
  now: Date,
): boolean {
  if (!source.enabled || source.schedulePolicy.mode !== "SCHEDULED") return false;
  const anchor = source.lastAttemptAt ?? source.updatedAt;
  return now.getTime() - anchor.getTime() >= source.schedulePolicy.cadenceMinutes * 60_000;
}
