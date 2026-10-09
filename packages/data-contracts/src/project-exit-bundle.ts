import { z } from "zod";

export const dataModeSchema = z.enum(["hub", "local"]);
export type DataMode = z.infer<typeof dataModeSchema>;

export const agentPublicV1Schema = z.object({
  schemaMajor: z.literal(1),
  schemaMinor: z.number().int().nonnegative(),
  uid: z.string().trim().min(1).max(64),
  slug: z.string().trim().min(1).max(200),
  role: z.enum(["AGENT", "LAWYER", "MORTGAGE_BROKER", "MANAGER", "OTHER"]),
  fullName: z.string().trim().min(2).max(240),
  position: z.string().trim().max(240).nullable(),
  bio: z.string().trim().max(4000).nullable(),
  specializations: z.array(z.string().trim().min(1).max(120)).max(20),
  photoUrl: z.url({ protocol: /^https$/ }).nullable(),
  workPhone: z.string().trim().max(40).nullable(),
  workEmail: z.email().nullable(),
  messengers: z.array(z.url({ protocol: /^https$/ })).max(10),
  sortOrder: z.number().int().min(0).max(100000),
}).strict();

export type AgentPublicV1 = z.infer<typeof agentPublicV1Schema>;

export const PROJECT_EXIT_DATASET_KINDS = [
  "geo", "developers", "developments", "buildings", "prices", "media",
  "inventory", "agents", "project/contacts", "editorial", "urls", "redirects",
  "lifecycle",
] as const;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const relativePath = z.string().min(1).max(512).refine((value) => !value.startsWith("/") && !value.includes("..") && !value.includes("\\"), "Bundle path must be safe and relative");
const artifact = z.object({ path: relativePath, sha256, bytes: z.number().int().nonnegative() }).strict();

export const projectExitBundleV1Schema = z.object({
  schemaMajor: z.literal(1),
  schemaMinor: z.number().int().nonnegative(),
  projectId: z.string().trim().min(1).max(240),
  generatedAt: z.iso.datetime({ offset: true }),
  dataMode: z.literal("local"),
  publicOnly: z.literal(true),
  datasets: z.array(artifact.extend({ kind: z.enum(PROJECT_EXIT_DATASET_KINDS), count: z.number().int().nonnegative() }).strict())
    .length(PROJECT_EXIT_DATASET_KINDS.length)
    .refine((items) => new Set(items.map((item) => item.kind)).size === PROJECT_EXIT_DATASET_KINDS.length, "Every dataset kind must appear exactly once"),
  mediaManifest: artifact,
  vendoredContracts: z.array(artifact).min(1),
  documents: z.object({
    handoff: artifact,
    dataSchema: artifact,
    operations: artifact,
  }).strict(),
  protectedConsentEvidenceIncluded: z.literal(false),
  requiresAmsHubRuntime: z.literal(false),
  requiresAmsStorageRuntime: z.literal(false),
}).strict();

export type ProjectExitBundleV1 = z.infer<typeof projectExitBundleV1Schema>;

export function parseDataMode(value: unknown): DataMode {
  return dataModeSchema.parse(value);
}
