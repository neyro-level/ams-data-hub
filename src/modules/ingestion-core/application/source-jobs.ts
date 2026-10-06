import type { ProjectJobPrincipal } from "../../../platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { assertProjectOperationAllowed } from "../../project-registry/index.ts";
import type { SourceImportTarget, SourceImportResult } from "./import-pipeline.ts";
import type { SourceJobQueue, SourceJobRunResult } from "./ports/source-job-queue.ts";
import type { SourceJobRepository, SourceManualRequestRepository } from "./ports/source-job-repository.ts";
import {
  isSourceDueForAutomaticRun,
  sourceImportJobSchema,
  type SourceImportJob,
} from "../domain/source-jobs.ts";

export interface SourceJobDependencies {
  repository: SourceJobRepository;
  queue: SourceJobQueue;
  runImport(principal: ProjectJobPrincipal, target: SourceImportTarget, job: SourceImportJob): Promise<SourceImportResult>;
  manualRequests?: SourceManualRequestRepository;
  now?: () => Date;
  createPrincipal?: (job: SourceImportJob) => ProjectJobPrincipal;
}

export function createSourceJobs(dependencies: SourceJobDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const createPrincipal = dependencies.createPrincipal ?? ((job: SourceImportJob) =>
    createProjectJobPrincipal({
      jobName: SOURCE_JOB_NAME,
      organizationId: job.organizationId,
      projectId: job.projectId,
    }) as ProjectJobPrincipal);

  return {
    async onFailure(job: SourceImportJob, terminal: boolean) {
      if (terminal && job.manualRequestId) {
        if (!dependencies.manualRequests) throw new Error("SOURCE_MANUAL_WORKER_UNBOUND");
        await dependencies.manualRequests.fail(createPrincipal(job), job.sourceId, job.manualRequestId);
      }
    },
    async reconcileSchedules(): Promise<void> {
      await dependencies.queue.reconcileSchedules(
        await dependencies.repository.listSchedulingSources(),
      );
    },

    async run(rawJob: SourceImportJob): Promise<SourceJobRunResult> {
      const job = sourceImportJobSchema.parse(rawJob);
      const principal = createPrincipal(job);
      if (job.manualRequestId) {
        if (!dependencies.manualRequests) throw new Error("SOURCE_MANUAL_WORKER_UNBOUND");
        const request = await dependencies.manualRequests.load(principal, job.sourceId, job.manualRequestId);
        if (!request) return { status: "SKIPPED", reason: "MANUAL_REQUEST_NOT_FOUND" };
        if (request.status === "COMPLETED" || request.status === "FAILED") return { status: "SKIPPED", reason: "MANUAL_REQUEST_SETTLED" };
      }
      const source = await dependencies.repository.loadExecutionContext(principal, job.sourceId);
      if (!source) return { status: "SKIPPED", reason: "SOURCE_NOT_FOUND" };
      if (
        source.organizationId !== job.organizationId ||
        source.projectId !== job.projectId
      ) {
        return { status: "SKIPPED", reason: "SOURCE_NOT_FOUND" };
      }
      if (!source.enabled) {
        if (job.manualRequestId) await dependencies.manualRequests!.fail(principal, job.sourceId, job.manualRequestId);
        return { status: "SKIPPED", reason: "SOURCE_DISABLED" };
      }

      try {
        assertProjectOperationAllowed(source.serviceState, "INGEST");
      } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_SERVICE_SUSPENDED:INGEST") {
          if (job.manualRequestId) await dependencies.manualRequests!.fail(principal, job.sourceId, job.manualRequestId);
          return { status: "BLOCKED", reason: "PROJECT_SUSPENDED" };
        }
        throw error;
      }

      if (job.trigger === "SCHEDULED" && !isSourceDueForAutomaticRun(source, now())) {
        return { status: "SKIPPED", reason: "NOT_DUE" };
      }

      const result = await dependencies.runImport(principal, {
        organizationId: job.organizationId,
        projectId: job.projectId,
        sourceId: job.sourceId,
      }, job);
      if (result?.state !== "GOOD" || result.sourceId !== job.sourceId) throw new Error("SOURCE_IMPORT_FAILED");
      return { status: "COMPLETED" };
    },
  };
}

export const SOURCE_JOB_NAME = "source-import";
