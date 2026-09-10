import { z } from "zod";
import { slugPattern } from "./registry.ts";

export const trackedQueryPositionSchema = z.object({
  current: z.number().int().min(1).max(250).nullable(),
  baseline: z.number().int().min(1).max(250).nullable(),
  delta: z.number().int().nullable(),
});

export const trackedQuerySchema = z.object({
  query: z.string().trim().min(2),
  position: trackedQueryPositionSchema,
});

export const trackedQuerySetSchema = z
  .object({
    schemaVersion: z.literal(1),
    clientSlug: z.string().regex(slugPattern),
    siteSlug: z.string().regex(slugPattern),
    source: z.literal("owner-provided"),
    baselineLabel: z.string().trim().min(1),
    expectedCount: z.number().int().min(1).max(100),
    queries: z.array(trackedQuerySchema).min(1).max(100),
  })
  .superRefine((value, ctx) => {
    const normalizedQueries = new Set<string>();

    for (const [index, query] of value.queries.entries()) {
      const normalized = query.query.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim();
      if (normalizedQueries.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate tracked query: ${query.query}`,
          path: ["queries", index, "query"],
        });
      }
      normalizedQueries.add(normalized);
    }

    if (value.queries.length !== value.expectedCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Tracked core must contain exactly ${value.expectedCount} queries`,
        path: ["queries"],
      });
    }
  });

export type TrackedQuery = z.infer<typeof trackedQuerySchema>;
export type TrackedQuerySet = z.infer<typeof trackedQuerySetSchema>;
