import { createUlid } from "@ams-data-hub/data-contracts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { defineCommand } from "../../../platform/commands/define-command.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  createBuildingInputSchema,
  createDeveloperInputSchema,
  createDevelopmentInputSchema,
  mergeSharedCatalogEntityInputSchema,
  relinkSharedCatalogEntityInputSchema,
  updateBuildingInputSchema,
  updateDeveloperInputSchema,
  updateDevelopmentInputSchema,
} from "../contracts.ts";
import { normalizeGeoName } from "../domain/normalize-geo-name.ts";
import { SharedCatalogError } from "../domain/shared-catalog-error.ts";
import type { CatalogWriteResult, SharedCatalogRepository } from "./ports/shared-catalog-repository.ts";
import { requireSharedCatalogAdmin } from "./shared-catalog-authorization.ts";

export interface SharedCatalogCommandDependencies {
  createRepository(transaction: DatabaseTransaction): SharedCatalogRepository;
}

function normalizedAliases(aliases: string[]): string[] {
  return aliases.map(normalizeGeoName);
}

function requireResult(result: CatalogWriteResult | null): CatalogWriteResult {
  if (!result) throw new SharedCatalogError("SHARED_CATALOG_NOT_FOUND_OR_STALE");
  return result;
}

export function createSharedCatalogCommands(dependencies: SharedCatalogCommandDependencies) {
  const authorize = (principal: PrincipalContext) => {
    requireSharedCatalogAdmin(principal);
  };

  const createDeveloper = defineCommand({
    name: "shared-catalog.developer.create",
    input: createDeveloperInputSchema,
    authorize,
    execute: async ({ principal, input, transaction }) => {
      const actor = requireSharedCatalogAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const result = await repository.createDeveloper({
        ...input,
        uid: createUlid(),
        normalizedName: normalizeGeoName(input.name),
        normalizedAliases: normalizedAliases(input.aliases),
      });
      await repository.appendAudit({
        actorId: actor.userId, action: "developer.create", entityType: "Developer",
        entityId: result.uid, beforeMarker: null,
        afterMarker: { name: input.name, lifecycle: input.lifecycle, version: result.version },
        correlationId: actor.correlationId,
      });
      return result;
    },
  });

  const updateDeveloper = defineCommand({
    name: "shared-catalog.developer.update",
    input: updateDeveloperInputSchema,
    authorize,
    execute: async ({ principal, input, transaction }) => {
      const actor = requireSharedCatalogAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const result = requireResult(await repository.updateDeveloper({
        ...input,
        normalizedName: normalizeGeoName(input.name),
        normalizedAliases: normalizedAliases(input.aliases),
      }));
      await repository.appendAudit({
        actorId: actor.userId, action: "developer.update", entityType: "Developer",
        entityId: result.uid, beforeMarker: { version: input.version },
        afterMarker: { name: input.name, lifecycle: input.lifecycle, version: result.version },
        correlationId: actor.correlationId,
      });
      return result;
    },
  });

  const createDevelopment = defineCommand({
    name: "shared-catalog.development.create",
    input: createDevelopmentInputSchema,
    authorize,
    execute: async ({ principal, input, transaction }) => {
      const actor = requireSharedCatalogAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const result = await repository.createDevelopment({
        ...input,
        uid: createUlid(),
        normalizedName: normalizeGeoName(input.name),
        normalizedAliases: normalizedAliases(input.aliases),
      });
      await repository.appendAudit({
        actorId: actor.userId, action: "development.create", entityType: "Development",
        entityId: result.uid, beforeMarker: null,
        afterMarker: { name: input.name, developerUid: input.developerUid, cityUid: input.cityUid, version: result.version },
        correlationId: actor.correlationId,
      });
      return result;
    },
  });

  const updateDevelopment = defineCommand({
    name: "shared-catalog.development.update",
    input: updateDevelopmentInputSchema,
    authorize,
    execute: async ({ principal, input, transaction }) => {
      const actor = requireSharedCatalogAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const result = requireResult(await repository.updateDevelopment({
        ...input,
        normalizedName: normalizeGeoName(input.name),
        normalizedAliases: normalizedAliases(input.aliases),
      }));
      await repository.appendAudit({
        actorId: actor.userId, action: "development.update", entityType: "Development",
        entityId: result.uid, beforeMarker: { version: input.version },
        afterMarker: { name: input.name, developerUid: input.developerUid, cityUid: input.cityUid, version: result.version },
        correlationId: actor.correlationId,
      });
      return result;
    },
  });

  const createBuilding = defineCommand({
    name: "shared-catalog.building.create",
    input: createBuildingInputSchema,
    authorize,
    execute: async ({ principal, input, transaction }) => {
      const actor = requireSharedCatalogAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const result = await repository.createBuilding({
        ...input,
        uid: createUlid(),
        normalizedLabel: normalizeGeoName(input.label),
        normalizedAliases: normalizedAliases(input.aliases),
      });
      await repository.appendAudit({
        actorId: actor.userId, action: "building.create", entityType: "Building",
        entityId: result.uid, beforeMarker: null,
        afterMarker: { label: input.label, developmentUid: input.developmentUid, constructionStatus: input.constructionStatus, version: result.version },
        correlationId: actor.correlationId,
      });
      return result;
    },
  });

  const updateBuilding = defineCommand({
    name: "shared-catalog.building.update",
    input: updateBuildingInputSchema,
    authorize,
    execute: async ({ principal, input, transaction }) => {
      const actor = requireSharedCatalogAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const result = requireResult(await repository.updateBuilding({
        ...input,
        normalizedLabel: normalizeGeoName(input.label),
        normalizedAliases: normalizedAliases(input.aliases),
      }));
      await repository.appendAudit({
        actorId: actor.userId, action: "building.update", entityType: "Building",
        entityId: result.uid, beforeMarker: { version: input.version },
        afterMarker: { label: input.label, developmentUid: input.developmentUid, constructionStatus: input.constructionStatus, version: result.version },
        correlationId: actor.correlationId,
      });
      return result;
    },
  });

  const mergeEntity = defineCommand({
    name: "shared-catalog.entity.merge",
    input: mergeSharedCatalogEntityInputSchema,
    authorize,
    execute: async ({ principal, input, transaction }) => {
      const actor = requireSharedCatalogAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const result = requireResult(await repository.merge(input));
      await repository.appendAudit({
        actorId: actor.userId, action: `${input.entityType.toLowerCase()}.merge`,
        entityType: input.entityType, entityId: input.sourceUid,
        beforeMarker: { version: input.sourceVersion },
        afterMarker: { mergedIntoUid: input.targetUid, lifecycle: "ARCHIVED", version: result.version },
        correlationId: actor.correlationId,
      });
      return result;
    },
  });

  const relinkEntity = defineCommand({
    name: "shared-catalog.entity.relink",
    input: relinkSharedCatalogEntityInputSchema,
    authorize,
    execute: async ({ principal, input, transaction }) => {
      const actor = requireSharedCatalogAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const result = requireResult(await repository.relink(input));
      await repository.appendAudit({
        actorId: actor.userId, action: `${input.entityType.toLowerCase()}.relink`,
        entityType: input.entityType, entityId: input.uid,
        beforeMarker: { version: input.version },
        afterMarker: { version: result.version }, correlationId: actor.correlationId,
      });
      return result;
    },
  });

  return {
    createDeveloper, updateDeveloper,
    createDevelopment, updateDevelopment,
    createBuilding, updateBuilding,
    mergeEntity, relinkEntity,
  };
}
