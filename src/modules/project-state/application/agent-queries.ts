import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { AgentAdminItem, AgentMediaOption } from "../contracts.ts";
import type { AgentRepository } from "./ports/agent-repository.ts";
import { requireProjectStateAdmin } from "./project-state-authorization.ts";

export function createAgentQueries(dependencies: { createRepository(transaction: DatabaseTransaction): AgentRepository }) {
  return async function listAgentsForAdmin(principal: PrincipalContext, projectIds: string[]): Promise<{
    agents: AgentAdminItem[];
    media: AgentMediaOption[];
  }> {
    requireProjectStateAdmin(principal);
    if (projectIds.length === 0) return { agents: [], media: [] };
    return runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const repository = dependencies.createRepository(transaction);
      const [agents, media] = await Promise.all([repository.listAgents(projectIds), repository.listMedia(projectIds)]);
      return { agents, media };
    });
  };
}
