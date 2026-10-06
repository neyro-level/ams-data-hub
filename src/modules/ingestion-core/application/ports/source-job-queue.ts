import type { SourceImportJob } from "../../domain/source-jobs.ts";
import type { SourceJobRecord } from "./source-job-repository.ts";

export interface SourceJobQueue {
  reconcileSchedules(sources: readonly SourceJobRecord[]): Promise<void>;
}

export interface SourceImportJobHandler {
  run(job: SourceImportJob): Promise<SourceJobRunResult>;
  onFailure?(job: SourceImportJob, terminal: boolean): Promise<void>;
}

export type SourceJobRunResult =
  | { status: "COMPLETED" }
  | { status: "DEFERRED"; reason: "SOURCE_EXECUTION_BUSY" }
  | { status: "SKIPPED"; reason: "NOT_DUE" | "SOURCE_DISABLED" | "SOURCE_NOT_FOUND" | "MANUAL_REQUEST_NOT_FOUND" | "MANUAL_REQUEST_SETTLED" }
  | { status: "BLOCKED"; reason: "PROJECT_SUSPENDED" };
