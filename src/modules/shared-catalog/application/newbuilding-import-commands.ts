import { createHash } from "node:crypto";
import { z } from "zod";
import { defineCommand } from "../../../platform/commands/define-command.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { newbuildingStagingPayloadSchema, planNewbuildingImport } from "../domain/newbuilding-import.ts";
import { SharedCatalogError } from "../domain/shared-catalog-error.ts";
import type { NewbuildingImportRepository } from "./ports/newbuilding-import-repository.ts";
import { requireSharedCatalogAdmin } from "./shared-catalog-authorization.ts";

const inputSchema = z.object({
  organizationId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  payload: newbuildingStagingPayloadSchema,
}).strict();

export function createNewbuildingImportCommands(dependencies: {
  createRepository(transaction: DatabaseTransaction): NewbuildingImportRepository;
}) {
  const preview = defineCommand({
    name: "shared-catalog.newbuilding.preview",
    input: inputSchema,
    authorize: (principal) => { requireSharedCatalogAdmin(principal); },
    execute: async ({ input, transaction }) => {
      const scope = { organizationId: input.organizationId, projectId: input.projectId };
      const state = await dependencies.createRepository(transaction).read(scope, input.payload);
      const plan = planNewbuildingImport(input.payload, state);
      const planSha256 = createHash("sha256").update(JSON.stringify({ scope: [input.organizationId, input.projectId], payload: input.payload, version: state.version, plan })).digest("hex");
      return { plan, planSha256 };
    },
  });
  const apply = defineCommand({
    name: "shared-catalog.newbuilding.apply",
    input: inputSchema.extend({ confirmed: z.literal(true), reviewedPlanSha256: z.string().regex(/^[0-9a-f]{64}$/) }),
    authorize: (principal) => { requireSharedCatalogAdmin(principal); },
    execute: async ({ principal, input, transaction }) => {
      const actor = requireSharedCatalogAdmin(principal);
      const repository = dependencies.createRepository(transaction);
      const scope = { organizationId: input.organizationId, projectId: input.projectId };
      const state = await repository.read(scope, input.payload);
      const plan = planNewbuildingImport(input.payload, state);
      const planSha256 = createHash("sha256").update(JSON.stringify({ scope: [input.organizationId, input.projectId], payload: input.payload, version: state.version, plan })).digest("hex");
      if (planSha256 !== input.reviewedPlanSha256) throw new SharedCatalogError("NEWBUILDING_REVIEW_STALE");
      const result = await repository.apply(scope, input.payload, state);
      await repository.appendAudit(scope, actor.userId, actor.correlationId, result);
      return result;
    },
  });
  return { preview, apply };
}
