import { z } from "zod";

/** Content identity only: neither a storage key nor a bearer capability.
 * A consumer resolves it through authorized project-owned media delivery. */
export const mediaPublicV1Schema = z.object({
  ref: z.string().regex(/^[a-f0-9]{64}$/u),
  kind: z.literal("IMAGE"),
  position: z.number().int().min(0).max(10_000),
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional(),
  alt: z.string().max(500).optional(),
}).strict();
export type MediaPublicV1 = z.infer<typeof mediaPublicV1Schema>;
