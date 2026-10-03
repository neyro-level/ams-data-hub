export {
  catalogAliasSchema,
  catalogCitySchema,
  catalogDistrictSchema,
  catalogLifecycleStatusSchema,
  catalogRegionSchema,
  type CatalogAlias,
  type CatalogCity,
  type CatalogDistrict,
  type CatalogLifecycleStatus,
  type CatalogRegion,
} from "@ams-data-hub/realty-contracts";

import { ulidSchema } from "@ams-data-hub/data-contracts";
import { z } from "zod";

const nameSchema = z.string().trim().min(1).max(160);
const versionSchema = z.number().int().positive();
const aliasesSchema = z.array(nameSchema).max(50).default([]);

export const sharedCatalogLifecycleSchema = z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]);
export const constructionStatusSchema = z.enum([
  "PLANNED",
  "UNDER_CONSTRUCTION",
  "COMPLETED",
  "SUSPENDED",
]);

export const createDeveloperInputSchema = z.object({
  name: nameSchema,
  lifecycle: sharedCatalogLifecycleSchema.default("ACTIVE"),
  aliases: aliasesSchema,
}).strict();

export const updateDeveloperInputSchema = createDeveloperInputSchema.extend({
  uid: ulidSchema,
  version: versionSchema,
}).strict();

export const createDevelopmentInputSchema = z.object({
  developerUid: ulidSchema,
  cityUid: ulidSchema,
  districtUid: ulidSchema.nullish().transform((value) => value ?? null),
  name: nameSchema,
  lifecycle: sharedCatalogLifecycleSchema.default("ACTIVE"),
  aliases: aliasesSchema,
}).strict();

export const updateDevelopmentInputSchema = createDevelopmentInputSchema.extend({
  uid: ulidSchema,
  version: versionSchema,
}).strict();

export const createBuildingInputSchema = z.object({
  developmentUid: ulidSchema,
  label: nameSchema,
  floors: z.number().int().positive().max(200).nullish().transform((value) => value ?? null),
  commissioningYear: z.number().int().min(2000).max(2200).nullish().transform((value) => value ?? null),
  commissioningQuarter: z.number().int().min(1).max(4).nullish().transform((value) => value ?? null),
  constructionStatus: constructionStatusSchema.default("PLANNED"),
  material: z.string().trim().max(120).nullish().transform((value) => value || null),
  housingClass: z.string().trim().max(80).nullish().transform((value) => value || null),
  lifecycle: sharedCatalogLifecycleSchema.default("ACTIVE"),
  aliases: aliasesSchema,
}).strict();

export const updateBuildingInputSchema = createBuildingInputSchema.extend({
  uid: ulidSchema,
  version: versionSchema,
}).strict();

export const mergeSharedCatalogEntityInputSchema = z.object({
  entityType: z.enum(["DEVELOPER", "DEVELOPMENT", "BUILDING"]),
  sourceUid: ulidSchema,
  targetUid: ulidSchema,
  sourceVersion: versionSchema,
}).strict().refine((input) => input.sourceUid !== input.targetUid, {
  message: "Source and target must differ",
  path: ["targetUid"],
});

export const relinkSharedCatalogEntityInputSchema = z.discriminatedUnion("entityType", [
  z.object({
    entityType: z.literal("DEVELOPMENT"),
    uid: ulidSchema,
    version: versionSchema,
    developerUid: ulidSchema,
    cityUid: ulidSchema,
    districtUid: ulidSchema.nullish().transform((value) => value ?? null),
  }).strict(),
  z.object({
    entityType: z.literal("BUILDING"),
    uid: ulidSchema,
    version: versionSchema,
    developmentUid: ulidSchema,
  }).strict(),
]);

export type CreateDeveloperInput = z.infer<typeof createDeveloperInputSchema>;
export type UpdateDeveloperInput = z.infer<typeof updateDeveloperInputSchema>;
export type CreateDevelopmentInput = z.infer<typeof createDevelopmentInputSchema>;
export type UpdateDevelopmentInput = z.infer<typeof updateDevelopmentInputSchema>;
export type CreateBuildingInput = z.infer<typeof createBuildingInputSchema>;
export type UpdateBuildingInput = z.infer<typeof updateBuildingInputSchema>;
export type MergeSharedCatalogEntityInput = z.infer<typeof mergeSharedCatalogEntityInputSchema>;
export type RelinkSharedCatalogEntityInput = z.infer<typeof relinkSharedCatalogEntityInputSchema>;
