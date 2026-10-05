import type { ProjectServiceState } from "../../../project-registry/index.ts";
import type { ProjectJobPrincipal } from "../../../../platform/authorization/principal.ts";
import type { SourceSchedulePolicy } from "../../contracts.ts";

export interface SourceJobRecord {
  organizationId: string;
  projectId: string;
  sourceId: string;
  enabled: boolean;
  schedulePolicy: SourceSchedulePolicy;
  lastAttemptAt: Date | null;
  updatedAt: Date;
}

export interface SourceJobExecutionContext extends SourceJobRecord {
  serviceState: ProjectServiceState;
}

export interface SourceJobRepository {
  listSchedulingSources(): Promise<SourceJobRecord[]>;
  loadExecutionContext(
    principal: ProjectJobPrincipal,
    sourceId: string,
  ): Promise<SourceJobExecutionContext | null>;
}
