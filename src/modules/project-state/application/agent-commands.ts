import { createUlid } from "@ams-data-hub/data-contracts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { defineCommand } from "../../../platform/commands/define-command.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  bulkAgentVisibilityInputSchema,
  confirmAgentConsentBatchInputSchema,
  mergeAgentsInputSchema,
  relinkAgentIdentityInputSchema,
  saveManualAgentInputSchema,
  splitAgentIdentityInputSchema,
  type AgentAdminItem,
  type AgentBulkMutationResult,
  type AgentConsentBatchResult,
} from "../contracts.ts";
import { ProjectStateError } from "../domain/project-state-error.ts";
import { AGENT_MAX_BULK_CHANGE_PERCENT, isSuspiciousAgentBulkChange } from "../domain/agent-field-ownership.ts";
import type { AgentRepository } from "./ports/agent-repository.ts";
import { requireProjectStateAdmin } from "./project-state-authorization.ts";

function marker(agent: AgentAdminItem | null): Record<string, string | number | boolean> | null {
  return agent ? {
    origin: agent.origin,
    role: agent.role,
    status: agent.status,
    listingPresenceStatus: agent.listingPresenceStatus,
    showOnSite: agent.showOnSite,
    hasPhoto: agent.photoMediaId !== null,
    specializationCount: agent.specializations.length,
    hasWorkPhone: agent.workPhone !== null,
    hasWorkEmail: agent.workEmail !== null,
    version: agent.version,
  } : null;
}

function feedOwnedChanged(previous: AgentAdminItem, next: {
  origin: string; fullName: string; workPhone: string; workEmail: string; listingPresenceStatus: string;
}): boolean {
  return previous.origin !== next.origin
    || previous.fullName !== next.fullName
    || (previous.workPhone ?? "") !== next.workPhone
    || (previous.workEmail ?? "") !== next.workEmail
    || previous.listingPresenceStatus !== next.listingPresenceStatus;
}

