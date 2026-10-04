import type {
  CreateSourceInput,
  RequestManualSourceRunInput,
  SetSourceEnabledInput,
  SourceKey,
  SourceSchedulePolicy,
  UpdateSourceInput,
  SourceProjectOption,
} from "../../contracts.ts";

export interface StoredSource {
  sourceId: string;
  organizationId: string;
  projectId: string;
  sourceKey: string;
  name: string;
  endpointCredentialRefName: string;
  adapterKey: string;
  adapterVersion: string;
  profileKey: string;
  profileVersion: string;
  datasetType: CreateSourceInput["datasetType"];
  transportType: "HTTPS_XML";
  sharingPolicy: "PROJECT_ONLY";
  schedulePolicy: SourceSchedulePolicy;
  safetyPolicyId: string | null;
  enabled: boolean;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastGoodRevisionId: string | null;
  expectedNamespace: string | null;
  expectedProducer: string | null;
  pendingManualRuns: number;
  version: number;
  updatedAt: Date;
}

export interface SourceRegistryAuditInput {
  organizationId: string;
  actorId: string;
  correlationId: string;
  action: "source.create" | "source.update" | "source.enabled.set" | "source.manual-run.request";
  sourceId: string;
  beforeMarker: Record<string, string | number | boolean> | null;
  afterMarker: Record<string, string | number | boolean>;
}

export interface SourceRegistryRepository {
  projectExists(organizationId: string, projectId: string): Promise<boolean>;
  findSource(key: SourceKey): Promise<StoredSource | null>;
  listSources(organizationId?: string, projectId?: string): Promise<StoredSource[]>;
  listProjectOptions(): Promise<SourceProjectOption[]>;
  createSource(input: CreateSourceInput): Promise<StoredSource>;
  updateSource(input: UpdateSourceInput): Promise<StoredSource | null>;
  setEnabled(input: SetSourceEnabledInput): Promise<StoredSource | null>;
  requestManualRun(input: RequestManualSourceRunInput, requestedBy: string): Promise<{ requestId: string; duplicate: boolean }>;
  appendAudit(input: SourceRegistryAuditInput): Promise<void>;
}
