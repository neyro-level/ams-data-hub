import type { SourceImportJob } from "../../domain/source-jobs.ts";
import type { SourceJobRecord } from "./source-job-repository.ts";

export interface SourceJobQueue {
  reconcileSchedules(sources: readonly SourceJobRecord[]): Promise<void>;
}

export interface SourceImportJobHandler {
  run(job: SourceImportJob): Promise<SourceJobRunResult>;
}

export type SourceJobRunResult =
  | { status: "COMPLETED" }
  | { status: "SKIPPED"; reason: "NOT_DUE" | "SOURCE_DISABLED" | "SOURCE_NOT_FOUND" }
  | { status: "BLOCKED"; reason: "PROJECT_SUSPENDED" };
