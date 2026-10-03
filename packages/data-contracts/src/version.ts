import { z } from "zod";

export const DATA_SCHEMA_MAJOR = 1 as const;
export const DATA_SCHEMA_MINOR = 0 as const;

export const dataSchemaVersionSchema = z.object({
  schemaMajor: z.literal(DATA_SCHEMA_MAJOR),
  schemaMinor: z.literal(DATA_SCHEMA_MINOR),
}).strict();

export function createVersionedContractSchema<TPayload extends z.ZodType>(payload: TPayload) {
  return dataSchemaVersionSchema.extend({ payload }).strict();
}
