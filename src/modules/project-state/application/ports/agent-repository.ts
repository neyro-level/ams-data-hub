import type {
  AgentAdminItem,
  AgentMediaOption,
  ConfirmAgentConsentBatchInput,
  MergeAgentsInput,
  RelinkAgentIdentityInput,
  SaveManualAgentInput,
  SplitAgentIdentityInput,
} from "../../contracts.ts";

export interface AgentAuditInput {
  organizationId: string;
  projectId: string;
  actorId: string;
  correlationId: string;
  action: "agent.save" | "agent.merge" | "agent.relink" | "agent.split" | "agent.visibility-batch" | "agent.consent-batch";
  entityId: string;
  beforeMarker: Record<string, string | number | boolean> | null;
  afterMarker: Record<string, string | number | boolean>;
}

export interface AgentRepository {
  projectExists(organizationId: string, projectId: string): Promise<boolean>;
  mediaBelongsToProject(organizationId: string, projectId: string, mediaId: string): Promise<boolean>;
  findAgent(organizationId: string, projectId: string, agentUid: string): Promise<AgentAdminItem | null>;
  listAgents(projectIds: string[]): Promise<AgentAdminItem[]>;
  listMedia(projectIds: string[]): Promise<AgentMediaOption[]>;
  saveAgent(input: SaveManualAgentInput & { agentUid: string }): Promise<AgentAdminItem | null>;
  countAgents(organizationId: string, projectId: string): Promise<number>;
  countAgentsByUids(organizationId: string, projectId: string, agentUids: string[]): Promise<number>;
  applyVisibility(organizationId: string, projectId: string, agentUids: string[], showOnSite: boolean): Promise<number>;
  confirmConsentBatch(
    input: ConfirmAgentConsentBatchInput,
    batchId: string,
    actorId: string,
    correlationId: string,
  ): Promise<number>;
  mergeAgents(input: MergeAgentsInput, actorId: string, correlationId: string): Promise<{ source: AgentAdminItem; target: AgentAdminItem } | null>;
  relinkIdentity(input: RelinkAgentIdentityInput, actorId: string, correlationId: string): Promise<boolean>;
  splitIdentity(input: SplitAgentIdentityInput, newAgentUid: string, actorId: string, correlationId: string): Promise<AgentAdminItem | null>;
  appendAudit(input: AgentAuditInput): Promise<void>;
}
