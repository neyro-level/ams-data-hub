import { createPublicUrlId } from "@ams-data-hub/data-contracts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { defineCommand } from "../../../platform/commands/define-command.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  changeProjectUrlPathInputSchema,
  createProjectUrlEntryInputSchema,
  publishProjectUrlEntryInputSchema,
  relinkProjectUrlEntryInputSchema,
  replaceProjectUrlPolicyInputSchema,
  transitionProjectUrlLifecycleInputSchema,
  type ProjectUrlEntryDto,
} from "../contracts.ts";
import { ProjectStateError } from "../domain/project-state-error.ts";
import type { ProjectUrlRegistryRepository, StoredProjectUrlPolicy } from "./ports/project-url-registry-repository.ts";
import { requireProjectStateAdmin } from "./project-state-authorization.ts";

function entryMarker(entry: ProjectUrlEntryDto | null) {
  return entry ? {
    entityType: entry.entityType,
    factualLifecycle: entry.factualLifecycle,
    presentationLifecycle: entry.presentationLifecycle,
    isPublished: entry.publishedAt !== null,
    isRetired: entry.retiredAt !== null,
    hasRedirectTarget: entry.redirectTargetPath !== null,
    version: entry.version,
  } : null;
}

function firstPathSegment(path: string): string {
  return path.split("/").filter(Boolean)[0] ?? "";
}

function assertPolicyAllowsEntry(policy: StoredProjectUrlPolicy, entityType: ProjectUrlEntryDto["entityType"], path: string): void {
  if (!policy.pathTemplates.some((item) => item.entityType === entityType)) {
    throw new ProjectStateError("PROJECT_URL_REFERENCE_INVALID");
  }
  if (policy.reservedNamespaces.includes(firstPathSegment(path))) {
    throw new ProjectStateError("PROJECT_URL_PATH_RESERVED");
  }
}

