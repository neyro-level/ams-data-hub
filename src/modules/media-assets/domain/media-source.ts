import type { MediaSourceKind } from "../contracts.ts";

export interface AgentMediaPublicationState {
  status: "ACTIVE" | "HIDDEN" | "DEPARTED";
  showOnSite: boolean;
  consentConfirmedAt: Date | null;
}

export function canonicalizeMediaSourceUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

export function isMirroredMediaPubliclyPublishable(
  kind: MediaSourceKind,
  agent: AgentMediaPublicationState | null,
): boolean {
  if (kind !== "AGENT_PHOTO") return true;
  return Boolean(
    agent
    && agent.status === "ACTIVE"
    && agent.showOnSite
    && agent.consentConfirmedAt !== null,
  );
}
