import { z } from "zod";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const rankQueryPositionSchema = z.object({
  query: z.string().min(1),
  position: z.number().int().min(1).max(250).nullable(),
});

export const rankSnapshotSchema = z.object({
  capturedAt: isoDateSchema,
  queries: z.array(rankQueryPositionSchema).min(1).max(100),
  engine: z.enum(["YANDEX", "GOOGLE"]).optional(),
  device: z.enum(["DESKTOP", "MOBILE"]).optional(),
  regionKey: z.string().optional(),
  regionIndex: z.number().int().nonnegative().optional(),
});

export const topvisorSiteDataSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  fetchedAt: z.string().datetime({ offset: true }),
  projectId: z.number().int().positive(),
  regionIndex: z.number().int().nonnegative(),
  snapshots: z.array(rankSnapshotSchema),
});

export type RankQueryPosition = z.infer<typeof rankQueryPositionSchema>;
export type RankSnapshot = z.infer<typeof rankSnapshotSchema>;
export type TopvisorSiteData = z.infer<typeof topvisorSiteDataSchema>;
