import { ulidSchema } from "@ams-data-hub/data-contracts";
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

export const projectEditorialEntityTypeSchema = z.enum(["DEVELOPER", "DEVELOPMENT", "BUILDING", "INVENTORY", "AGENT"]);
const plainEditorialText = (maximum: number) => z.string().trim().max(maximum).refine(
  (value) => !/<\/?[a-z][^>]*>/iu.test(value),
  "HTML-разметка запрещена",
);
export const editorialFaqItemSchema = z.object({
  question: plainEditorialText(300).min(1),
  answer: plainEditorialText(1200).min(1),
}).strict();
const mediaOrderSchema = z.array(z.string().trim().min(1).max(128)).max(100).refine(
  (items) => new Set(items).size === items.length,
  "Медиа не должны повторяться",
);

export const projectEditorialKeySchema = projectPublicContactQuerySchema.extend({
  entityType: projectEditorialEntityTypeSchema,
  entityUid: ulidSchema,
}).strict();

export const replaceEntityEditorialInputSchema = projectEditorialKeySchema.extend({
  version: z.number().int().nonnegative(),
  shortDescription: plainEditorialText(500).default(""),
  description: plainEditorialText(4000).default(""),
  faq: z.array(editorialFaqItemSchema).max(20).default([]),
  presentationNotes: plainEditorialText(2000).default(""),
  mediaOrder: mediaOrderSchema.default([]),
}).strict();

export const replaceEntityMediaOrderPolicyInputSchema = projectEditorialKeySchema.extend({
  version: z.number().int().nonnegative(),
  sourceMediaOrder: mediaOrderSchema.default([]),
  isImageOrderChangeAllowed: z.boolean(),
}).strict();

export type ProjectEditorialKey = z.infer<typeof projectEditorialKeySchema>;
export type ReplaceEntityEditorialInput = z.infer<typeof replaceEntityEditorialInputSchema>;
export type ReplaceEntityMediaOrderPolicyInput = z.infer<typeof replaceEntityMediaOrderPolicyInputSchema>;
export type EditorialFaqItem = z.infer<typeof editorialFaqItemSchema>;

export interface ProjectEditorialPublicDto {
  entityType: z.infer<typeof projectEditorialEntityTypeSchema>;
  entityUid: string;
  shortDescription: string | null;
  description: string | null;
  faq: EditorialFaqItem[];
  mediaOrder: string[];
  isImageOrderChangeAllowed: boolean;
}

export const projectEditorialPublicDtoSchema = z.object({
  entityType: projectEditorialEntityTypeSchema,
  entityUid: projectEditorialKeySchema.shape.entityUid,
  shortDescription: plainEditorialText(500).nullable(),
  description: plainEditorialText(4000).nullable(),
  faq: z.array(editorialFaqItemSchema).max(20),
  mediaOrder: mediaOrderSchema,
  isImageOrderChangeAllowed: z.boolean(),
}).strict();
