import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { runInProjectPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { InventoryIdentityKey, InventoryIdentityRepository } from "./ports/inventory-identity-repository.ts";
import {
  reconcileMissingInventory,
  reconcileSeenInventory,
  type InventoryLifecyclePolicy,
  type InventoryMissingRunContext,
  type InventorySeenInput,
} from "../domain/inventory-lifecycle.ts";

function assertInventoryJobPrincipal(principal: PrincipalContext): void {
  if (principal.kind !== "job" && principal.kind !== "project-job") {
    throw new Error("INVENTORY_IDENTITY_JOB_REQUIRED");
  }
}

export function createInventoryIdentityCommands(dependencies: {
  createRepository(transaction: DatabaseTransaction): InventoryIdentityRepository;
  createUid(timestamp?: number): string;
}) {
  return {
    recordSeen(principal: PrincipalContext, input: InventorySeenInput) {
      assertInventoryJobPrincipal(principal);
      return runInProjectPrincipalDatabaseTransaction(principal, input.projectId, async (transaction) => {
        const repository = dependencies.createRepository(transaction);
        const current = await repository.find({
          organizationId: input.organizationId,
          projectId: input.projectId,
          sourceId: input.sourceId,
          externalOfferId: input.externalOfferId,
        });
        const decision = reconcileSeenInventory(current, input, dependencies.createUid);
        return repository.save({ state: decision.state, expectedVersion: current?.version ?? null, event: decision.event, occurredAt: input.seenAt });
      });
    },
    recordMissing(
      principal: PrincipalContext,
      key: InventoryIdentityKey,
      policy: InventoryLifecyclePolicy,
      run: InventoryMissingRunContext,
    ) {
      assertInventoryJobPrincipal(principal);
      return runInProjectPrincipalDatabaseTransaction(principal, key.projectId, async (transaction) => {
        const repository = dependencies.createRepository(transaction);
        const current = await repository.find(key);
        if (!current) throw new Error("INVENTORY_IDENTITY_NOT_FOUND");
        const decision = reconcileMissingInventory(current, policy, run);
        if (decision.outcome === "UNCHANGED") return decision.state;
        return repository.save({ state: decision.state, expectedVersion: current.version, event: decision.event, occurredAt: run.occurredAt });
      });
    },
  };
}
