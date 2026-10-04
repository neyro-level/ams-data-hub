import type {
  ChangeProjectUrlPathInput,
  CreateProjectUrlEntryInput,
  ProjectRedirectDto,
  ProjectUrlEntryDto,
  ProjectUrlEntryKey,
  RelinkProjectUrlEntryInput,
  ReplaceProjectUrlPolicyInput,
  TransitionProjectUrlLifecycleInput,
} from "../../contracts.ts";

export interface StoredProjectUrlPolicy {
  policyKey: string;
  pathTemplates: ReplaceProjectUrlPolicyInput["pathTemplates"];
  reservedNamespaces: string[];
  version: number;
}

export interface ProjectUrlRegistryAuditInput {
  organizationId: string;
  projectId: string;
  actorId: string;
  correlationId: string;
  action: "url-policy.replace" | "url-entry.create" | "url-entry.publish" | "url-entry.path-change" | "url-entry.relink" | "url-entry.lifecycle";
  entityId: string;
  beforeMarker: Record<string, string | number | boolean> | null;
  afterMarker: Record<string, string | number | boolean>;
}

export interface ProjectUrlRegistryRepository {
  projectExists(organizationId: string, projectId: string): Promise<boolean>;
  findPolicy(organizationId: string, projectId: string): Promise<StoredProjectUrlPolicy | null>;
  hasEntries(organizationId: string, projectId: string): Promise<boolean>;
  replacePolicy(input: ReplaceProjectUrlPolicyInput): Promise<number | null>;
  pathIsReserved(organizationId: string, projectId: string, path: string, exceptEntryId?: string): Promise<boolean>;
  createEntry(input: CreateProjectUrlEntryInput, publicUrlId: string): Promise<ProjectUrlEntryDto>;
  findEntry(key: ProjectUrlEntryKey): Promise<ProjectUrlEntryDto | null>;
  publishEntry(key: ProjectUrlEntryKey, version: number): Promise<ProjectUrlEntryDto | null>;
  changePath(input: ChangeProjectUrlPathInput): Promise<ProjectUrlEntryDto | null>;
  relinkEntry(input: RelinkProjectUrlEntryInput): Promise<ProjectUrlEntryDto | null>;
  transitionLifecycle(input: TransitionProjectUrlLifecycleInput): Promise<ProjectUrlEntryDto | null>;
  listEntries(organizationId: string, projectId: string): Promise<ProjectUrlEntryDto[]>;
  listRedirects(organizationId: string, projectId: string): Promise<ProjectRedirectDto[]>;
  appendAudit(input: ProjectUrlRegistryAuditInput): Promise<void>;
}
