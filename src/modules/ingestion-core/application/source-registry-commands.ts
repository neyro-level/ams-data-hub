import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { defineCommand } from "../../../platform/commands/define-command.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  createSourceInputSchema,
  requestManualSourceRunInputSchema,
  setSourceEnabledInputSchema,
  updateSourceInputSchema,
} from "../contracts.ts";
import type { AdapterProfileRegistry } from "../domain/adapter-profile-registry.ts";
import { SourceRegistryError } from "../domain/source-registry-error.ts";
import type { SourceRegistryRepository, StoredSource } from "./ports/source-registry-repository.ts";
import { requireSourceRegistryAdmin } from "./source-registry-authorization.ts";

function sourceMarker(source: StoredSource) {
  return {
    datasetType: source.datasetType,
    transportType: source.transportType,
    sharingPolicy: source.sharingPolicy,
    scheduleMode: source.schedulePolicy.mode,
    enabled: source.enabled,
    hasSafetyPolicy: source.safetyPolicyId !== null,
    hasExpectedNamespace: source.expectedNamespace !== null,
    hasExpectedProducer: source.expectedProducer !== null,
    credentialConfigured: true,
    version: source.version,
  };
}

export function createSourceRegistryCommands(dependencies: {
  createRepository(transaction: DatabaseTransaction): SourceRegistryRepository;
  adapterProfileRegistry: AdapterProfileRegistry;
}) {
  const createSource = defineCommand({
    name: "ingestion-core.source.create",
    input: createSourceInputSchema,
    authorize: (principal: PrincipalContext) => { requireSourceRegistryAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireSourceRegistryAdmin(principal);
      dependencies.adapterProfileRegistry.assertCompatible(input);
      const repository = dependencies.createRepository(transaction);
      if (!await repository.projectExists(input.organizationId, input.projectId)) {
        throw new SourceRegistryError("SOURCE_REGISTRY_REFERENCE_INVALID");
      }
      const source = await repository.createSource(input);
      await repository.appendAudit({
        organizationId: input.organizationId,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        action: "source.create",
        sourceId: source.sourceId,
        beforeMarker: null,
        afterMarker: sourceMarker(source),
      });
      return { sourceId: source.sourceId, version: source.version };
    },
  });

  const updateSource = defineCommand({
    name: "ingestion-core.source.update",
    input: updateSourceInputSchema,
    authorize: (principal: PrincipalContext) => { requireSourceRegistryAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireSourceRegistryAdmin(principal);
      dependencies.adapterProfileRegistry.assertCompatible({ ...input, transportType: "HTTPS_XML" });
      const repository = dependencies.createRepository(transaction);
      const previous = await repository.findSource(input);
      if (!previous) throw new SourceRegistryError("SOURCE_REGISTRY_NOT_FOUND");
      if (previous.version !== input.version) throw new SourceRegistryError("SOURCE_REGISTRY_STALE");
      const source = await repository.updateSource(input);
      if (!source) throw new SourceRegistryError("SOURCE_REGISTRY_STALE");
      await repository.appendAudit({
        organizationId: input.organizationId,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        action: "source.update",
        sourceId: source.sourceId,
        beforeMarker: sourceMarker(previous),
        afterMarker: { ...sourceMarker(source), credentialRotated: input.endpointCredentialRef !== undefined },
      });
      return { sourceId: source.sourceId, version: source.version };
    },
  });

  const setSourceEnabled = defineCommand({
    name: "ingestion-core.source.enabled.set",
    input: setSourceEnabledInputSchema,
    authorize: (principal: PrincipalContext) => { requireSourceRegistryAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireSourceRegistryAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const previous = await repository.findSource(input);
      if (!previous) throw new SourceRegistryError("SOURCE_REGISTRY_NOT_FOUND");
      if (previous.version !== input.version) throw new SourceRegistryError("SOURCE_REGISTRY_STALE");
      const source = await repository.setEnabled(input);
      if (!source) throw new SourceRegistryError("SOURCE_REGISTRY_STALE");
      await repository.appendAudit({
        organizationId: input.organizationId,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        action: "source.enabled.set",
        sourceId: source.sourceId,
        beforeMarker: { enabled: previous.enabled, version: previous.version },
        afterMarker: { enabled: source.enabled, version: source.version },
      });
      return { sourceId: source.sourceId, enabled: source.enabled, version: source.version };
    },
  });

  const requestManualSourceRun = defineCommand({
    name: "ingestion-core.source.manual-run.request",
    input: requestManualSourceRunInputSchema,
    authorize: (principal: PrincipalContext) => { requireSourceRegistryAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireSourceRegistryAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const source = await repository.findSource(input);
      if (!source) throw new SourceRegistryError("SOURCE_REGISTRY_NOT_FOUND");
      const result = await repository.requestManualRun(input, actor.userId);
      if (!result.duplicate) {
        await repository.appendAudit({
          organizationId: input.organizationId,
          actorId: actor.userId,
          correlationId: actor.correlationId,
          action: "source.manual-run.request",
          sourceId: source.sourceId,
          beforeMarker: { pendingManualRuns: source.pendingManualRuns },
          afterMarker: { pendingManualRuns: source.pendingManualRuns + 1, sourceEnabled: source.enabled },
        });
      }
      return result;
    },
  });

  return { createSource, updateSource, setSourceEnabled, requestManualSourceRun };
}
