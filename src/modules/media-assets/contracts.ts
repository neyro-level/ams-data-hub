import { z } from "zod";

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
