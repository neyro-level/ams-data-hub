import type {
  CreateProjectInput,
  ProjectFormOptions,
  ProjectListQuery,
  ProjectListResult,
  ProjectStatus,
  UpdateProjectInput,
} from "../../contracts.ts";

export type ProjectAuditMarker = Record<string, string | number | boolean | null>;

export interface ProjectActionRecord {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  version: number;
}

export interface ProjectTreeItem {
  id: string;
  slug: string;
  name: string;
  organization: { slug: string; name: string };
}

export interface ProjectAuditInput {
  actorId: string;
  action: string;
  entityId: string;
  organizationId: string;
  beforeMarker: ProjectAuditMarker | null;
  afterMarker: ProjectAuditMarker | null;
  correlationId: string;
}

export interface ProjectRegistryRepository {
  listProjects(query: ProjectListQuery): Promise<ProjectListResult>;
  listFormOptions(): Promise<ProjectFormOptions>;
  listProjectTrees(): Promise<ProjectTreeItem[]>;
  createProject(input: CreateProjectInput): Promise<{ id: string; version: number }>;
  findProjectForAction(projectId: string): Promise<ProjectActionRecord | null>;
  updateProject(input: UpdateProjectInput): Promise<boolean>;
  appendAudit(input: ProjectAuditInput): Promise<void>;
}
