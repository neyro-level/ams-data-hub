import { ulidSchema } from "@ams-data-hub/data-contracts";
import { z } from "zod";

export const catalogLifecycleStatusSchema = z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]);

export const catalogAliasSchema = z.object({
  value: z.string().trim().min(1).max(160),
  normalizedValue: z.string().trim().min(1).max(160),
}).strict();

const catalogGeoBaseSchema = z.object({
  uid: ulidSchema,
  name: z.string().trim().min(1).max(160),
  normalizedName: z.string().trim().min(1).max(160),
  lifecycle: catalogLifecycleStatusSchema,
  aliases: z.array(catalogAliasSchema),
}).strict();

export const catalogRegionSchema = catalogGeoBaseSchema.extend({
  code: z.string().regex(/^RU-[A-Z]{2,3}$/),
}).strict();

export const catalogCitySchema = catalogGeoBaseSchema.extend({
  regionUid: ulidSchema,
}).strict();

export const catalogDistrictSchema = catalogGeoBaseSchema.extend({
  cityUid: ulidSchema,
}).strict();

export type CatalogLifecycleStatus = z.infer<typeof catalogLifecycleStatusSchema>;
export type CatalogAlias = z.infer<typeof catalogAliasSchema>;
export type CatalogRegion = z.infer<typeof catalogRegionSchema>;
export type CatalogCity = z.infer<typeof catalogCitySchema>;
export type CatalogDistrict = z.infer<typeof catalogDistrictSchema>;
