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

export const createBuildingsBatchInputSchema = z.object({
  developmentUid: ulidSchema,
  labels: z.array(nameSchema).min(1).max(50),
  constructionStatus: constructionStatusSchema.default("PLANNED"),
  lifecycle: sharedCatalogLifecycleSchema.default("ACTIVE"),
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
export type CreateBuildingsBatchInput = z.infer<typeof createBuildingsBatchInputSchema>;
export type MergeSharedCatalogEntityInput = z.infer<typeof mergeSharedCatalogEntityInputSchema>;
export type RelinkSharedCatalogEntityInput = z.infer<typeof relinkSharedCatalogEntityInputSchema>;

const projectIdentifierSchema = z.string().trim().min(1).max(128);

export const catalogSubscriptionSelectionSchema = z.object({
  developmentUid: ulidSchema,
  decision: z.enum(["INCLUDE", "EXCLUDE"]),
}).strict();

export const replaceProjectCatalogSubscriptionInputSchema = z.object({
  organizationId: projectIdentifierSchema,
  projectId: projectIdentifierSchema,
  mode: z.enum(["ALL_SHARED", "CURATED"]),
  version: z.number().int().nonnegative(),
  cityUids: z.array(ulidSchema).max(100),
  selections: z.array(catalogSubscriptionSelectionSchema).max(500),
}).strict().superRefine((input, context) => {
  if (new Set(input.cityUids).size !== input.cityUids.length) {
    context.addIssue({ code: "custom", path: ["cityUids"], message: "Города не должны повторяться" });
  }
  const selectionUids = input.selections.map((selection) => selection.developmentUid);
  if (new Set(selectionUids).size !== selectionUids.length) {
    context.addIssue({ code: "custom", path: ["selections"], message: "ЖК не должны повторяться" });
  }
  if (input.mode === "ALL_SHARED" && input.cityUids.length === 0) {
    context.addIssue({ code: "custom", path: ["cityUids"], message: "Выберите хотя бы один город" });
  }
  if (input.mode === "ALL_SHARED" && input.selections.length > 0) {
    context.addIssue({ code: "custom", path: ["selections"], message: "Явный выбор ЖК доступен только в режиме CURATED" });
  }
  if (input.mode === "CURATED" && input.cityUids.length > 0) {
    context.addIssue({ code: "custom", path: ["cityUids"], message: "Города используются только в режиме ALL_SHARED" });
  }
  if (input.mode === "CURATED" && !input.selections.some((selection) => selection.decision === "INCLUDE")) {
    context.addIssue({ code: "custom", path: ["selections"], message: "Добавьте хотя бы один ЖК" });
  }
});

export const projectCatalogSelectionQuerySchema = z.object({
  organizationId: projectIdentifierSchema,
  projectId: projectIdentifierSchema,
}).strict();

export type ReplaceProjectCatalogSubscriptionInput = z.infer<typeof replaceProjectCatalogSubscriptionInputSchema>;
export type ProjectCatalogSelectionQuery = z.infer<typeof projectCatalogSelectionQuerySchema>;

export interface ProjectCatalogSnapshotSelection {
  organizationId: string;
  projectId: string;
  mode: "ALL_SHARED" | "CURATED";
  version: number;
  cityUids: string[];
  developments: Array<{
    uid: string;
    developerUid: string;
    cityUid: string;
    buildingUids: string[];
  }>;
}

export const catalogAdminQuerySchema = z.object({
  q: z.string().trim().max(160).default(""),
  lifecycle: z.enum(["ALL", "ACTIVE", "INACTIVE", "ARCHIVED"]).default("ALL"),
  regionUid: z.union([z.literal(""), ulidSchema]).default(""),
  cityUid: z.union([z.literal(""), ulidSchema]).default(""),
  developerUid: z.union([z.literal(""), ulidSchema]).default(""),
}).strict();

export type CatalogAdminQuery = z.infer<typeof catalogAdminQuerySchema>;

export interface CatalogAdminDeveloper {
  uid: string;
  name: string;
  lifecycle: z.infer<typeof sharedCatalogLifecycleSchema>;
  version: number;
  aliases: string[];
  developmentCount: number;
  updatedAt: string;
}

export interface CatalogAdminDevelopment {
  uid: string;
  developerUid: string;
  developerName: string;
  cityUid: string;
  cityName: string;
  districtUid: string | null;
  districtName: string | null;
  name: string;
  lifecycle: z.infer<typeof sharedCatalogLifecycleSchema>;
  version: number;
  aliases: string[];
  buildingCount: number;
  updatedAt: string;
}

export interface CatalogAdminBuilding {
  uid: string;
  developmentUid: string;
  developmentName: string;
  label: string;
  floors: number | null;
  commissioningYear: number | null;
  commissioningQuarter: number | null;
  constructionStatus: z.infer<typeof constructionStatusSchema>;
  material: string | null;
  housingClass: string | null;
  lifecycle: z.infer<typeof sharedCatalogLifecycleSchema>;
  version: number;
  aliases: string[];
  updatedAt: string;
}

export interface CatalogAdminData {
  developers: CatalogAdminDeveloper[];
  developments: CatalogAdminDevelopment[];
  buildings: CatalogAdminBuilding[];
  options: {
    developers: Array<{ uid: string; name: string }>;
    developments: Array<{ uid: string; name: string }>;
    regions: Array<{ uid: string; name: string }>;
    cities: Array<{ uid: string; regionUid: string; name: string }>;
    districts: Array<{ uid: string; cityUid: string; name: string }>;
  };
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseCatalogAdminQuery(
  input: Record<string, string | string[] | undefined>,
): CatalogAdminQuery {
  return catalogAdminQuerySchema.parse({
    q: firstQueryValue(input.q),
    lifecycle: firstQueryValue(input.lifecycle),
    regionUid: firstQueryValue(input.regionUid),
    cityUid: firstQueryValue(input.cityUid),
    developerUid: firstQueryValue(input.developerUid),
  });
}
