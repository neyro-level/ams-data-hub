import type {
  CreateProjectInput,
  ProjectStatus,
  UpdateProjectSettingsInput,
} from "../../domain/project.ts";

export type ProjectJsonValue =
  | string
  | number
  | boolean
  | null
  | ProjectJsonValue[]
  | { [key: string]: ProjectJsonValue };

export interface ProjectActionRecord {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  status: ProjectStatus;
  thresholdProfileId: string;
  clusterProfileId: string;
  version: number;
}

export interface ProjectAuditInput {
  actorId: string;
  action: string;
  projectId: string;
  beforeMarker: { [key: string]: ProjectJsonValue } | null;
  afterMarker: { [key: string]: ProjectJsonValue };
  correlationId: string;
}

export interface ProjectReferenceRepository {
  findForAction(projectId: string): Promise<ProjectActionRecord | null>;
  create(input: CreateProjectInput): Promise<{ id: string; version: number }>;
  updateStatus(input: {
    projectId: string;
    expectedVersion: number;
    status: ProjectStatus;
  }): Promise<boolean>;
  updateSettings(input: Pick<
    UpdateProjectSettingsInput,
    "projectId" | "version" | "name" | "thresholdProfileId" | "clusterProfileId"
  >): Promise<boolean>;
  appendAudit(input: ProjectAuditInput): Promise<void>;
}
