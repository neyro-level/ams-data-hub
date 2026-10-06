import {
  DATA_SCHEMA_MAJOR,
  DATA_SCHEMA_MINOR,
  publicUrlIdSchema,
  ulidSchema,
} from "@ams-data-hub/data-contracts";
import { z } from "zod";

export const REALTY_SCHEMA_MAJOR = DATA_SCHEMA_MAJOR;
export const REALTY_SCHEMA_MINOR = DATA_SCHEMA_MINOR;

export const realtyEntityReferenceSchema = z.object({
  schemaMajor: z.literal(REALTY_SCHEMA_MAJOR),
  schemaMinor: z.literal(REALTY_SCHEMA_MINOR),
  uid: ulidSchema,
  publicUrlId: publicUrlIdSchema,
}).strict();

export type RealtyEntityReference = z.infer<typeof realtyEntityReferenceSchema>;

export * from "./catalog-geo.ts";
export * from "./inventory.ts";
export * from "./description-html-safe.ts";
export * from "./media-public.ts";
