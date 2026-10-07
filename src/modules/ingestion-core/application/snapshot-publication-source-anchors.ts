import { ulidSchema } from "@ams-data-hub/data-contracts";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const head = z.object({ id, sequence: z.number().int().positive(), normalizedContentHash: hash }).strict();
const source = z.object({ sourceId: id,
  datasetType: z.enum(["MIXED_REALTY", "RESALE", "NEW_BUILD", "HOUSE", "LAND", "COMMERCIAL", "AGENT"]),
  sharingPolicy: z.literal("PROJECT_ONLY"), approvedHead: head.nullable() }).strict();
const inventory = z.object({ uid: ulidSchema, sourceId: id, normalizedHash: hash,
  factRevisionId: id, factRevisionSequence: z.number().int().positive(),
  factProfileKey: id, factProfileVersion: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/u) }).strict();
export const snapshotPublicationSourceAnchorsSchema = z.object({
  sources: z.array(source).max(50_000), inventory: z.array(inventory).max(50_000),
}).strict().superRefine((value, context) => {
  const sources = new Map(value.sources.map((row) => [row.sourceId, row]));
  if (value.sources.length + value.inventory.length > 50_000 || sources.size !== value.sources.length
    || new Set(value.inventory.map((row) => row.uid)).size !== value.inventory.length) {
    context.addIssue({ code: "custom", message: "INVALID_COHORT" });
  }
  for (const row of value.inventory) {
    const approved = sources.get(row.sourceId)?.approvedHead;
    if (!approved || row.factRevisionSequence > approved.sequence
      || (row.factRevisionSequence === approved.sequence) !== (row.factRevisionId === approved.id)) {
      context.addIssue({ code: "custom", message: "INVALID_FACT_PIN" });
    }
  }
});
export type SnapshotPublicationSourceAnchors = z.infer<typeof snapshotPublicationSourceAnchorsSchema>;

/** Only validated receipt sections. Own copied metadata; no producer IDs or payloads. */
export function prepareSnapshotPublicationSourceAnchors(sections: { sources: readonly unknown[]; inventory: readonly unknown[] }): SnapshotPublicationSourceAnchors {
  const rawSource = source.omit({ approvedHead: true }).extend({
    entityType: z.literal("source"), approvedHead: head.extend({ status: z.literal("GOOD") }).strip().nullable(),
  }).strip();
  const rawInventory = inventory.extend({ status: z.enum(["ACTIVE", "INACTIVE"]),
    approvedHeadId: id, approvedHeadSequence: z.number().int().positive() }).strip();
  const sources: SnapshotPublicationSourceAnchors["sources"] = [];
  const identities: SnapshotPublicationSourceAnchors["inventory"] = [];
  if (sections.sources.length + sections.inventory.length > 50_000) throw new Error("SNAPSHOT_PUBLICATION_SOURCE_ANCHORS_INVALID");
  for (const raw of sections.sources) {
    if (raw && typeof raw === "object" && "entityType" in raw && raw.entityType === "profile") continue;
    const result = rawSource.safeParse(raw);
    if (!result.success) throw new Error("SNAPSHOT_PUBLICATION_SOURCE_ANCHORS_INVALID");
    const { entityType: _type, approvedHead, ...row } = result.data; void _type;
    sources.push({ ...row, approvedHead: approvedHead ? {
      id: approvedHead.id, sequence: approvedHead.sequence, normalizedContentHash: approvedHead.normalizedContentHash,
    } : null });
  }
  const sourceHeads = new Map(sources.map((row) => [row.sourceId, row.approvedHead]));
  for (const raw of sections.inventory) {
    if (raw && typeof raw === "object" && "status" in raw && raw.status === "INACTIVE") continue;
    const result = rawInventory.safeParse(raw);
    if (!result.success) throw new Error("SNAPSHOT_PUBLICATION_SOURCE_ANCHORS_INVALID");
    const { status: _status, approvedHeadId, approvedHeadSequence, ...row } = result.data; void _status;
    const approved = sourceHeads.get(row.sourceId);
    if (!approved || approved.id !== approvedHeadId || approved.sequence !== approvedHeadSequence) {
      throw new Error("SNAPSHOT_PUBLICATION_SOURCE_ANCHORS_INVALID");
    }
    identities.push(row);
  }
  const parsed = snapshotPublicationSourceAnchorsSchema.safeParse({ sources, inventory: identities });
  if (!parsed.success) throw new Error("SNAPSHOT_PUBLICATION_SOURCE_ANCHORS_INVALID");
  return parsed.data;
}
