import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { defineCommand } from "../../../platform/commands/define-command.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { replaceProjectPublicContactInputSchema } from "../contracts.ts";
import { ProjectStateError } from "../domain/project-state-error.ts";
import type { ContactPresenceMarker, ProjectPublicContactRepository, StoredProjectPublicContact } from "./ports/project-public-contact-repository.ts";
import { requireProjectStateAdmin } from "./project-state-authorization.ts";

function marker(contact: StoredProjectPublicContact | null, version: number): ContactPresenceMarker | null {
  return contact ? {
    hasEmail: contact.email !== null,
    hasAddress: contact.addressPublic !== null,
    messengerCount: contact.messengers.length,
    hasHours: contact.hours !== null,
    version,
  } : null;
}

export function createProjectPublicContactCommands(dependencies: {
  createRepository(transaction: DatabaseTransaction): ProjectPublicContactRepository;
}) {
  const replaceProjectPublicContact = defineCommand({
    name: "project-state.public-contact.replace",
    input: replaceProjectPublicContactInputSchema,
    authorize: (principal: PrincipalContext) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      if (!await repository.projectExists(input.organizationId, input.projectId)) {
        throw new ProjectStateError("PROJECT_PUBLIC_CONTACT_REFERENCE_INVALID");
      }
      const previous = await repository.find(input.organizationId, input.projectId);
      if ((previous?.version ?? 0) !== input.version) {
        throw new ProjectStateError("PROJECT_PUBLIC_CONTACT_STALE");
      }
      const version = await repository.replace(input);
      if (!version) throw new ProjectStateError("PROJECT_PUBLIC_CONTACT_STALE");
      await repository.appendAudit({
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        beforeMarker: marker(previous, previous?.version ?? 0),
        afterMarker: {
          hasEmail: input.email.length > 0,
          hasAddress: input.addressPublic.length > 0,
          messengerCount: input.messengers.length,
          hasHours: input.hours.length > 0,
          version,
        },
      });
      return { projectId: input.projectId, version };
    },
  });
  return { replaceProjectPublicContact };
}
