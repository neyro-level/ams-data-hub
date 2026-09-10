import { z } from "zod";

export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const timezonePattern = /^[+-](0\d|1[0-4]):[0-5]\d$/;
export const placeholderHost = "todo.invalid";

export function isPlaceholderSiteUrl(value: string) {
  try {
    return new URL(value).hostname === placeholderHost;
  } catch {
    return false;
  }
}

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "Expected https URL");

export const clusterGroupSchema = z.object({
  slug: z.string().regex(slugPattern),
  label: z.string().min(1),
  terms: z.array(z.string().min(1)).default([]),
});

export const clusterProfileSchema = z.object({
  schemaVersion: z.literal(1),
  profileSlug: z.string().regex(slugPattern),
  name: z.string().min(1),
  brandTerms: z.array(z.string().min(1)),
  groups: z.array(clusterGroupSchema),
});

export const goalCategorySchema = z.enum([
  "lead_submit",
  "phone_click",
  "messenger_click",
  "form_start",
  "file_download",
  "other",
]);

export const goalDefinitionSchema = z.object({
  goalId: z.string().regex(/^\d+$/),
  label: z.string().min(1),
  category: goalCategorySchema,
  direction: z.enum(["primary", "secondary"]),
  includeInSeoConversion: z.boolean(),
  siteSlugs: z.array(z.string().regex(slugPattern)).default([]),
});

export const goalProfileSchema = z.object({
  schemaVersion: z.literal(1),
  clientSlug: z.string().regex(slugPattern),
  goals: z.array(goalDefinitionSchema),
});

export const webmasterRegistrySchema = z
  .object({
    enabled: z.boolean(),
    expectedHostUrl: httpsUrlSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.expectedHostUrl === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enabled webmaster source requires expectedHostUrl",
        path: ["expectedHostUrl"],
      });
    }
  });

export const metricaRegistrySchema = z
  .object({
    enabled: z.boolean(),
    counterId: z.string().regex(/^\d+$/).nullable(),
    goalProfile: z.string().regex(slugPattern).nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.counterId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enabled metrica source requires counterId",
        path: ["counterId"],
      });
    }

    if (value.enabled && value.goalProfile === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enabled metrica source requires goalProfile",
        path: ["goalProfile"],
      });
    }
  });

export const topvisorRegistrySchema = z
  .object({
    enabled: z.boolean(),
    projectId: z.number().int().positive().nullable(),
    regionIndex: z.number().int().nonnegative().nullable(),
    targets: z.array(z.object({ engine: z.enum(["YANDEX", "GOOGLE"]), device: z.enum(["DESKTOP", "MOBILE"]), regionKey: z.number().int().positive(), regionIndex: z.number().int().nonnegative() })).max(4).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.projectId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enabled Topvisor source requires projectId",
        path: ["projectId"],
      });
    }
    if (value.enabled && value.regionIndex === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enabled Topvisor source requires regionIndex",
        path: ["regionIndex"],
      });
    }
  });

export const siteRegistrySchema = z
  .object({
    siteSlug: z.string().regex(slugPattern),
    name: z.string().min(1),
    siteUrl: httpsUrlSchema,
    timezone: z.string().regex(timezonePattern),
    enabled: z.boolean(),
    webmaster: webmasterRegistrySchema,
    metrica: metricaRegistrySchema,
    topvisor: topvisorRegistrySchema.default({
      enabled: false,
      projectId: null,
      regionIndex: null,
      targets: [],
    }),
  })
  .superRefine((site, ctx) => {
    if (site.enabled && isPlaceholderSiteUrl(site.siteUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enabled site cannot use placeholder URL",
        path: ["siteUrl"],
      });
    }

    if (!site.enabled && site.webmaster.enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Disabled site cannot enable webmaster source",
        path: ["webmaster", "enabled"],
      });
    }

    if (!site.enabled && site.metrica.enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Disabled site cannot enable metrica source",
        path: ["metrica", "enabled"],
      });
    }

    if (!site.enabled && site.topvisor.enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Disabled site cannot enable Topvisor source",
        path: ["topvisor", "enabled"],
      });
    }
  });

export const clientRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  clientSlug: z.string().regex(slugPattern),
  name: z.string().min(1),
  enabled: z.boolean(),
  clusterProfile: z.string().regex(slugPattern),
  sites: z.array(siteRegistrySchema).min(1),
});

export const thresholdsSchema = z.object({
  schemaVersion: z.literal(1),
  queryOpportunity: z.object({
    minimumShows: z.number().int().nonnegative(),
    maximumCtrPercent: z.number().nonnegative(),
    maximumAveragePosition: z.number().nonnegative(),
  }),
  trendAlerts: z.object({
    showsDropPercent: z.number().nonnegative(),
    clicksDropPercent: z.number().nonnegative(),
    positionWorsenedDelta: z.number().nonnegative(),
    pagesInSearchDropPercent: z.number().nonnegative(),
    organicVisitsDropPercent: z.number().nonnegative(),
    goalConversionDropPercent: z.number().nonnegative(),
  }),
});

export type ClusterProfile = z.infer<typeof clusterProfileSchema>;
export type GoalProfile = z.infer<typeof goalProfileSchema>;
export type ClientRegistry = z.infer<typeof clientRegistrySchema>;
export type SiteRegistry = z.infer<typeof siteRegistrySchema>;
export type ThresholdsConfig = z.infer<typeof thresholdsSchema>;
