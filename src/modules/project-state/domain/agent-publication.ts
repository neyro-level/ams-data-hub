export interface AgentPublicationState {
  status: "ACTIVE" | "HIDDEN" | "DEPARTED";
  showOnSite: boolean;
  consentConfirmedAt: Date | null;
}

export function isAgentPubliclyPublishable(agent: AgentPublicationState): boolean {
  return agent.status === "ACTIVE" && agent.showOnSite && agent.consentConfirmedAt !== null;
}
