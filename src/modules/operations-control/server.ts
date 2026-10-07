import type { PrincipalContext } from "../../platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../platform/database/transaction.ts";
import { getFleetDashboardWithRepository } from "./application/fleet-queries.ts";
import { PrismaFleetRepository } from "./infrastructure/prisma-fleet-repository.ts";
import { sourceRegistryCommands } from "../ingestion-core/server.ts";
import { requestOperationalActionInputSchema, type RequestOperationalActionInput } from "./contracts.ts";
import { createOperationsActions } from "./application/operations-actions.ts";
import { PrismaOperationsActionRepository } from "./infrastructure/prisma-operations-action-repository.ts";
export { executeSuspiciousRejection } from "./infrastructure/suspicious-rejection-executor.ts";
export { createOperationalSnapshotBuildExecutor } from "./infrastructure/snapshot-build-executor.ts";

const operationsActions = createOperationsActions({
  createRepository: (transaction) => new PrismaOperationsActionRepository(transaction),
});

export function getFleetDashboard(principal: PrincipalContext) {
  return runInPrincipalDatabaseTransaction(principal, (transaction) =>
    getFleetDashboardWithRepository({
      principal,
      repository: new PrismaFleetRepository(transaction),
    }));
}

export async function requestOperationalAction(
  principal: PrincipalContext,
  rawInput: RequestOperationalActionInput,
) {
  const input = requestOperationalActionInputSchema.parse(rawInput);
  if (input.action === "RUN_SOURCE") {
    return sourceRegistryCommands.requestManualSourceRun(principal, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
    });
  }
  return operationsActions.requestAction(principal, input);
}
