import { z } from "zod";
import { topvisorSiteDataSchema } from "./rank-source.ts";
import { metricaSiteAuditSchema } from "./metrica-source.ts";
import { reportPeriodKeySchema } from "./report.ts";
import { slugPattern } from "./registry.ts";
import { webmasterSiteDataSchema } from "./webmaster-source.ts";

export const siteSourceBundleSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime({ offset: true }),
  clientSlug: z.string().regex(slugPattern),
  siteSlug: z.string().regex(slugPattern),
  periodKey: reportPeriodKeySchema,
  current: z.object({
    webmaster: webmasterSiteDataSchema.nullable(),
    metrica: metricaSiteAuditSchema.nullable(),
    topvisor: topvisorSiteDataSchema.nullable(),
  }),
  previous: z.object({
    webmaster: webmasterSiteDataSchema.nullable(),
    metrica: metricaSiteAuditSchema.nullable(),
    topvisor: z.null(),
  }),
});

export type SiteSourceBundle = z.infer<typeof siteSourceBundleSchema>;
