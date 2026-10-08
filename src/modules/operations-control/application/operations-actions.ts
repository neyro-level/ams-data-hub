import { createHash } from "node:crypto";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createCommandFactory, type CommandTransactionRunner } from "../../../platform/commands/define-command.ts";
import { runInPrincipalDatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  OperationsControlError,
  requestOperationalActionInputSchema,
  type OperationalAction,
  type RequestOperationalActionInput,
} from "../contracts.ts";
import type { OperationsActionRepository } from "./ports/operations-action-repository.ts";

function requireAdmin(principal: PrincipalContext) {
  if (principal.kind !== "platform-admin") {
    throw new OperationsControlError("OPERATIONS_CONTROL_ADMIN_ACCESS_DENIED");
  }
  return principal;
}

function normalizedRequest(input: RequestOperationalActionInput) {
  const suspicious = input.action === "SUSPICIOUS_APPROVE" || input.action === "SUSPICIOUS_REJECT";
  return {
    action: input.action,
    organizationId: input.organizationId,
    projectId: input.projectId,
    sourceId: suspicious ? input.sourceId : null,
    sourceRevisionId: suspicious ? input.sourceRevisionId : null,
    sourcePublishSequence: input.action === "SNAPSHOT_ROLLBACK" ? input.sourcePublishSequence ?? null : null,
    buildInputId: input.action === "SNAPSHOT_PUBLISH" ? input.buildInputId ?? null : null,
    ackRotationPhase: input.action === "ACK_ROTATE" ? input.ackRotationPhase ?? null : null,
    ackCredentialVersion: input.action === "ACK_ROTATE" ? input.ackCredentialVersion ?? null : null,
    reason: suspicious ? input.reason : null,
  };
}

function requestHash(input: ReturnType<typeof normalizedRequest>) {
  return createHash("sha256").update(JSON.stringify({
    action: input.action,
    organizationId: input.organizationId,
    projectId: input.projectId,
    sourceId: input.sourceId,
    sourceRevisionId: input.sourceRevisionId,
    sourcePublishSequence: input.sourcePublishSequence,
    reason: input.reason,
    ...(input.action === "SNAPSHOT_PUBLISH" ? { buildInputId: input.buildInputId } : {}),
    ...(input.action === "ACK_ROTATE" ? { ackRotationPhase: input.ackRotationPhase, ackCredentialVersion: input.ackCredentialVersion } : {}),
  })).digest("hex");
}

export function createOperationsActions(dependencies: {
  createRepository(transaction: DatabaseTransaction): OperationsActionRepository;
  runInTransaction?: CommandTransactionRunner;
}) {
  const defineCommand = createCommandFactory({
    runInTransaction: dependencies.runInTransaction ?? runInPrincipalDatabaseTransaction,
  });
  const requestAction = defineCommand({
    name: "operations-control.action.request",
    input: requestOperationalActionInputSchema,
    authorize: (principal: PrincipalContext) => { requireAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireAdmin(principal);
      if (input.action === "RUN_SOURCE") {
        throw new OperationsControlError("OPERATIONS_CONTROL_REFERENCE_INVALID");
      }
      const normalized = normalizedRequest(input);
      return dependencies.createRepository(transaction).recordRequest({
        action: input.action as Exclude<OperationalAction, "RUN_SOURCE">,
        organizationId: input.organizationId,
        projectId: input.projectId,
        sourceId: normalized.sourceId,
        sourceRevisionId: normalized.sourceRevisionId,
        sourcePublishSequence: normalized.sourcePublishSequence,
        buildInputId: normalized.buildInputId,
        ...(input.action === "ACK_ROTATE" ? { ackRotationPhase: normalized.ackRotationPhase, ackCredentialVersion: normalized.ackCredentialVersion } : {}),
        reason: normalized.reason,
        idempotencyKey: input.idempotencyKey,
        requestHash: requestHash(normalized),
        actorId: actor.userId,
        correlationId: actor.correlationId,
      });
    },
  });
  return { requestAction };
}
