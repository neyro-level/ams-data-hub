/** A contradictory/unresolved claim vetoes publication; never choose last match. */
export function resolveListingAgentBindings(facts: readonly { externalId: string; inventoryUid: string; recordHash: string }[],
  matches: readonly { agentUid: string | null; offerExternalIds: readonly string[] }[]) {
  const claims = new Map<string, Set<string | null>>();
  for (const match of matches) for (const externalId of match.offerExternalIds) {
    const agents = claims.get(externalId) ?? new Set<string | null>();
    agents.add(match.agentUid); claims.set(externalId, agents);
  }
  return facts.flatMap((fact) => {
    const agents = claims.get(fact.externalId);
    const agentUid = agents?.size === 1 ? [...agents][0] : null;
    return agentUid ? [{ inventoryUid: fact.inventoryUid, recordHash: fact.recordHash, agentUid }] : [];
  });
}
