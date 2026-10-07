import { ulidSchema } from "@ams-data-hub/data-contracts";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const version = z.number().int().positive();
const agent = z.object({ uid: ulidSchema, version, consentConfirmedAt: z.iso.datetime({ offset: true }),
  photoMediaId: id.nullable(), feedPhotoMediaId: id.nullable() }).strict();
const binding = z.object({ inventoryUid: ulidSchema, sourceId: id, sourceRevisionId: id,
  recordHash: z.string().regex(/^[a-f0-9]{64}$/u), agentUid: ulidSchema }).strict();
export const snapshotPublicationProjectAnchorsSchema = z.object({ projectId: id, requiresContact: z.boolean(),
  contactVersion: version.nullable(), agents: z.array(agent).max(50_000), bindings: z.array(binding).max(50_000),
}).strict().superRefine((value, context) => {
  const agents = new Set(value.agents.map((row) => row.uid));
  if ((value.requiresContact && value.contactVersion === null) || value.agents.length + value.bindings.length > 50_000
    || agents.size !== value.agents.length || new Set(value.bindings.map((row) => row.inventoryUid)).size !== value.bindings.length
    || value.bindings.some((row) => !agents.has(row.agentUid))) {
    context.addIssue({ code: "custom", message: "INVALID_PUBLICATION_ANCHORS" });
  }
});
export type SnapshotPublicationProjectAnchors = z.infer<typeof snapshotPublicationProjectAnchorsSchema>;
const invalid = (): never => { throw new Error("SNAPSHOT_PUBLICATION_PROJECT_ANCHORS_INVALID"); };

/** Validated receipt sections + server-computed published graph only. Never copy PII. */
export function prepareSnapshotPublicationProjectAnchors(input: {
  project: readonly unknown[]; contacts: readonly unknown[]; agents: readonly unknown[]; links: readonly unknown[];
  publishedAgentUids: ReadonlySet<string>; publishedBindings: ReadonlyMap<string, string>; requiresContact: boolean;
}): SnapshotPublicationProjectAnchors {
  if (input.project.length !== 1 || input.contacts.length > 1
    || input.agents.length + input.links.length > 50_000 || input.publishedAgentUids.size > 50_000 || input.publishedBindings.size > 50_000) invalid();
  const project = z.object({ id, status: z.literal("ACTIVE"), serviceState: z.literal("ACTIVE") }).safeParse(input.project[0]);
  if (!project.success) invalid();
  const contact = input.contacts.length ? z.object({ version }).safeParse(input.contacts[0]) : null;
  if (contact && !contact.success) invalid();
  const agents: SnapshotPublicationProjectAnchors["agents"] = [];
  const bindings: SnapshotPublicationProjectAnchors["bindings"] = [];
  const capturedAgent = agent.extend({ status: z.literal("ACTIVE"), showOnSite: z.literal(true) }).strip();
  for (const raw of input.agents) {
    const parsed = capturedAgent.safeParse(raw);
    if (!parsed.success) invalid();
    if (!input.publishedAgentUids.has(parsed.data!.uid)) continue;
    const { status: _status, showOnSite: _show, ...anchor } = parsed.data!; void _status; void _show;
    agents.push(anchor);
  }
  for (const raw of input.links) {
    if (!raw || typeof raw !== "object" || !("entityType" in raw) || raw.entityType !== "agent-binding") continue;
    const parsed = binding.extend({ entityType: z.literal("agent-binding") }).strip().safeParse(raw);
    if (!parsed.success) invalid();
    const selected = input.publishedBindings.get(parsed.data!.inventoryUid);
    if (!selected) continue;
    if (selected !== parsed.data!.agentUid) invalid();
    const { entityType: _type, ...anchor } = parsed.data!; void _type; bindings.push(anchor);
  }
  if (agents.length !== input.publishedAgentUids.size || bindings.length !== input.publishedBindings.size) invalid();
  const parsed = snapshotPublicationProjectAnchorsSchema.safeParse({ projectId: project.data!.id,
    requiresContact: input.requiresContact, contactVersion: contact?.data?.version ?? null, agents, bindings });
  if (!parsed.success) invalid();
  return parsed.data!;
}
