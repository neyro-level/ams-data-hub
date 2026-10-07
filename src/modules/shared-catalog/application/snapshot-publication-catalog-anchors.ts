import { ulidSchema } from "@ams-data-hub/data-contracts";
import { z } from "zod";

const base = { uid: ulidSchema, lifecycle: z.literal("ACTIVE"), mergedIntoUid: z.null() };
const developer = z.object(base).strict();
const development = z.object({ ...base, developerUid: ulidSchema, cityUid: ulidSchema, districtUid: ulidSchema.nullable() }).strict();
const building = z.object({ ...base, developmentUid: ulidSchema }).strict();
export const snapshotPublicationSubscriptionSchema = z.object({ mode: z.enum(["ALL_SHARED", "CURATED"]),
  version: z.number().int().positive(), cityUids: z.array(ulidSchema).max(100),
  selections: z.array(z.object({ developmentUid: ulidSchema, decision: z.enum(["INCLUDE", "EXCLUDE"]) }).strict()).max(500),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.cityUids).size !== value.cityUids.length
    || new Set(value.selections.map((row) => row.developmentUid)).size !== value.selections.length) {
    ctx.addIssue({ code: "custom", message: "DUPLICATE_SUBSCRIPTION_MEMBER" });
  }
}).transform((value) => ({ ...value, cityUids: [...value.cityUids].sort(),
  selections: [...value.selections].sort((a, b) => a.developmentUid.localeCompare(b.developmentUid)) }));
export const snapshotPublicationCatalogAnchorsSchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u), subscription: snapshotPublicationSubscriptionSchema,
  developers: z.array(developer).max(5000), developments: z.array(development).max(5000), buildings: z.array(building).max(5000),
}).strict().superRefine((value, ctx) => {
  const developers = new Set(value.developers.map((row) => row.uid)); const developments = new Set(value.developments.map((row) => row.uid));
  if (developers.size !== value.developers.length || developments.size !== value.developments.length
    || new Set(value.buildings.map((row) => row.uid)).size !== value.buildings.length
    || value.developments.some((row) => !developers.has(row.developerUid))
    || value.buildings.some((row) => !developments.has(row.developmentUid))
    || value.developments.some((row) => value.subscription.selections.some((item) => item.developmentUid === row.uid && item.decision === "EXCLUDE")
      || (value.subscription.mode === "ALL_SHARED" ? !value.subscription.cityUids.includes(row.cityUid)
        : !value.subscription.selections.some((item) => item.developmentUid === row.uid && item.decision === "INCLUDE")))) {
    ctx.addIssue({ code: "custom", message: "INVALID_SELECTED_CATALOG_CLOSURE" });
  }
});
export type SnapshotPublicationCatalogAnchors = z.infer<typeof snapshotPublicationCatalogAnchorsSchema>;
const invalid = (): never => { throw new Error("SNAPSHOT_PUBLICATION_CATALOG_ANCHORS_INVALID"); };

/** Validated receipt metadata plus the actual server-selected public graph. No live selection. */
export function prepareSnapshotPublicationCatalogAnchors(input: { projectId: string; subscriptions: readonly unknown[];
  catalog: readonly unknown[]; publishedDevelopers: ReadonlySet<string>; publishedDevelopments: ReadonlySet<string>; publishedBuildings: ReadonlySet<string>;
}): SnapshotPublicationCatalogAnchors {
  if (input.subscriptions.length !== 1 || input.catalog.length > 50_000) invalid();
  const developers: SnapshotPublicationCatalogAnchors["developers"] = [];
  const developments: SnapshotPublicationCatalogAnchors["developments"] = [];
  const buildings: SnapshotPublicationCatalogAnchors["buildings"] = [];
  for (const raw of input.catalog) {
    const identity = z.object({ uid: ulidSchema, entityType: z.enum(["region", "city", "district", "developer", "development", "building"]) }).safeParse(raw);
    if (!identity.success) invalid();
    const { uid, entityType } = identity.data!;
    if (entityType === "developer" && input.publishedDevelopers.has(uid)) {
      const row = developer.strip().safeParse(raw); if (!row.success) invalid(); developers.push(row.data!);
    } else if (entityType === "development" && input.publishedDevelopments.has(uid)) {
      const row = development.strip().safeParse(raw); if (!row.success) invalid(); developments.push(row.data!);
    } else if (entityType === "building" && input.publishedBuildings.has(uid)) {
      const row = building.strip().safeParse(raw); if (!row.success) invalid(); buildings.push(row.data!);
    }
  }
  if (developers.length !== input.publishedDevelopers.size || developments.length !== input.publishedDevelopments.size
    || buildings.length !== input.publishedBuildings.size) invalid();
  const result = snapshotPublicationCatalogAnchorsSchema.safeParse({ projectId: input.projectId, subscription: input.subscriptions[0], developers, developments, buildings });
  if (!result.success) invalid(); return result.data!;
}
