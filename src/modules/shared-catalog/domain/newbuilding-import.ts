import { ulidSchema } from "@ams-data-hub/data-contracts";
import { z } from "zod";

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const nullableCoordinate = (minimum: number, maximum: number) =>
  z.number().finite().min(minimum).max(maximum)
    .refine((value) => Number(value.toFixed(7)) === value, "COORDINATE_PRECISION_INVALID")
    .nullable().default(null);

export const newbuildingMediaInputSchema = z.object({
  externalId: boundedText(240),
  sourceUrl: z.string().url().max(2048).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  }, "CREDENTIAL_FREE_HTTPS_REQUIRED"),
  position: z.number().int().nonnegative().max(500),
  rightsBasis: z.enum(["OWNED", "LICENSED", "PUBLIC_DOMAIN"]),
  attribution: z.string().trim().max(500).nullable().default(null),
  license: z.string().trim().max(255).nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.rightsBasis === "LICENSED" && !value.attribution) {
    context.addIssue({ code: "custom", path: ["attribution"], message: "LICENSED_MEDIA_REQUIRES_ATTRIBUTION" });
  }
});

export const newbuildingPriceInputSchema = z.object({
  externalId: boundedText(240),
  amount: z.number().finite().positive().max(1_000_000_000_000).refine((value) => Number(value.toFixed(2)) === value, "PRICE_PRECISION_INVALID"),
  currency: z.string().trim().regex(/^[a-zA-Z]{3}$/).transform((value) => value.toUpperCase()),
  basis: z.enum(["TOTAL", "PER_SQUARE_METER"]).default("TOTAL"),
  areaM2: z.number().finite().positive().max(1_000_000).refine((value) => Number(value.toFixed(2)) === value, "AREA_PRECISION_INVALID").nullable().default(null),
  roomCount: z.number().int().nonnegative().max(100).nullable().default(null),
}).strict();

export const newbuildingStagingPayloadSchema = z.object({
  source: z.object({
    sourceId: boundedText(128),
    externalId: boundedText(240),
    observedAt: z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString()),
  }).strict(),
  target: z.object({
    developmentUid: ulidSchema.nullable().default(null),
    developerUid: ulidSchema,
    cityUid: ulidSchema,
    districtUid: ulidSchema.nullable().default(null),
  }).strict(),
  development: z.object({
    name: boundedText(200),
    addressLine: z.string().trim().max(500).nullable().default(null),
    latitude: nullableCoordinate(-90, 90),
    longitude: nullableCoordinate(-180, 180),
  }).strict(),
  prices: z.array(newbuildingPriceInputSchema).max(500).default([]),
  media: z.array(newbuildingMediaInputSchema).max(500).default([]),
}).strict().superRefine((value, context) => {
  if ((value.development.latitude === null) !== (value.development.longitude === null)) {
    context.addIssue({ code: "custom", path: ["development"], message: "COORDINATE_PAIR_REQUIRED" });
  }
  if (new Set(value.prices.map((price) => price.externalId + "\u0000" + price.basis)).size !== value.prices.length) {
    context.addIssue({ code: "custom", path: ["prices"], message: "DUPLICATE_PRICE_IDENTITY" });
  }
  if (new Set(value.media.map((item) => item.sourceUrl)).size !== value.media.length) {
    context.addIssue({ code: "custom", path: ["media"], message: "DUPLICATE_MEDIA_URL" });
  }
});

export type NewbuildingStagingPayload = z.infer<typeof newbuildingStagingPayloadSchema>;

export interface NewbuildingCurrentState {
  developmentUid: string | null;
  name: string | null;
  addressLine: string | null;
  latitude: number | null;
  longitude: number | null;
  knownPriceKeys: ReadonlySet<string>;
  knownMediaUrls: ReadonlySet<string>;
}

export interface NewbuildingImportPlan {
  mode: "DRY_RUN" | "MANUAL_APPLY";
  sourceIdentity: { sourceId: string; externalId: string; observedAt: string };
  developmentUid: string | null;
  developmentChanges: Array<{ field: "name" | "addressLine" | "latitude" | "longitude"; before: string | number | null; after: string | number | null }>;
  newPriceKeys: string[];
  newMediaUrls: string[];
  requiresExplicitConfirmation: true;
}

function priceKey(price: NewbuildingStagingPayload["prices"][number], observedAt: string): string {
  return [price.externalId, observedAt, price.basis].join("\u0000");
}

export function planNewbuildingImport(
  rawPayload: unknown,
  current: NewbuildingCurrentState,
  mode: NewbuildingImportPlan["mode"] = "DRY_RUN",
): NewbuildingImportPlan {
  const payload = newbuildingStagingPayloadSchema.parse(rawPayload);
  const changes: NewbuildingImportPlan["developmentChanges"] = [];
  const candidates = [
    ["name", current.name, payload.development.name],
    ["addressLine", current.addressLine, payload.development.addressLine],
    ["latitude", current.latitude, payload.development.latitude],
    ["longitude", current.longitude, payload.development.longitude],
  ] as const;
  for (const [field, before, after] of candidates) {
    if (before !== after) changes.push({ field, before, after });
  }
  return {
    mode,
    sourceIdentity: payload.source,
    developmentUid: current.developmentUid,
    developmentChanges: changes,
    newPriceKeys: payload.prices.map((price) => priceKey(price, payload.source.observedAt)).filter((key) => !current.knownPriceKeys.has(key)),
    newMediaUrls: payload.media.map((item) => item.sourceUrl).filter((url) => !current.knownMediaUrls.has(url)),
    requiresExplicitConfirmation: true,
  };
}

export function assertManualNewbuildingApply(plan: NewbuildingImportPlan, confirmed: boolean): void {
  if (plan.mode !== "MANUAL_APPLY" || !confirmed) throw new Error("NEWBUILDING_MANUAL_CONFIRMATION_REQUIRED");
}
