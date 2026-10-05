import type { NormalizedAgentEvidence } from "../../domain/agent-matching.ts";

export interface AgentMatchCandidate {
  agentUid: string;
  origin: "FEED" | "MANUAL";
  fullName: string;
  normalizedFullName: string;
}

export interface AgentEvidenceScope {
  organizationId: string;
  projectId: string;
  sourceId: string;
  sourceRevisionId: string;
  observedAt: Date;
}

export interface AgentMatchingRepository {
  lockProject(organizationId: string, projectId: string): Promise<void>;
  sourceExists(scope: Pick<AgentEvidenceScope, "organizationId" | "projectId" | "sourceId">): Promise<boolean>;
  findCandidates(organizationId: string, projectId: string, phoneNorm: string): Promise<AgentMatchCandidate[]>;
  createFeedAgent(input: AgentEvidenceScope & NormalizedAgentEvidence & { agentUid: string; slug: string }): Promise<string>;
  touchIdentity(input: AgentEvidenceScope & { agentUid: string; phoneNorm: string }): Promise<void>;
  upsertEvidence(input: AgentEvidenceScope & NormalizedAgentEvidence & { agentUid: string | null }): Promise<void>;
  ensureReview(input: AgentEvidenceScope & NormalizedAgentEvidence & { candidateAgentUid: string | null; reason: string }): Promise<void>;
  reconcilePresence(scope: AgentEvidenceScope, activeAgentUids: readonly string[]): Promise<{ active: number; inactive: number }>;
}
