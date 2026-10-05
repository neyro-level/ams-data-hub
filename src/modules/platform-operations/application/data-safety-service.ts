import { z } from "zod";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createCommandFactory, type CommandTransactionRunner } from "../../../platform/commands/define-command.ts";
import { runInPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../../platform/database/transaction.ts";

export interface DataSafetySnapshot {
  jobsFrozen: boolean;
  frozenAt: Date | null;
  reconciledAt: Date | null;
}

export interface DataSafetyRepository {
  freeze(reason: string, now: Date): Promise<DataSafetySnapshot>;
  markReconciled(now: Date): Promise<DataSafetySnapshot>;
  unfreeze(now: Date): Promise<DataSafetySnapshot>;
  read(): Promise<DataSafetySnapshot>;
}

export interface DataSafetyServiceDependencies {
  createRepository(transaction: DatabaseTransaction): DataSafetyRepository;
  now?: () => Date;
  runInTransaction?: CommandTransactionRunner;
}

export class DataSafetyError extends Error {
  public constructor(public readonly code: "DATA_SAFETY_ADMIN_REQUIRED" | "DATA_SAFETY_RECONCILE_FAILED" | "DATA_SAFETY_RECONCILE_REQUIRED" | "DATA_SAFETY_JOBS_FROZEN") {
    super(code);
    this.name = "DataSafetyError";
  }
}

const reconcileInputSchema = z.object({
  publicUrlIdConflicts: z.number().int().min(0),
  uidConflicts: z.number().int().min(0),
  publishSequenceConflicts: z.number().int().min(0),
});

function requireAdmin(principal: PrincipalContext): void {
  if (principal.kind !== "platform-admin") throw new DataSafetyError("DATA_SAFETY_ADMIN_REQUIRED");
}

export function createDataSafetyService(dependencies: DataSafetyServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const defineCommand = createCommandFactory({
    runInTransaction: dependencies.runInTransaction ?? runInPrincipalDatabaseTransaction,
  });
  const freezeMutatingJobs = defineCommand({
    name: "platform-operations.data-safety.freeze",
    input: z.object({ reason: z.string().trim().min(1).max(255) }),
    authorize: requireAdmin,
    execute: ({ input, transaction }) => dependencies.createRepository(transaction).freeze(input.reason, now()),
  });
  const reconcileAfterRestore = defineCommand({
    name: "platform-operations.data-safety.reconcile",
    input: reconcileInputSchema,
    authorize: requireAdmin,
    execute: ({ input, transaction }) => {
      if (Object.values(input).some((count) => count !== 0)) {
        throw new DataSafetyError("DATA_SAFETY_RECONCILE_FAILED");
      }
      return dependencies.createRepository(transaction).markReconciled(now());
    },
  });
  const unfreezeMutatingJobs = defineCommand({
    name: "platform-operations.data-safety.unfreeze",
    input: z.object({}),
    authorize: requireAdmin,
    execute: async ({ transaction }) => {
      const repository = dependencies.createRepository(transaction);
      const state = await repository.read();
      if (!state.jobsFrozen || !state.frozenAt || !state.reconciledAt || state.reconciledAt < state.frozenAt) {
        throw new DataSafetyError("DATA_SAFETY_RECONCILE_REQUIRED");
      }
      return repository.unfreeze(now());
    },
  });
  return { freezeMutatingJobs, reconcileAfterRestore, unfreezeMutatingJobs };
}

export async function assertMutatingJobsAllowed(repository: Pick<DataSafetyRepository, "read">): Promise<void> {
  if ((await repository.read()).jobsFrozen) throw new DataSafetyError("DATA_SAFETY_JOBS_FROZEN");
}
