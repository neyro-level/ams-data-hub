import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);
const optionalText = (maximum: number) => z.string().trim().max(maximum).default("");

export const projectPublicContactQuerySchema = z.object({
  organizationId: identifierSchema,
  projectId: identifierSchema,
}).strict();

export const replaceProjectPublicContactInputSchema = projectPublicContactQuerySchema.extend({
  version: z.number().int().nonnegative(),
  phone: z.string().trim().min(5).max(40),
  email: z.union([z.literal(""), z.email("Укажите корректный email")]).default(""),
  addressPublic: optionalText(500),
  messengers: z.array(z.url({ protocol: /^https?$/ })).max(10).default([]),
  hours: optionalText(500),
}).strict();

export type ProjectPublicContactQuery = z.infer<typeof projectPublicContactQuerySchema>;
export type ReplaceProjectPublicContactInput = z.infer<typeof replaceProjectPublicContactInputSchema>;

export interface ProjectPublicContactDto {
  phone: string;
  email: string | null;
  addressPublic: string | null;
  messengers: string[];
  hours: string | null;
}

export interface ProjectPublicContactAdminItem extends ProjectPublicContactDto {
  organizationId: string;
  projectId: string;
  version: number;
}