export function createAgentCommands(dependencies: {
  createRepository(transaction: DatabaseTransaction): AgentRepository;
}) {
  const saveManualAgent = defineCommand({
    name: "project-state.agent.save-manual",
    input: saveManualAgentInputSchema,
    authorize: (principal: PrincipalContext) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      if (!await repository.projectExists(input.organizationId, input.projectId)) {
        throw new ProjectStateError("AGENT_REFERENCE_INVALID");
      }
      if (input.photoMediaId && !await repository.mediaBelongsToProject(input.organizationId, input.projectId, input.photoMediaId)) {
        throw new ProjectStateError("AGENT_REFERENCE_INVALID");
      }
      const agentUid = input.agentUid ?? createUlid();
      const previous = input.agentUid ? await repository.findAgent(input.organizationId, input.projectId, input.agentUid) : null;
      if ((previous?.version ?? 0) !== input.version) throw new ProjectStateError("AGENT_NOT_FOUND_OR_STALE");
      if (!previous && input.origin !== "MANUAL") throw new ProjectStateError("AGENT_FEED_FIELD_OWNERSHIP_VIOLATION");
      if (previous?.origin === "FEED" && feedOwnedChanged(previous, input)) {
        throw new ProjectStateError("AGENT_FEED_FIELD_OWNERSHIP_VIOLATION");
      }
      const saved = await repository.saveAgent({ ...input, agentUid });
      if (!saved) throw new ProjectStateError("AGENT_NOT_FOUND_OR_STALE");
      await repository.appendAudit({
        organizationId: input.organizationId, projectId: input.projectId,
        actorId: actor.userId, correlationId: actor.correlationId,
        action: "agent.save", entityId: saved.uid,
        beforeMarker: marker(previous), afterMarker: marker(saved)!,
      });
      return saved;
    },
  });

  const mergeAgents = defineCommand({
    name: "project-state.agent.merge",
    input: mergeAgentsInputSchema,
    authorize: (principal: PrincipalContext) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const result = await repository.mergeAgents(input, actor.userId, actor.correlationId);
      if (!result) throw new ProjectStateError("AGENT_NOT_FOUND_OR_STALE");
      await repository.appendAudit({
        organizationId: input.organizationId, projectId: input.projectId,
        actorId: actor.userId, correlationId: actor.correlationId, action: "agent.merge",
        entityId: result.target.uid,
        beforeMarker: { sourceVersion: input.sourceVersion, targetVersion: input.targetVersion },
        afterMarker: { sourceHidden: true, targetVersion: result.target.version },
      });
      return result;
    },
  });

  const relinkAgentIdentity = defineCommand({
    name: "project-state.agent.relink",
    input: relinkAgentIdentityInputSchema,
    authorize: (principal: PrincipalContext) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      if (!await repository.relinkIdentity(input, actor.userId, actor.correlationId)) {
        throw new ProjectStateError("AGENT_EXTERNAL_IDENTITY_NOT_FOUND");
      }
      await repository.appendAudit({
        organizationId: input.organizationId, projectId: input.projectId,
        actorId: actor.userId, correlationId: actor.correlationId, action: "agent.relink",
        entityId: input.targetAgentUid,
        beforeMarker: { sourceAgentUid: input.sourceAgentUid },
        afterMarker: { targetAgentUid: input.targetAgentUid, identityRelinked: true },
      });
      return { targetAgentUid: input.targetAgentUid };
    },
  });

  const splitAgentIdentity = defineCommand({
    name: "project-state.agent.split",
    input: splitAgentIdentityInputSchema,
    authorize: (principal: PrincipalContext) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const created = await repository.splitIdentity(input, createUlid(), actor.userId, actor.correlationId);
      if (!created) throw new ProjectStateError("AGENT_EXTERNAL_IDENTITY_NOT_FOUND");
      await repository.appendAudit({
        organizationId: input.organizationId, projectId: input.projectId,
        actorId: actor.userId, correlationId: actor.correlationId, action: "agent.split",
        entityId: created.uid,
        beforeMarker: { sourceAgentUid: input.sourceAgentUid },
        afterMarker: { newAgentUid: created.uid, identitySplit: true },
      });
      return created;
    },
  });

  const setAgentVisibilityBatch = defineCommand<PrincipalContext, typeof bulkAgentVisibilityInputSchema, AgentBulkMutationResult>({
    name: "project-state.agent.visibility-batch",
    input: bulkAgentVisibilityInputSchema,
    authorize: (principal) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const [total, affected] = await Promise.all([
        repository.countAgents(input.organizationId, input.projectId),
        repository.countAgentsByUids(input.organizationId, input.projectId, input.agentUids),
      ]);
      if (affected !== input.agentUids.length) throw new ProjectStateError("AGENT_REFERENCE_INVALID");
      if (isSuspiciousAgentBulkChange(total, affected)) {
        return { state: "SUSPICIOUS", affected, total, thresholdPercent: AGENT_MAX_BULK_CHANGE_PERCENT };
      }
      const applied = await repository.applyVisibility(input.organizationId, input.projectId, input.agentUids, input.showOnSite);
      await repository.appendAudit({
        organizationId: input.organizationId, projectId: input.projectId,
        actorId: actor.userId, correlationId: actor.correlationId, action: "agent.visibility-batch",
        entityId: input.projectId,
        beforeMarker: { affected: applied, total },
        afterMarker: { affected: applied, total, showOnSite: input.showOnSite },
      });
      return { state: "APPLIED", affected: applied, total };
    },
  });

  const confirmAgentConsentBatch = defineCommand<PrincipalContext, typeof confirmAgentConsentBatchInputSchema, AgentConsentBatchResult>({
    name: "project-state.agent.consent-batch",
    input: confirmAgentConsentBatchInputSchema,
    authorize: (principal) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      if (Date.parse(input.confirmedAt) > Date.now()) throw new ProjectStateError("AGENT_CONSENT_DATE_INVALID");
      const repository = dependencies.createRepository(transaction);
      const [total, affected] = await Promise.all([
        repository.countAgents(input.organizationId, input.projectId),
        repository.countAgentsByUids(input.organizationId, input.projectId, input.agentUids),
      ]);
      if (affected !== input.agentUids.length) throw new ProjectStateError("AGENT_REFERENCE_INVALID");
      if (isSuspiciousAgentBulkChange(total, affected) && !input.confirmSuspicious) {
        return { state: "SUSPICIOUS", affected, total, thresholdPercent: AGENT_MAX_BULK_CHANGE_PERCENT };
      }
      const batchId = createUlid();
      const applied = await repository.confirmConsentBatch(input, batchId, actor.userId, actor.correlationId);
      if (applied !== affected) throw new ProjectStateError("AGENT_REFERENCE_INVALID");
      await repository.appendAudit({
        organizationId: input.organizationId, projectId: input.projectId,
        actorId: actor.userId, correlationId: actor.correlationId, action: "agent.consent-batch",
        entityId: batchId,
        beforeMarker: { affected: applied, total },
        afterMarker: {
          affected: applied,
          total,
          batchId,
          confirmedAt: input.confirmedAt,
          hasReference: input.referenceUrl.length > 0,
          hasNote: input.note.length > 0,
          suspiciousConfirmed: isSuspiciousAgentBulkChange(total, affected),
        },
      });
      return { state: "APPLIED", affected: applied, total, batchId };
    },
  });

  return { saveManualAgent, mergeAgents, relinkAgentIdentity, splitAgentIdentity, setAgentVisibilityBatch, confirmAgentConsentBatch };
}
