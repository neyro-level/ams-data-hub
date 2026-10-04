import type { PrincipalContext, ProjectJobPrincipal } from "../../../platform/authorization/principal.ts";
import { defineCommand } from "../../../platform/commands/define-command.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { createListingDevelopmentCandidateInputSchema, decideListingDevelopmentLinkInputSchema } from "../contracts.ts";
import { ProjectStateError } from "../domain/project-state-error.ts";
import type { ListingDevelopmentLinkRepository } from "./ports/listing-development-link-repository.ts";
import { requireProjectStateAdmin } from "./project-state-authorization.ts";

export function createListingDevelopmentLinkCommands(dependencies: {
  createRepository(transaction: DatabaseTransaction): ListingDevelopmentLinkRepository;
  now?: () => Date;
}) {
  const createCandidate = defineCommand({
    name: "project-state.listing-development.candidate.create",
    input: createListingDevelopmentCandidateInputSchema,
    authorize: (principal: PrincipalContext, input) => {
      if (principal.kind !== "project-job" || principal.organizationId !== input.organizationId || principal.projectId !== input.projectId) {
        throw new ProjectStateError("LISTING_DEVELOPMENT_ACCESS_DENIED");
      }
    },
    execute: async ({ principal, input, transaction }) => {
      const job = principal as ProjectJobPrincipal;
      const repository = dependencies.createRepository(transaction);
      if (!await repository.projectExists(input.organizationId, input.projectId)
        || (input.developmentUid !== null && !await repository.developmentExists(input.developmentUid))) {
        throw new ProjectStateError("LISTING_DEVELOPMENT_REFERENCE_INVALID");
      }
      const link = await repository.createCandidate(input);
      await repository.appendAudit({
        organizationId: input.organizationId,
        actorType: "SYSTEM",
        actorId: job.jobName,
        correlationId: job.correlationId,
        linkId: link.id,
        action: "listing-development.candidate.create",
        beforeMarker: null,
        afterMarker: { status: "CANDIDATE", hasDevelopment: link.developmentUid !== null, version: link.version },
      });
      return { linkId: link.id, status: link.status, version: link.version };
    },
  });

  const decide = defineCommand({
    name: "project-state.listing-development.decision",
    input: decideListingDevelopmentLinkInputSchema,
    authorize: (principal: PrincipalContext) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const previous = await repository.findById(input.organizationId, input.projectId, input.linkId);
      if (!previous) throw new ProjectStateError("LISTING_DEVELOPMENT_NOT_FOUND");
      if (previous.status !== "CANDIDATE" || (input.decision === "CONFIRMED" && previous.developmentUid === null)) {
        throw new ProjectStateError("LISTING_DEVELOPMENT_DECISION_INVALID");
      }
      const decided = await repository.decide(input, actor.userId, (dependencies.now ?? (() => new Date()))());
      if (!decided) throw new ProjectStateError("LISTING_DEVELOPMENT_STALE");
      await repository.appendAudit({
        organizationId: input.organizationId,
        actorType: "USER",
        actorId: actor.userId,
        correlationId: actor.correlationId,
        linkId: input.linkId,
        action: "listing-development.decision",
        beforeMarker: { status: previous.status, hasDevelopment: previous.developmentUid !== null, version: previous.version },
        afterMarker: { status: decided.status, hasDevelopment: decided.developmentUid !== null, version: decided.version },
      });
      return { linkId: decided.id, status: decided.status, version: decided.version };
    },
  });

  return { createCandidate, decide };
}
