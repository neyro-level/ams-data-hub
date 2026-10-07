import { publicUrlIdSchema, ulidSchema, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { mediaPublicV1Schema, type MediaPublicV1 } from "@ams-data-hub/realty-contracts";
import { z } from "zod";
import {
  agentStatusSchema, factualLifecycleStatusSchema, isAgentPubliclyPublishable,
  mapProjectEditorialPublic, presentationLifecycleStatusSchema, projectEditorialEntityTypeSchema,
  projectEditorialPublicDtoSchema, projectRedirectReasonSchema, projectUrlPathSchema, projectUrlSlugSchema,
  replaceEntityEditorialInputSchema, replaceEntityMediaOrderPolicyInputSchema,
  replaceProjectPublicContactInputSchema, saveManualAgentInputSchema,
} from "../../project-state/index.ts";
import type { SnapshotDatasetInput, SnapshotDatasetKind, SnapshotRecordInput, SnapshotRecordReference } from "../contracts.ts";
import { assertSnapshotPrivacySafe } from "../domain/privacy-scanner.ts";
import { snapshotInputHash, type SnapshotBuildInputReceipt, type SnapshotInputPartKind } from "./snapshot-build-input.ts";
import { validateSnapshotInput } from "./snapshot-input-validation.ts";

const date = z.iso.datetime({ offset: true });
const entityType = projectEditorialEntityTypeSchema;
const contact = replaceProjectPublicContactInputSchema.shape;
const agent = saveManualAgentInputSchema.shape;
export const snapshotContactPublicSchema = z.object({ phone: contact.phone, email: z.email().nullable(),
  addressPublic: z.string().max(500).nullable(), messengers: z.array(z.url({ protocol: /^https?$/u })).max(10),
  hours: z.string().max(500).nullable() }).strict();
export const snapshotAgentPublicSchema = z.object({ uid: ulidSchema, slug: agent.slug, role: agent.role,
  fullName: agent.fullName, position: z.string().max(240).nullable(), bio: agent.bio.unwrap().nullable(),
  specializations: agent.specializations.unwrap(), workPhone: z.string().max(40).nullable(), workEmail: z.email().nullable(),
  messengers: agent.messengers.unwrap(), sortOrder: agent.sortOrder.unwrap(), media: z.array(mediaPublicV1Schema).max(1) }).strict();
const subject = { entityType, entityUid: ulidSchema, publicUrlId: publicUrlIdSchema };
export const snapshotUrlPublicSchema = z.discriminatedUnion("factType", [
  z.object({ factType: z.literal("reservation"), ...subject }).strict(),
  z.object({ factType: z.literal("entry"), ...subject, slug: projectUrlSlugSchema, canonicalPath: projectUrlPathSchema,
    factualLifecycle: factualLifecycleStatusSchema, presentationLifecycle: presentationLifecycleStatusSchema,
    redirectTargetPath: projectUrlPathSchema.nullable(), publishedAt: date.nullable(), retiredAt: date.nullable() }).strict(),
]).superRefine((value, context) => {
  if (value.factType === "entry" && ((value.presentationLifecycle === "REDIRECTED") !== (value.redirectTargetPath !== null))) {
    context.addIssue({ code: "custom", message: "SNAPSHOT_URL_STATE_INVALID" });
  }
});
export const snapshotRedirectPublicSchema = z.object({ fromPath: projectUrlPathSchema, toPath: projectUrlPathSchema,
  code: z.literal(301), reason: projectRedirectReasonSchema, createdAt: date }).strict();
export const snapshotLifecyclePublicSchema = z.discriminatedUnion("factType", [
  z.object({ factType: z.literal("inventory-state"), inventoryUid: ulidSchema,
    status: z.enum(["ACTIVE", "INACTIVE"]), effectiveAt: date }).strict(),
  z.object({ factType: z.literal("inventory-event"), inventoryUid: ulidSchema,
    type: z.enum(["INACTIVATED", "REACTIVATED"]), occurredAt: date }).strict(),
  z.object({ factType: z.literal("url-tombstone"), ...subject, canonicalPath: projectUrlPathSchema,
    reason: projectRedirectReasonSchema, createdAt: date }).strict(),
]);

function object(value: CanonicalJsonValue | undefined): Record<string, CanonicalJsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SNAPSHOT_PROJECT_FACT_INVALID");
  return value;
}
const entityDatasets: Record<z.infer<typeof entityType>, SnapshotDatasetKind> = {
  DEVELOPER: "developers", DEVELOPMENT: "developments", BUILDING: "buildings", INVENTORY: "inventory", AGENT: "agents",
};

