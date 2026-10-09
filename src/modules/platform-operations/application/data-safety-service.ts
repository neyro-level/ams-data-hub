import { z } from "zod";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createCommandFactory, type CommandTransactionRunner } from "../../../platform/commands/define-command.ts";
import { runInPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../../platform/database/transaction.ts";

export interface DataSafetySnapshot {
  jobsFrozen: boolean;
  frozenAt: Date | null;
  reconciledAt: Date | null;
}

export interface DataSafetyConsistencyReport {
  publicUrlIdConflicts: number;
  uidConflicts: number;
  publishSequenceConflicts: number;
}

export interface DataSafetyRepository {
  lockControl(): Promise<void>;
  inspectConsistency(): Promise<DataSafetyConsistencyReport>;
  freeze(reason: string, now: Date): Promise<DataSafetySnapshot>;
  markReconciled(now: Date): Promise<DataSafetySnapshot>;
  unfreeze(now: Date): Promise<DataSafetySnapshot>;
  read(): Promise<DataSafetySnapshot>;
  appendAudit(input: {
    actorId: string;
    correlationId: string;
    action: "data-safety.freeze" | "data-safety.reconcile" | "data-safety.unfreeze";
    afterMarker: Record<string, string | number | boolean>;
  }): Promise<void>;
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

function requireAdmin(principal: PrincipalContext) {
  if (principal.kind !== "platform-admin") throw new DataSafetyError("DATA_SAFETY_ADMIN_REQUIRED");
  return principal;
}

export function createDataSafetyService(dependencies: DataSafetyServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const defineCommand = createCommandFactory({
    runInTransaction: dependencies.runInTransaction ?? runInPrincipalDatabaseTransaction,
  });
  const freezeMutatingJobs = defineCommand({
    name: "platform-operations.data-safety.freeze",
    input: z.object({ reason: z.string().trim().min(1).max(255) }),
    authorize: (principal) => { requireAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const repository = dependencies.createRepository(transaction);
      const result = await repository.freeze(input.reason, now());
      const actor = requireAdmin(principal);
      await repository.appendAudit({ actorId: actor.userId, correlationId: actor.correlationId, action: "data-safety.freeze", afterMarker: { jobsFrozen: true, reasonRecorded: true } });
      return result;
    },
  });
  const reconcileAfterRestore = defineCommand({
    name: "platform-operations.data-safety.reconcile",
    input: reconcileInputSchema,
    authorize: (principal) => { requireAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      if (Object.values(input).some((count) => count !== 0)) {
        throw new DataSafetyError("DATA_SAFETY_RECONCILE_FAILED");
      }
      const repository = dependencies.createRepository(transaction);
      await repository.lockControl();
      const state = await repository.read();
      if (!state.jobsFrozen || !state.frozenAt) throw new DataSafetyError("DATA_SAFETY_RECONCILE_REQUIRED");
      const observed = reconcileInputSchema.parse(await repository.inspectConsistency());
      if (Object.values(observed).some((count) => count !== 0)) throw new DataSafetyError("DATA_SAFETY_RECONCILE_FAILED");
      const result = await repository.markReconciled(now());
      const actor = requireAdmin(principal);
      await repository.appendAudit({ actorId: actor.userId, correlationId: actor.correlationId, action: "data-safety.reconcile", afterMarker: { jobsFrozen: result.jobsFrozen, conflicts: 0 } });
      return result;
    },
  });
  const unfreezeMutatingJobs = defineCommand({
    name: "platform-operations.data-safety.unfreeze",
    input: z.object({}),
    authorize: (principal) => { requireAdmin(principal); },
    execute: async ({ principal, transaction }) => {
      const repository = dependencies.createRepository(transaction);
      await repository.lockControl();
      const state = await repository.read();
      if (!state.jobsFrozen || !state.frozenAt || !state.reconciledAt || state.reconciledAt < state.frozenAt) {
        throw new DataSafetyError("DATA_SAFETY_RECONCILE_REQUIRED");
      }
      const observed = reconcileInputSchema.parse(await repository.inspectConsistency());
      if (Object.values(observed).some((count) => count !== 0)) throw new DataSafetyError("DATA_SAFETY_RECONCILE_FAILED");
      const result = await repository.unfreeze(now());
      const actor = requireAdmin(principal);
      await repository.appendAudit({ actorId: actor.userId, correlationId: actor.correlationId, action: "data-safety.unfreeze", afterMarker: { jobsFrozen: false } });
      return result;
    },
  });
  return { freezeMutatingJobs, reconcileAfterRestore, unfreezeMutatingJobs };
}

export async function assertMutatingJobsAllowed(repository: Pick<DataSafetyRepository, "read">): Promise<void> {
  if ((await repository.read()).jobsFrozen) throw new DataSafetyError("DATA_SAFETY_JOBS_FROZEN");
}
