import type { JobPrincipal, PrincipalContext } from "../../../platform/authorization/principal.ts";
import { defineCommand } from "../../../platform/commands/define-command.ts";
import { runInProjectPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  replaceEntityEditorialInputSchema,
  replaceEntityMediaOrderPolicyInputSchema,
  type ReplaceEntityMediaOrderPolicyInput,
} from "../contracts.ts";
import { ProjectStateError } from "../domain/project-state-error.ts";
import type { EntityEditorialRepository, StoredEntityEditorial, StoredEntityMediaOrderPolicy } from "./ports/entity-editorial-repository.ts";
import { requireProjectStateAdmin } from "./project-state-authorization.ts";

function sameMediaSet(candidate: string[], source: string[]): boolean {
  return candidate.length === source.length && candidate.every((value) => source.includes(value));
}

function editorialMarker(editorial: StoredEntityEditorial | null, version: number) {
  return editorial ? {
    hasShortDescription: editorial.shortDescription !== null,
    descriptionLength: editorial.description?.length ?? 0,
    faqCount: editorial.faq.length,
    hasPresentationNotes: editorial.presentationNotes !== null,
    mediaCount: editorial.mediaOrder.length,
    version,
  } : null;
}

function policyMarker(policy: StoredEntityMediaOrderPolicy | null, version: number, overrideCleared = false) {
  return policy ? {
    sourceMediaCount: policy.sourceMediaOrder.length,
    isImageOrderChangeAllowed: policy.isImageOrderChangeAllowed,
    overrideCleared,
    version,
  } : null;
}

export function createEntityEditorialCommands(dependencies: {
  createRepository(transaction: DatabaseTransaction): EntityEditorialRepository;
}) {
  const replaceEntityEditorial = defineCommand({
    name: "project-state.entity-editorial.replace",
    input: replaceEntityEditorialInputSchema,
    authorize: (principal: PrincipalContext) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      if (!await repository.projectExists(input.organizationId, input.projectId)) {
        throw new ProjectStateError("PROJECT_EDITORIAL_REFERENCE_INVALID");
      }
      const previous = await repository.findEditorial(input);
      if ((previous?.version ?? 0) !== input.version) throw new ProjectStateError("PROJECT_EDITORIAL_STALE");
      const policy = await repository.findPolicy(input);
      if (input.mediaOrder.length > 0) {
        if (!policy?.isImageOrderChangeAllowed) throw new ProjectStateError("PROJECT_EDITORIAL_MEDIA_ORDER_LOCKED");
        if (!sameMediaSet(input.mediaOrder, policy.sourceMediaOrder)) throw new ProjectStateError("PROJECT_EDITORIAL_MEDIA_ORDER_INVALID");
      }
      const version = await repository.replaceEditorial(input, input.mediaOrder.length > 0 ? policy?.version ?? null : null);
      if (!version) throw new ProjectStateError("PROJECT_EDITORIAL_STALE");
      await repository.appendAudit({
        organizationId: input.organizationId,
        projectId: input.projectId,
        entityType: input.entityType,
        entityUid: input.entityUid,
        actorType: "USER",
        actorId: actor.userId,
        correlationId: actor.correlationId,
        action: "entity-editorial.replace",
        beforeMarker: editorialMarker(previous, previous?.version ?? 0),
        afterMarker: {
          hasShortDescription: input.shortDescription.length > 0,
          descriptionLength: input.description.length,
          faqCount: input.faq.length,
          hasPresentationNotes: input.presentationNotes.length > 0,
          mediaCount: input.mediaOrder.length,
          version,
        },
      });
      return { entityUid: input.entityUid, version };
    },
  });

  async function replaceEntityMediaOrderPolicy(principal: PrincipalContext, rawInput: ReplaceEntityMediaOrderPolicyInput) {
    const input = replaceEntityMediaOrderPolicyInputSchema.parse(rawInput);
    if (principal.kind !== "job" || principal.organizationId !== input.organizationId) {
      throw new ProjectStateError("PROJECT_EDITORIAL_JOB_ACCESS_DENIED");
    }
    const job = principal as JobPrincipal;
    return runInProjectPrincipalDatabaseTransaction(job, input.projectId, async (transaction) => {
      const repository = dependencies.createRepository(transaction);
      if (!await repository.projectExists(input.organizationId, input.projectId)) {
        throw new ProjectStateError("PROJECT_EDITORIAL_REFERENCE_INVALID");
      }
      const previous = await repository.findPolicy(input);
      if ((previous?.version ?? 0) !== input.version) throw new ProjectStateError("PROJECT_EDITORIAL_STALE");
      const result = await repository.replacePolicy(input);
      if (!result) throw new ProjectStateError("PROJECT_EDITORIAL_STALE");
      await repository.appendAudit({
        organizationId: input.organizationId,
        projectId: input.projectId,
        entityType: input.entityType,
        entityUid: input.entityUid,
        actorType: "SYSTEM",
        actorId: job.jobName,
        correlationId: job.correlationId,
        action: "entity-media-order-policy.replace",
        beforeMarker: policyMarker(previous, previous?.version ?? 0),
        afterMarker: {
          sourceMediaCount: input.sourceMediaOrder.length,
          isImageOrderChangeAllowed: input.isImageOrderChangeAllowed,
          overrideCleared: result.overrideCleared,
          version: result.version,
        },
      });
      return { entityUid: input.entityUid, version: result.version, overrideCleared: result.overrideCleared };
    });
  }

  return { replaceEntityEditorial, replaceEntityMediaOrderPolicy };
}
