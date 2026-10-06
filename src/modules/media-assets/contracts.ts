import { z } from "zod";
import type { MediaPublicV1 } from "@ams-data-hub/realty-contracts";

export const MEDIA_CONTENT_TYPES = [
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export const mediaRightsBasisSchema = z.enum(["OWNED", "LICENSED", "PUBLIC_DOMAIN"]);

export const mediaIntakeInputSchema = z.object({
  organizationId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  body: z.instanceof(Uint8Array).refine((body) => body.byteLength > 0, "Media file is empty").refine(
    (body) => body.byteLength <= MAX_MEDIA_BYTES,
    `Media file exceeds ${MAX_MEDIA_BYTES} bytes`,
  ),
  contentType: z.enum(MEDIA_CONTENT_TYPES),
  originalFileName: z.string().trim().min(1).max(255),
  rightsBasis: mediaRightsBasisSchema,
  source: z.string().trim().min(1).max(2048),
  license: z.string().trim().min(1).max(255).nullable().optional(),
}).superRefine((input, context) => {
  if (input.rightsBasis === "LICENSED" && !input.license) {
    context.addIssue({ code: "custom", path: ["license"], message: "Licensed media requires license metadata" });
  }
});

export type MediaIntakeInput = z.input<typeof mediaIntakeInputSchema>;
export type ValidatedMediaIntakeInput = z.output<typeof mediaIntakeInputSchema>;
export type MediaRightsBasis = z.output<typeof mediaRightsBasisSchema>;

export interface MediaAssetRecord {
  id: string;
  organizationId: string;
  projectId: string;
  sha256: string;
  storageKey: string;
  contentType: string;
  byteSize: number;
  originalFileName: string;
  rightsBasis: MediaRightsBasis;
  source: string;
  license: string | null;
}

export interface MediaIntakeResult {
  asset: MediaAssetRecord;
  deduplicated: boolean;
}

export const mediaSourceKindSchema = z.enum([
  "LISTING_IMAGE",
  "AGENT_PHOTO",
  "DEVELOPMENT_IMAGE",
  "OTHER",
]);

const mediaMirrorItemSchema = z.object({
  sourceUrl: z.url({ protocol: /^https?$/ }).max(2048),
  entityType: z.string().trim().min(1).max(64),
  entityUid: z.string().trim().min(1).max(240),
  kind: mediaSourceKindSchema,
  position: z.number().int().min(0).max(10_000),
  isImageOrderChangeAllowed: z.boolean().default(false),
  rightsBasis: mediaRightsBasisSchema,
  license: z.string().trim().min(1).max(255).nullable().optional(),
}).superRefine((input, context) => {
  if (input.rightsBasis === "LICENSED" && !input.license) {
    context.addIssue({ code: "custom", path: ["license"], message: "Licensed media requires license metadata" });
  }
});

export const mediaMirrorBatchInputSchema = z.object({
  organizationId: z.string().trim().min(1).max(128),
  projectId: z.string().trim().min(1).max(128),
  sourceId: z.string().trim().min(1).max(128),
  sourceRevisionId: z.string().trim().min(1).max(128),
  observedAt: z.iso.datetime({ offset: true }),
  items: z.array(mediaMirrorItemSchema).max(10_000),
}).strict();

export type MediaSourceKind = z.output<typeof mediaSourceKindSchema>;
export type MediaMirrorBatchInput = z.input<typeof mediaMirrorBatchInputSchema>;
export type ValidatedMediaMirrorBatchInput = z.output<typeof mediaMirrorBatchInputSchema>;

export interface MediaMirrorItemResult {
  canonicalSourceUrl: string;
  entityType: string;
  entityUid: string;
  kind: MediaSourceKind;
  position: number;
  status: "MIRRORED" | "WARNING";
  warningCode: string | null;
  assetId: string | null;
  publiclyPublishable: boolean;
}

export interface MediaMirrorBatchResult {
  importStatus: "UNCHANGED";
  mediaStatus: "COMPLETE" | "WARNING";
  items: readonly MediaMirrorItemResult[];
}

/** Server query scope; callers cannot supply trusted image membership or keys. */
export const inventoryMediaProjectionInputSchema = z.object({
  organizationId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  sourceId: z.string().min(1).max(128),
  sourceRevisionId: z.string().min(1).max(128),
  inventoryUid: z.string().min(1).max(26),
}).strict();
export type InventoryMediaProjectionInput = z.output<typeof inventoryMediaProjectionInputSchema>;
export interface InventoryMediaProjectionResult {
  media: readonly MediaPublicV1[];
  warnings: readonly ("MEDIA_MIRROR_WARNING" | "MEDIA_OBJECT_UNAVAILABLE" | "MEDIA_ASSET_INVALID")[];
}
