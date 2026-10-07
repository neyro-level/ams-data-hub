import { createUlid } from "@ams-data-hub/data-contracts";
import { z } from "zod";
import type { PrincipalContext, ProjectJobPrincipal } from "../../../platform/authorization/principal.ts";
import { defineCommand } from "../../../platform/commands/define-command.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  ambiguousPhoneNames,
  normalizeAgentEvidence,
  type NormalizedAgentEvidence,
} from "../domain/agent-matching.ts";
import type { AgentEvidenceScope, AgentMatchingRepository } from "./ports/agent-matching-repository.ts";
import { resolveListingAgentBindings } from "./listing-agent-matching.ts";

const evidenceSchema = z.object({
  fullNameRaw: z.string().trim().min(1).max(240),
  phoneRaw: z.string().trim().max(80).optional(),
  photoSourceUrl: z.url({ protocol: /^https?$/ }).max(2048).optional(),
  categoryRaw: z.string().trim().max(120).optional(),
  offerExternalIds: z.array(z.string().trim().min(1).max(240)).min(1).max(100_000),
}).strict();

export const reconcileFeedAgentsInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  sourceRevisionId: z.string().trim().min(1).max(128),
  observedAt: z.iso.datetime({ offset: true }),
  sharedOfficePhones: z.array(z.string().regex(/^\+[1-9]\d{7,14}$/u)).max(1000).default([]),
  evidence: z.array(evidenceSchema).max(100_000),
}).strict();

export type ReconcileFeedAgentsInput = z.infer<typeof reconcileFeedAgentsInputSchema>;
export type AgentMatchOutcome = "BOUND" | "CREATED" | "REVIEW" | "SHARED_OFFICE" | "INVALID_PHONE";
export interface AgentMatchBinding {
  evidenceKey: string;
  agentUid: string | null;
  outcome: AgentMatchOutcome;
  offerExternalIds: readonly string[];
}
export interface AgentMatchingResult {
  bindings: readonly AgentMatchBinding[];
  activeAgents: number;
  noActiveListings: number;
}

function requireScopedJob(principal: PrincipalContext, input: ReconcileFeedAgentsInput): ProjectJobPrincipal {
  if (
    principal.kind !== "project-job" ||
    principal.jobName !== "agent-matching" ||
    principal.organizationId !== input.organizationId ||
    principal.projectId !== input.projectId
  ) throw new Error("AGENT_MATCHING_PROJECT_JOB_REQUIRED");
  return principal;
}

function deduplicate(items: readonly NormalizedAgentEvidence[]): NormalizedAgentEvidence[] {
  const byKey = new Map<string, NormalizedAgentEvidence>();
  for (const item of items) {
    const previous = byKey.get(item.evidenceKey);
    byKey.set(item.evidenceKey, previous ? {
      ...previous,
      photoSourceUrl: item.photoSourceUrl ?? previous.photoSourceUrl,
      categoryRaw: item.categoryRaw ?? previous.categoryRaw,
      offerExternalIds: [...new Set([...previous.offerExternalIds, ...item.offerExternalIds])],
    } : item);
  }
  return [...byKey.values()];
}

export function createFeedAgentMatchingCommands(dependencies: {
  createRepository(transaction: DatabaseTransaction): AgentMatchingRepository;
  createUid?: () => string;
}) {
  const createUid = dependencies.createUid ?? (() => createUlid());
  const reconcileFeedAgents = defineCommand<PrincipalContext, typeof reconcileFeedAgentsInputSchema, AgentMatchingResult>({
    name: "project-state.agent.reconcile-feed",
    input: reconcileFeedAgentsInputSchema,
    authorize: (principal) => {
      if (principal.kind !== "project-job") throw new Error("AGENT_MATCHING_PROJECT_JOB_REQUIRED");
    },
    execute: async ({ principal, input, transaction }) => {
      requireScopedJob(principal, input);
      const repository = dependencies.createRepository(transaction);
      const scope: AgentEvidenceScope = {
        organizationId: input.organizationId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        sourceRevisionId: input.sourceRevisionId,
        observedAt: new Date(input.observedAt),
      };
      if (!await repository.sourceExists(scope)) throw new Error("AGENT_MATCHING_SOURCE_NOT_FOUND");
      const requestedOffers = new Set<string>();
      let claimCount = input.evidence.length;
      for (const item of input.evidence) for (const externalId of item.offerExternalIds) {
        claimCount++;
        requestedOffers.add(externalId);
        if (claimCount > 50_000 || requestedOffers.size > 50_000) throw new Error("AGENT_MATCHING_LIMIT_EXCEEDED");
      }
      await repository.lockProject(input.organizationId, input.projectId);
      const facts = await repository.readGoodOffers(scope, [...requestedOffers]);
      const evidence = deduplicate(input.evidence.map((item) => normalizeAgentEvidence({ ...item, sourceId: input.sourceId })));
      const ambiguousPhones = ambiguousPhoneNames(evidence);
      const sharedPhones = new Set(input.sharedOfficePhones);
      const activeAgentUids = new Set<string>();
      const bindings: AgentMatchBinding[] = [];

      for (const item of evidence) {
        let agentUid: string | null = null;
        let outcome: AgentMatchOutcome;
        if (!item.phoneNorm) {
          outcome = "INVALID_PHONE";
        } else if (sharedPhones.has(item.phoneNorm)) {
          outcome = "SHARED_OFFICE";
        } else if (ambiguousPhones.has(item.phoneNorm)) {
          await repository.ensureReview({ ...scope, ...item, candidateAgentUid: null, reason: "PHONE_NAME_COLLISION_IN_REVISION" });
          outcome = "REVIEW";
        } else {
          const candidates = await repository.findCandidates(input.organizationId, input.projectId, item.phoneNorm);
          const matching = [...new Map(candidates
            .filter((candidate) => candidate.normalizedFullName === item.normalizedFullName)
            .map((candidate) => [candidate.agentUid, candidate])).values()];
          if (candidates.length > 0 && (matching.length !== 1 || candidates.some((candidate) => candidate.normalizedFullName !== item.normalizedFullName))) {
            await repository.ensureReview({
              ...scope,
              ...item,
              candidateAgentUid: candidates.length === 1 ? candidates[0]!.agentUid : null,
              reason: "PHONE_NAME_COLLISION_WITH_EXISTING_AGENT",
            });
            outcome = "REVIEW";
          } else if (matching.length === 1) {
            agentUid = matching[0]!.agentUid;
            await repository.touchIdentity({ ...scope, agentUid, phoneNorm: item.phoneNorm });
            outcome = "BOUND";
          } else {
            agentUid = createUid();
            await repository.createFeedAgent({ ...scope, ...item, agentUid, slug: `agent-${agentUid.toLowerCase()}` });
            await repository.touchIdentity({ ...scope, agentUid, phoneNorm: item.phoneNorm });
            outcome = "CREATED";
          }
        }
        if (agentUid) activeAgentUids.add(agentUid);
        await repository.upsertEvidence({ ...scope, ...item, agentUid });
        bindings.push({ evidenceKey: item.evidenceKey, agentUid, outcome, offerExternalIds: item.offerExternalIds });
      }
      const presence = await repository.reconcilePresence(scope, [...activeAgentUids]);
      await repository.replaceListingBindings(scope, resolveListingAgentBindings(facts, bindings));
      return { bindings, activeAgents: presence.active, noActiveListings: presence.inactive };
    },
  });
  return { reconcileFeedAgents };
}
