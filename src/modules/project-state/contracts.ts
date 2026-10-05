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
export const agentRoleSchema = z.enum(["AGENT", "LAWYER", "MORTGAGE_BROKER", "MANAGER", "OTHER"]);
export const agentOriginSchema = z.enum(["FEED", "MANUAL"]);
export const agentStatusSchema = z.enum(["ACTIVE", "HIDDEN", "DEPARTED"]);
export const agentListingPresenceStatusSchema = z.enum(["HAS_ACTIVE_LISTINGS", "NO_ACTIVE_LISTINGS", "UNKNOWN"]);
const agentSlugSchema = z.string().trim().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Используйте латиницу, цифры и дефис");
const agentSpecializationsSchema = z.array(z.string().trim().min(1).max(120)).max(20).refine(
  (items) => new Set(items.map((item) => item.toLocaleLowerCase("ru-RU"))).size === items.length,
  "Специализации не должны повторяться",
);
const agentMessengersSchema = z.array(z.url({ protocol: /^https?$/ })).max(10);

export const saveManualAgentInputSchema = projectPublicContactQuerySchema.extend({
  agentUid: ulidSchema.optional(),
  version: z.number().int().nonnegative(),
  origin: agentOriginSchema.default("MANUAL"),
  slug: agentSlugSchema,
  role: agentRoleSchema,
  fullName: z.string().trim().min(2).max(240),
  position: optionalText(240),
  bio: plainEditorialText(4000).default(""),
  specializations: agentSpecializationsSchema.default([]),
  photoMediaId: identifierSchema.nullable().default(null),
  workPhone: optionalText(40),
  workEmail: z.union([z.literal(""), z.email()]).default(""),
  messengers: agentMessengersSchema.default([]),
  showOnSite: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(100000).default(0),
  status: agentStatusSchema.default("ACTIVE"),
  listingPresenceStatus: agentListingPresenceStatusSchema.default("UNKNOWN"),
}).strict();

export const mergeAgentsInputSchema = projectPublicContactQuerySchema.extend({
  sourceAgentUid: ulidSchema,
  sourceVersion: z.number().int().positive(),
  targetAgentUid: ulidSchema,
  targetVersion: z.number().int().positive(),
}).strict().refine((value) => value.sourceAgentUid !== value.targetAgentUid, {
  message: "Нельзя объединить агента с самим собой",
  path: ["targetAgentUid"],
});

export const relinkAgentIdentityInputSchema = projectPublicContactQuerySchema.extend({
  externalIdentityId: identifierSchema,
  sourceAgentUid: ulidSchema,
  targetAgentUid: ulidSchema,
  targetVersion: z.number().int().positive(),
}).strict().refine((value) => value.sourceAgentUid !== value.targetAgentUid, {
  message: "Выберите другого агента",
  path: ["targetAgentUid"],
});

export const splitAgentIdentityInputSchema = projectPublicContactQuerySchema.extend({
  externalIdentityId: identifierSchema,
  sourceAgentUid: ulidSchema,
  sourceVersion: z.number().int().positive(),
  newAgentSlug: agentSlugSchema,
  newAgentFullName: z.string().trim().min(2).max(240),
}).strict();

export const bulkAgentVisibilityInputSchema = projectPublicContactQuerySchema.extend({
  agentUids: z.array(ulidSchema).min(1).max(1000).refine((items) => new Set(items).size === items.length, "Агенты не должны повторяться"),
  showOnSite: z.boolean(),
}).strict();

export const confirmAgentConsentBatchInputSchema = projectPublicContactQuerySchema.extend({
  agentUids: z.array(ulidSchema).min(1).max(1000).refine((items) => new Set(items).size === items.length, "Агенты не должны повторяться"),
  confirmedBy: z.string().trim().min(2).max(240),
  confirmedAt: z.iso.datetime({ offset: true }),
  basis: z.string().trim().min(1).max(1000),
  referenceUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]).default(""),
  note: plainEditorialText(2000).default(""),
  confirmSuspicious: z.boolean().default(false),
}).strict();

export type SaveManualAgentInput = z.infer<typeof saveManualAgentInputSchema>;
export type MergeAgentsInput = z.infer<typeof mergeAgentsInputSchema>;
export type RelinkAgentIdentityInput = z.infer<typeof relinkAgentIdentityInputSchema>;
export type SplitAgentIdentityInput = z.infer<typeof splitAgentIdentityInputSchema>;
export type BulkAgentVisibilityInput = z.infer<typeof bulkAgentVisibilityInputSchema>;
export type ConfirmAgentConsentBatchInput = z.infer<typeof confirmAgentConsentBatchInputSchema>;

export interface AgentAdminItem {
  uid: string;
  organizationId: string;
  projectId: string;
  slug: string;
  role: z.infer<typeof agentRoleSchema>;
  origin: z.infer<typeof agentOriginSchema>;
  fullName: string;
  position: string | null;
  bio: string | null;
  specializations: string[];
  photoMediaId: string | null;
  workPhone: string | null;
  workEmail: string | null;
  messengers: string[];
  showOnSite: boolean;
  sortOrder: number;
  status: z.infer<typeof agentStatusSchema>;
  listingPresenceStatus: z.infer<typeof agentListingPresenceStatusSchema>;
  consentConfirmedBy: string | null;
  consentConfirmedAt: Date | null;
  consentBasis: string | null;
  consentBatchId: string | null;
  isPubliclyPublishable: boolean;
  version: number;
}

export interface AgentMediaOption {
  id: string;
  projectId: string;
  originalFileName: string;
}

export type AgentBulkMutationResult =
  | { state: "APPLIED"; affected: number; total: number }
  | { state: "SUSPICIOUS"; affected: number; total: number; thresholdPercent: 30 };

export type AgentConsentBatchResult =
  | { state: "APPLIED"; affected: number; total: number; batchId: string }
  | { state: "SUSPICIOUS"; affected: number; total: number; thresholdPercent: 30 };
