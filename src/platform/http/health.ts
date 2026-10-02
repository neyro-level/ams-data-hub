import { z } from "zod";
import { correlationIdSchema } from "./correlation.ts";

const releaseShaSchema = z.string().regex(/^[0-9a-f]{40}$/).nullable();

export const liveHealthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("ams-data-hub"),
  releaseSha: releaseShaSchema,
  correlationId: correlationIdSchema,
  time: z.string().datetime({ offset: true }),
});

export const readyHealthSchema = z.object({
  status: z.literal("ready"),
  service: z.literal("ams-data-hub"),
  releaseSha: releaseShaSchema,
  correlationId: correlationIdSchema,
  dependencies: z.object({
    postgresql: z.literal("ready"),
    auth: z.literal("configured"),
    outbox: z.object({
      status: z.enum(["healthy", "degraded"]),
      pending: z.number().int().nonnegative(),
      processing: z.number().int().nonnegative(),
      deadLetter: z.number().int().nonnegative(),
    }),
    worker: z.object({
      status: z.enum(["healthy", "stale", "unknown"]),
      lastHeartbeatAt: z.string().datetime({ offset: true }).nullable(),
    }),
  }),
});

export type LiveHealth = z.infer<typeof liveHealthSchema>;
export type ReadyHealth = z.infer<typeof readyHealthSchema>;
