import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);
const registryKeySchema = z.string().trim().regex(/^[a-z][a-z0-9-]{1,127}$/u);
const versionTagSchema = z.string().trim().min(1).max(64);
const optionalText = (maximum: number) => z.string().trim().max(maximum).default("");
export const endpointCredentialRefNameSchema = z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,127}$/u);

export const sourceDatasetTypeSchema = z.enum(["MIXED_REALTY", "RESALE", "NEW_BUILD", "HOUSE", "LAND", "COMMERCIAL", "AGENT"]);
export const sourceSchedulePolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("MANUAL_ONLY") }).strict(),
  z.object({ mode: z.literal("SCHEDULED"), cadenceMinutes: z.number().int().min(5).max(10_080) }).strict(),
]);

export const sourceScopeSchema = z.object({
  organizationId: identifierSchema,
  projectId: identifierSchema,
}).strict();

export const sourceKeySchema = sourceScopeSchema.extend({ sourceId: identifierSchema }).strict();

export const createSourceInputSchema = sourceScopeSchema.extend({
  sourceKey: registryKeySchema,
  name: z.string().trim().min(1).max(200),
  endpointCredentialRef: endpointCredentialRefNameSchema,
  adapterKey: registryKeySchema,
  adapterVersion: versionTagSchema,
  profileKey: registryKeySchema,
  profileVersion: versionTagSchema,
  datasetType: sourceDatasetTypeSchema,
  transportType: z.literal("HTTPS_XML").default("HTTPS_XML"),
  sharingPolicy: z.literal("PROJECT_ONLY").default("PROJECT_ONLY"),
  schedulePolicy: sourceSchedulePolicySchema.default({ mode: "MANUAL_ONLY" }),
  safetyPolicyId: optionalText(128),
  expectedNamespace: optionalText(500),
  expectedProducer: optionalText(300),
}).strict();

export const updateSourceInputSchema = sourceKeySchema.extend({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  endpointCredentialRef: endpointCredentialRefNameSchema.optional(),
  adapterKey: registryKeySchema,
  adapterVersion: versionTagSchema,
  profileKey: registryKeySchema,
  profileVersion: versionTagSchema,
  datasetType: sourceDatasetTypeSchema,
  schedulePolicy: sourceSchedulePolicySchema,
  safetyPolicyId: optionalText(128),
  expectedNamespace: optionalText(500),
  expectedProducer: optionalText(300),
}).strict();

export const setSourceEnabledInputSchema = sourceKeySchema.extend({
  version: z.number().int().positive(),
  enabled: z.boolean(),
}).strict();

export const requestManualSourceRunInputSchema = sourceKeySchema.extend({
  idempotencyKey: z.string().trim().min(8).max(128),
}).strict();

export type SourceSchedulePolicy = z.infer<typeof sourceSchedulePolicySchema>;
export type SourceScope = z.infer<typeof sourceScopeSchema>;
export type SourceKey = z.infer<typeof sourceKeySchema>;
export type CreateSourceInput = z.infer<typeof createSourceInputSchema>;
export type UpdateSourceInput = z.infer<typeof updateSourceInputSchema>;
export type SetSourceEnabledInput = z.infer<typeof setSourceEnabledInputSchema>;
export type RequestManualSourceRunInput = z.infer<typeof requestManualSourceRunInputSchema>;

export interface SourceAdminDto {
  sourceId: string;
  organizationId: string;
  projectId: string;
  sourceKey: string;
  name: string;
  adapterKey: string;
  adapterVersion: string;
  profileKey: string;
  profileVersion: string;
  datasetType: z.infer<typeof sourceDatasetTypeSchema>;
  transportType: "HTTPS_XML";
  sharingPolicy: "PROJECT_ONLY";
  schedulePolicy: SourceSchedulePolicy;
  safetyPolicyId: string | null;
  enabled: boolean;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastGoodRevisionId: string | null;
  expectedNamespace: string | null;
  expectedProducer: string | null;
  credential: { configured: boolean; displayValue: "[REDACTED]" };
  pendingManualRuns: number;
  version: number;
  updatedAt: Date;
}

export interface SourceProjectOption {
  id: string;
  organizationId: string;
  name: string;
  organizationName: string;
}

export interface SourceAdminData {
  sources: SourceAdminDto[];
  projects: SourceProjectOption[];
}