export function createProjectUrlRegistryCommands(dependencies: {
  createRepository(transaction: DatabaseTransaction): ProjectUrlRegistryRepository;
}) {
  const replaceProjectUrlPolicy = defineCommand({
    name: "project-state.url-policy.replace",
    input: replaceProjectUrlPolicyInputSchema,
    authorize: (principal: PrincipalContext) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      if (!await repository.projectExists(input.organizationId, input.projectId)) {
        throw new ProjectStateError("PROJECT_URL_REFERENCE_INVALID");
      }
      const previous = await repository.findPolicy(input.organizationId, input.projectId);
      if ((previous?.version ?? 0) !== input.version) throw new ProjectStateError("PROJECT_URL_STALE");
      if (previous && await repository.hasEntries(input.organizationId, input.projectId)) {
        throw new ProjectStateError("PROJECT_URL_POLICY_IN_USE");
      }
      const version = await repository.replacePolicy(input);
      if (!version) throw new ProjectStateError("PROJECT_URL_STALE");
      await repository.appendAudit({
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        action: "url-policy.replace",
        entityId: input.projectId,
        beforeMarker: previous ? { templateCount: previous.pathTemplates.length, namespaceCount: previous.reservedNamespaces.length, version: previous.version } : null,
        afterMarker: { templateCount: input.pathTemplates.length, namespaceCount: input.reservedNamespaces.length, version },
      });
      return { projectId: input.projectId, version };
    },
  });

  const createProjectUrlEntry = defineCommand({
    name: "project-state.url-entry.create",
    input: createProjectUrlEntryInputSchema,
    authorize: (principal: PrincipalContext) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const policy = await repository.findPolicy(input.organizationId, input.projectId);
      if (!policy) throw new ProjectStateError("PROJECT_URL_POLICY_REQUIRED");
      assertPolicyAllowsEntry(policy, input.entityType, input.canonicalPath);
      if (await repository.pathIsReserved(input.organizationId, input.projectId, input.canonicalPath)) {
        throw new ProjectStateError("PROJECT_URL_PATH_CONFLICT");
      }
      const entry = await repository.createEntry(input, createPublicUrlId());
      await repository.appendAudit({
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        action: "url-entry.create",
        entityId: entry.urlEntryId,
        beforeMarker: null,
        afterMarker: entryMarker(entry)!,
      });
      return entry;
    },
  });

  const publishProjectUrlEntry = defineCommand({
    name: "project-state.url-entry.publish",
    input: publishProjectUrlEntryInputSchema,
    authorize: (principal: PrincipalContext) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const previous = await repository.findEntry(input);
      if (!previous) throw new ProjectStateError("PROJECT_URL_ENTRY_NOT_FOUND");
      if (previous.version !== input.version || previous.publishedAt) throw new ProjectStateError("PROJECT_URL_STALE");
      const entry = await repository.publishEntry(input, input.version);
      if (!entry) throw new ProjectStateError("PROJECT_URL_STALE");
      await repository.appendAudit({
        organizationId: input.organizationId, projectId: input.projectId, actorId: actor.userId, correlationId: actor.correlationId,
        action: "url-entry.publish", entityId: entry.urlEntryId, beforeMarker: entryMarker(previous), afterMarker: entryMarker(entry)!,
      });
      return entry;
    },
  });

  const changeProjectUrlPath = defineCommand({
    name: "project-state.url-entry.path-change",
    input: changeProjectUrlPathInputSchema,
    authorize: (principal: PrincipalContext) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const previous = await repository.findEntry(input);
      if (!previous) throw new ProjectStateError("PROJECT_URL_ENTRY_NOT_FOUND");
      if (previous.version !== input.version || previous.presentationLifecycle === "GONE") throw new ProjectStateError("PROJECT_URL_STALE");
      const policy = await repository.findPolicy(input.organizationId, input.projectId);
      if (!policy) throw new ProjectStateError("PROJECT_URL_POLICY_REQUIRED");
      assertPolicyAllowsEntry(policy, previous.entityType, input.canonicalPath);
      if (input.canonicalPath === previous.canonicalPath || await repository.pathIsReserved(input.organizationId, input.projectId, input.canonicalPath, input.urlEntryId)) {
        throw new ProjectStateError("PROJECT_URL_PATH_CONFLICT");
      }
      const entry = await repository.changePath(input);
      if (!entry) throw new ProjectStateError("PROJECT_URL_STALE");
      await repository.appendAudit({
        organizationId: input.organizationId, projectId: input.projectId, actorId: actor.userId, correlationId: actor.correlationId,
        action: "url-entry.path-change", entityId: entry.urlEntryId,
        beforeMarker: { ...entryMarker(previous)!, pathChanged: false }, afterMarker: { ...entryMarker(entry)!, pathChanged: true, redirectCreated: previous.publishedAt !== null },
      });
      return entry;
    },
  });

  const relinkProjectUrlEntry = defineCommand({
    name: "project-state.url-entry.relink",
    input: relinkProjectUrlEntryInputSchema,
    authorize: (principal: PrincipalContext) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const previous = await repository.findEntry(input);
      if (!previous) throw new ProjectStateError("PROJECT_URL_ENTRY_NOT_FOUND");
      if (previous.version !== input.version || previous.presentationLifecycle === "GONE") throw new ProjectStateError("PROJECT_URL_STALE");
      const entry = await repository.relinkEntry(input);
      if (!entry) throw new ProjectStateError("PROJECT_URL_STALE");
      if (entry.publicUrlId !== previous.publicUrlId) throw new ProjectStateError("PROJECT_URL_REFERENCE_INVALID");
      await repository.appendAudit({
        organizationId: input.organizationId, projectId: input.projectId, actorId: actor.userId, correlationId: actor.correlationId,
        action: "url-entry.relink", entityId: entry.urlEntryId,
        beforeMarker: { ...entryMarker(previous)!, entityChanged: false }, afterMarker: { ...entryMarker(entry)!, entityChanged: true, publicUrlIdPreserved: true },
      });
      return entry;
    },
  });

  const transitionProjectUrlLifecycle = defineCommand({
    name: "project-state.url-entry.lifecycle",
    input: transitionProjectUrlLifecycleInputSchema,
    authorize: (principal: PrincipalContext) => { requireProjectStateAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireProjectStateAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const previous = await repository.findEntry(input);
      if (!previous) throw new ProjectStateError("PROJECT_URL_ENTRY_NOT_FOUND");
      if (previous.version !== input.version || previous.presentationLifecycle === "GONE") throw new ProjectStateError("PROJECT_URL_STALE");
      if (input.presentationLifecycle === "REDIRECTED") {
        const entries = await repository.listEntries(input.organizationId, input.projectId);
        const target = entries.find((entry) => entry.urlEntryId !== input.urlEntryId && entry.canonicalPath === input.redirectTargetPath && entry.presentationLifecycle !== "GONE");
        if (!target) throw new ProjectStateError("PROJECT_URL_REDIRECT_TARGET_INVALID");
      }
      const entry = await repository.transitionLifecycle(input);
      if (!entry) throw new ProjectStateError("PROJECT_URL_STALE");
      await repository.appendAudit({
        organizationId: input.organizationId, projectId: input.projectId, actorId: actor.userId, correlationId: actor.correlationId,
        action: "url-entry.lifecycle", entityId: entry.urlEntryId, beforeMarker: entryMarker(previous), afterMarker: entryMarker(entry)!,
      });
      return entry;
    },
  });

  return {
    replaceProjectUrlPolicy,
    createProjectUrlEntry,
    publishProjectUrlEntry,
    changeProjectUrlPath,
    relinkProjectUrlEntry,
    transitionProjectUrlLifecycle,
  };
}
