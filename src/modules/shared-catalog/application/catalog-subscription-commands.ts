import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { defineCommand } from "../../../platform/commands/define-command.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { replaceProjectCatalogSubscriptionInputSchema } from "../contracts.ts";
import { SharedCatalogError } from "../domain/shared-catalog-error.ts";
import type { CatalogSubscriptionRepository } from "./ports/catalog-subscription-repository.ts";
import { requireSharedCatalogAdmin } from "./shared-catalog-authorization.ts";

export interface CatalogSubscriptionCommandDependencies {
  createRepository(transaction: DatabaseTransaction): CatalogSubscriptionRepository;
}

export function createCatalogSubscriptionCommands(dependencies: CatalogSubscriptionCommandDependencies) {
  const replaceProjectSubscription = defineCommand({
    name: "shared-catalog.subscription.replace",
    input: replaceProjectCatalogSubscriptionInputSchema,
    authorize: (principal: PrincipalContext) => { requireSharedCatalogAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireSharedCatalogAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      if (!await repository.projectExists(input.organizationId, input.projectId)) {
        throw new SharedCatalogError("SHARED_CATALOG_REFERENCE_INVALID");
      }
      const previous = await repository.findSubscription(input.organizationId, input.projectId);
      if ((previous?.version ?? 0) !== input.version) {
        throw new SharedCatalogError("SHARED_CATALOG_SUBSCRIPTION_STALE");
      }
      const developmentUids = input.selections.map((selection) => selection.developmentUid);
      const [cityCount, developmentCount] = await Promise.all([
        repository.countCities(input.cityUids),
        repository.countDevelopments(developmentUids),
      ]);
      if (cityCount !== input.cityUids.length || developmentCount !== developmentUids.length) {
        throw new SharedCatalogError("SHARED_CATALOG_REFERENCE_INVALID");
      }
      const version = await repository.replaceSubscription(input);
      if (!version) throw new SharedCatalogError("SHARED_CATALOG_SUBSCRIPTION_STALE");
      await repository.appendAudit({
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        beforeMarker: previous,
        afterMarker: { mode: input.mode, version, cityUids: input.cityUids, selections: input.selections },
      });
      return { projectId: input.projectId, version };
    },
  });

  return { replaceProjectSubscription };
}
