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

export const projectUrlPathSchema = z.string().trim().min(1).max(1024).refine(
  (value) => value.startsWith("/") && !value.includes("//") && !/[?#\\\\]/u.test(value),
  "Укажите абсолютный путь без query, hash, backslash и двойных slash",
);
export const projectUrlSlugSchema = z.string().trim().min(1).max(200).refine(
  (value) => !/[/?#\\\\]/u.test(value),
  "Slug должен быть одним безопасным сегментом пути",
);
export const factualLifecycleStatusSchema = z.enum(["ACTIVE", "INACTIVE", "ARCHIVED", "DEPARTED"]);
export const presentationLifecycleStatusSchema = z.enum(["VISIBLE", "ARCHIVED_VISIBLE", "REDIRECTED", "GONE"]);
export const projectRedirectReasonSchema = z.enum(["SLUG_CHANGE", "RELINK", "RETIRE", "LIFECYCLE", "MANUAL"]);

export const replaceProjectUrlPolicyInputSchema = projectPublicContactQuerySchema.extend({
  version: z.number().int().nonnegative(),
  policyKey: identifierSchema,
  pathTemplates: z.array(z.object({
    entityType: projectEditorialEntityTypeSchema,
    template: z.string().trim().min(1).max(512),
  }).strict()).min(1).max(20).refine(
    (items) => new Set(items.map((item) => item.entityType)).size === items.length,
    "Для типа сущности допустим один шаблон",
  ),
  reservedNamespaces: z.array(projectUrlSlugSchema).max(100).default([]).refine(
    (items) => new Set(items).size === items.length,
    "Зарезервированные namespace не должны повторяться",
  ),
}).strict();

export const projectUrlEntryKeySchema = projectPublicContactQuerySchema.extend({
  urlEntryId: identifierSchema,
}).strict();

export const createProjectUrlEntryInputSchema = projectEditorialKeySchema.extend({
  slug: projectUrlSlugSchema,
  canonicalPath: projectUrlPathSchema,
}).strict();

export const publishProjectUrlEntryInputSchema = projectUrlEntryKeySchema.extend({
  version: z.number().int().positive(),
}).strict();

export const changeProjectUrlPathInputSchema = publishProjectUrlEntryInputSchema.extend({
  slug: projectUrlSlugSchema,
  canonicalPath: projectUrlPathSchema,
}).strict();

export const relinkProjectUrlEntryInputSchema = publishProjectUrlEntryInputSchema.extend({
  entityType: projectEditorialEntityTypeSchema,
  entityUid: ulidSchema,
}).strict();

export const transitionProjectUrlLifecycleInputSchema = publishProjectUrlEntryInputSchema.extend({
  factualLifecycle: factualLifecycleStatusSchema,
  presentationLifecycle: presentationLifecycleStatusSchema,
  redirectTargetPath: projectUrlPathSchema.nullable().default(null),
  reason: projectRedirectReasonSchema,
}).strict().superRefine((value, context) => {
  if ((value.presentationLifecycle === "REDIRECTED") !== (value.redirectTargetPath !== null)) {
    context.addIssue({ code: "custom", path: ["redirectTargetPath"], message: "REDIRECTED требует целевой путь; другие состояния запрещают его" });
  }
});

export type ReplaceProjectUrlPolicyInput = z.infer<typeof replaceProjectUrlPolicyInputSchema>;
export type CreateProjectUrlEntryInput = z.infer<typeof createProjectUrlEntryInputSchema>;
export type ProjectUrlEntryKey = z.infer<typeof projectUrlEntryKeySchema>;
export type PublishProjectUrlEntryInput = z.infer<typeof publishProjectUrlEntryInputSchema>;
export type ChangeProjectUrlPathInput = z.infer<typeof changeProjectUrlPathInputSchema>;
export type RelinkProjectUrlEntryInput = z.infer<typeof relinkProjectUrlEntryInputSchema>;
export type TransitionProjectUrlLifecycleInput = z.infer<typeof transitionProjectUrlLifecycleInputSchema>;

export interface ProjectUrlEntryDto {
  urlEntryId: string;
  entityType: z.infer<typeof projectEditorialEntityTypeSchema>;
  entityUid: string;
  publicUrlId: string;
  slug: string;
  canonicalPath: string;
  factualLifecycle: z.infer<typeof factualLifecycleStatusSchema>;
  presentationLifecycle: z.infer<typeof presentationLifecycleStatusSchema>;
  redirectTargetPath: string | null;
  version: number;
  publishedAt: Date | null;
  retiredAt: Date | null;
}

export interface ProjectRedirectDto {
  fromPath: string;
  toPath: string;
  code: 301;
  reason: z.infer<typeof projectRedirectReasonSchema>;
  createdAt: Date;
}

export const listingDevelopmentLinkStatusSchema = z.enum(["CANDIDATE", "CONFIRMED", "REJECTED"]);

export const createListingDevelopmentCandidateInputSchema = projectPublicContactQuerySchema.extend({
  inventoryUid: ulidSchema,
  developmentUid: ulidSchema.nullable().default(null),
  candidateReason: z.string().trim().min(1).max(500),
  candidateConfidence: z.number().min(0).max(1).nullable().default(null),
  sourceRevisionId: identifierSchema.nullable().default(null),
}).strict();

export const decideListingDevelopmentLinkInputSchema = projectPublicContactQuerySchema.extend({
  linkId: identifierSchema,
  version: z.number().int().positive(),
  decision: z.enum(["CONFIRMED", "REJECTED"]),
}).strict();

export type CreateListingDevelopmentCandidateInput = z.infer<typeof createListingDevelopmentCandidateInputSchema>;
export type DecideListingDevelopmentLinkInput = z.infer<typeof decideListingDevelopmentLinkInputSchema>;
