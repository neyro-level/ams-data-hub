import type { ProjectStatus } from "../../domain/project.ts";

export type ProjectReadScope =
  | { kind: "platform" }
  | { kind: "tenant"; organizationId: string };

export interface ProjectListQuery {
  page: number;
  pageSize: number;
  search: string;
  status: ProjectStatus | null;
  sort: "name" | "status" | "updatedAt";
  direction: "asc" | "desc";
}

export interface ProjectListItem {
  id: string;
  organizationId: string;
  organizationName: string;
  slug: string;
  name: string;
  status: ProjectStatus;
  version: number;
  thresholdProfileId: string;
  thresholdProfileSlug: string;
  clusterProfileId: string;
  clusterProfileName: string;
  updatedAt: string;
}

export interface ProjectListResult {
  items: ProjectListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProjectFormOptions {
  organizations: Array<{ id: string; name: string }>;
  thresholdProfiles: Array<{ id: string; label: string }>;
  clusterProfiles: Array<{ id: string; label: string }>;
}

export interface ProjectQueryRepository {
  list(query: ProjectListQuery): Promise<ProjectListResult>;
  findById(projectId: string): Promise<ProjectListItem | null>;
  countSites(projectId: string): Promise<number>;
  listFormOptions(): Promise<ProjectFormOptions>;
}