/** Pure captured projection; media supplied only by server-owned captured candidate verification.
 * Fresh publication admission/consent checks remain separate from deterministic projection. */
export function projectSnapshotProjectState(input: SnapshotBuildInputReceipt,
  agentMedia: ReadonlyMap<string, readonly MediaPublicV1[]> = new Map()): SnapshotDatasetInput[] {
  const parts = validateSnapshotInput(input);
  if (agentMedia.size > 50_000) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
  const rows = (kind: SnapshotInputPartKind) => parts.filter((part) => part.kind === kind).flatMap((part) => part.payload).map(object);
  const projects = rows("project");
  if (projects.length !== 1 || projects[0]!.id !== input.projectId) throw new Error("SNAPSHOT_PROJECT_FACT_INVALID");
  const kinds = ["agents", "project/contacts", "editorial", "urls", "redirects", "lifecycle"] as const;
  type Kind = typeof kinds[number];
  const buffers = new Map<Kind, SnapshotRecordInput[]>(kinds.map((kind) => [kind, []]));
  const seen = new Set<string>();
  const add = (kind: Kind, key: string, value: unknown, references: SnapshotRecordReference[] = []) => {
    const identity = `${kind}\0${key}`;
    if (seen.has(identity)) throw new Error("SNAPSHOT_RECORD_DUPLICATE");
    const json = value as CanonicalJsonValue;
    assertSnapshotPrivacySafe(json);
    buffers.get(kind)!.push({ key, value: json, references }); seen.add(identity);
  };
  const contacts = rows("contacts");
  if (contacts.length > 1) throw new Error("SNAPSHOT_PROJECT_FACT_INVALID");
  for (const row of contacts) add("project/contacts", input.projectId, snapshotContactPublicSchema.parse({
    phone: row.phone, email: row.email, addressPublic: row.addressPublic, messengers: row.messengers, hours: row.hours,
  }));
  const publicSubjects = new Set<string>();
  for (const row of rows("agents")) {
    const status = agentStatusSchema.parse(row.status);
    const showOnSite = z.boolean().parse(row.showOnSite);
    const consentConfirmedAt = row.consentConfirmedAt === null ? null : new Date(date.parse(row.consentConfirmedAt));
    if (!isAgentPubliclyPublishable({ status, showOnSite, consentConfirmedAt })) continue;
    const uid = ulidSchema.parse(row.uid);
    const value = snapshotAgentPublicSchema.parse({ uid, slug: row.slug, role: row.role, fullName: row.fullName,
      position: row.position, bio: row.bio, specializations: row.specializations, workPhone: row.workPhone,
      workEmail: row.workEmail, messengers: row.messengers, sortOrder: row.sortOrder, media: agentMedia.get(uid) ?? [] });
    add("agents", uid, value, value.media.map((media) => ({ kind: "media", key: `AGENT/${uid}/${media.position}` })));
    publicSubjects.add(`AGENT\0${uid}`);
  }
  const catalogTypes = new Map([["developer", "DEVELOPER"], ["development", "DEVELOPMENT"], ["building", "BUILDING"]]);
  for (const row of rows("catalog")) {
    const type = typeof row.entityType === "string" ? catalogTypes.get(row.entityType) : undefined;
    if (type) publicSubjects.add(`${type}\0${ulidSchema.parse(row.uid)}`);
  }
  const inventory = rows("inventory");
  for (const row of inventory) {
    const uid = ulidSchema.parse(row.uid);
    const value = snapshotLifecyclePublicSchema.parse({ factType: "inventory-state", inventoryUid: uid,
      status: row.status, effectiveAt: row.updatedAt });
    add("lifecycle", `state:${uid}`, value);
    if (row.status === "ACTIVE") publicSubjects.add(`INVENTORY\0${uid}`);
  }
  const policies = new Map<string, Record<string, CanonicalJsonValue>>();
  for (const row of rows("media-order")) {
    const key = `${entityType.parse(row.entityType)}\0${ulidSchema.parse(row.entityUid)}`;
    if (policies.has(key)) throw new Error("SNAPSHOT_RECORD_DUPLICATE");
    policies.set(key, row);
  }
  const editorialInput = replaceEntityEditorialInputSchema.shape;
  const policyInput = replaceEntityMediaOrderPolicyInputSchema.shape;
  for (const row of rows("editorial")) {
    const type = entityType.parse(row.entityType); const uid = ulidSchema.parse(row.entityUid);
    const key = `${type}\0${uid}`;
    if (!publicSubjects.has(key)) continue;
    const policy = policies.get(key);
    const value = mapProjectEditorialPublic({ entityType: type, entityUid: uid,
      shortDescription: editorialInput.shortDescription.unwrap().nullable().parse(row.shortDescription),
      description: editorialInput.description.unwrap().nullable().parse(row.description), faq: editorialInput.faq.unwrap().parse(row.faq),
      mediaOrder: editorialInput.mediaOrder.unwrap().parse(row.mediaOrder),
      mediaOrderPolicyVersion: z.number().int().positive().nullable().parse(row.mediaOrderPolicyVersion) },
    policy ? { sourceMediaOrder: policyInput.sourceMediaOrder.unwrap().parse(policy.sourceMediaOrder),
      isImageOrderChangeAllowed: z.boolean().parse(policy.isImageOrderChangeAllowed),
      version: z.number().int().positive().parse(policy.version) } : null);
    add("editorial", `${type}:${uid}`, projectEditorialPublicDtoSchema.parse(value), [{ kind: entityDatasets[type], key: uid }]);
  }
  const urlFacts = rows("urls");
  const reservations = new Map<string, string>();
  for (const row of urlFacts) if (row.factType === "reservation") {
    const value = snapshotUrlPublicSchema.parse({ factType: "reservation", entityType: row.subjectType,
      entityUid: row.subjectUid, publicUrlId: row.publicUrlId });
    const key = `reservation:${value.publicUrlId}`;
    if (reservations.has(value.publicUrlId)) throw new Error("SNAPSHOT_RECORD_DUPLICATE");
    reservations.set(value.publicUrlId, key); add("urls", key, value);
  }
  const entries = new Map<string, string>();
  for (const row of urlFacts) {
    if (row.factType === "reservation") continue;
    if (row.factType !== "entry") throw new Error("SNAPSHOT_PROJECT_FACT_INVALID");
    const value = snapshotUrlPublicSchema.parse({ factType: "entry", entityType: row.entityType, entityUid: row.entityUid,
      publicUrlId: object(row.reservation).publicUrlId, slug: row.slug, canonicalPath: row.canonicalPath,
      factualLifecycle: row.factualLifecycle, presentationLifecycle: row.presentationLifecycle,
      redirectTargetPath: row.redirectTargetPath, publishedAt: row.publishedAt, retiredAt: row.retiredAt });
    const reservationKey = reservations.get(value.publicUrlId);
    if (!reservationKey || typeof row.id !== "string" || entries.has(row.id)) throw new Error("SNAPSHOT_REFERENCE_BROKEN");
    const key = `entry:${value.publicUrlId}`; entries.set(row.id, key);
    // Reservation subject can differ after a legitimate relink; its ID remains immutable.
    add("urls", key, value, [{ kind: "urls", key: reservationKey }]);
  }
  for (const row of rows("redirects")) {
    const target = typeof row.urlEntryId === "string" ? entries.get(row.urlEntryId) : undefined;
    if (!target) throw new Error("SNAPSHOT_REFERENCE_BROKEN");
    const value = snapshotRedirectPublicSchema.parse({ fromPath: row.fromPath, toPath: row.toPath,
      code: row.code, reason: row.reason, createdAt: row.createdAt });
    add("redirects", value.fromPath, value, [{ kind: "urls", key: target }]);
  }
  for (const row of rows("tombstones")) {
    const value = snapshotLifecyclePublicSchema.parse({ factType: "url-tombstone", entityType: row.entityType,
      entityUid: row.entityUid, publicUrlId: object(row.reservation).publicUrlId,
      canonicalPath: row.canonicalPath, reason: row.reason, createdAt: row.createdAt });
    if (value.factType !== "url-tombstone" || !reservations.has(value.publicUrlId)) throw new Error("SNAPSHOT_REFERENCE_BROKEN");
    add("lifecycle", `tombstone:${value.canonicalPath}`, value, [{ kind: "urls", key: reservations.get(value.publicUrlId)! }]);
  }
  for (const row of rows("lifecycle")) {
    if (typeof row.id !== "string" || !row.id) throw new Error("SNAPSHOT_PROJECT_FACT_INVALID");
    add("lifecycle", `event:${snapshotInputHash(row.id)}`, snapshotLifecyclePublicSchema.parse({ factType: "inventory-event",
      inventoryUid: row.inventoryUid, type: row.type, occurredAt: row.occurredAt }));
  }
  return kinds.map((kind) => ({ kind, records: buffers.get(kind)!.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) }));
}
