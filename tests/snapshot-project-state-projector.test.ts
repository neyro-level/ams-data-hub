import { createUlid, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import {
  projectSnapshotProjectState, SNAPSHOT_INPUT_PART_KINDS, SnapshotInputPartsBuilder,
  snapshotBuildInputDigest, snapshotInputHash, type SnapshotBuildInputReceipt, type SnapshotInputPartKind,
} from "../src/modules/snapshot-delivery/index.ts";

const timestamp = "2026-10-07T00:00:00.000Z";
function input(facts: Partial<Record<SnapshotInputPartKind, CanonicalJsonValue[]>> = {}): SnapshotBuildInputReceipt {
  const builder = new SnapshotInputPartsBuilder();
  for (const kind of SNAPSHOT_INPUT_PART_KINDS) builder.add(kind, facts[kind] ?? (kind === "project" ? [{ id: "synthetic-project" }] : []));
  const parts = builder.finish();
  const receipt = { id: "synthetic", organizationId: "synthetic-org", projectId: "synthetic-project",
    idempotencyKeyHash: "a".repeat(64), requestHash: "b".repeat(64), inputSchemaVersion: 1,
    projectorVersion: "db-v1", schemaMinor: 0, publishSequence: 1, projectStateRevision: 1,
    capturedAt: new Date(timestamp), parts, catalogRevision: snapshotInputHash(parts.filter((part) => part.kind === "catalog")
      .map(({ partIndex, payloadHash }) => ({ partIndex, payloadHash }))), inputHash: "" };
  receipt.inputHash = snapshotBuildInputDigest(receipt); return receipt;
}
function fixture() {
  const visible = createUlid(); const hidden = createUlid(); const inventory = createUlid();
  const publicUrlId = "1234567890123456";
  const agent = { uid: visible, slug: "synthetic-agent", role: "AGENT", fullName: "Synthetic Agent",
    position: null, bio: null, specializations: [], workPhone: "+70000000001", workEmail: null, messengers: [],
    sortOrder: 0, status: "ACTIVE", showOnSite: true, consentConfirmedAt: timestamp,
    photoMediaId: "private-photo", feedPhotoMediaId: "private-feed", consentBasis: "private-basis" };
  const facts: Partial<Record<SnapshotInputPartKind, CanonicalJsonValue[]>> = {
    contacts: [{ phone: "+70000000002", email: null, addressPublic: "Synthetic official office", messengers: [], hours: null, version: 1 }],
    agents: [agent, { ...agent, uid: hidden, fullName: "Private Hidden Agent", showOnSite: false }],
    editorial: [
      { entityType: "AGENT", entityUid: visible, shortDescription: "Synthetic public copy", description: null,
        faq: [], mediaOrder: ["b", "a"], mediaOrderPolicyVersion: 2, version: 1, presentationNotes: "private-notes" },
      { entityType: "AGENT", entityUid: hidden, description: "Private Hidden Editorial" },
    ],
    "media-order": [{ entityType: "AGENT", entityUid: visible, sourceMediaOrder: ["a", "b"], isImageOrderChangeAllowed: true, version: 2 }],
    inventory: [{ uid: inventory, status: "INACTIVE", updatedAt: timestamp, externalOfferId: "private-offer" }],
    urls: [
      { factType: "entry", id: "private-entry", entityType: "AGENT", entityUid: visible, slug: "synthetic-agent",
        canonicalPath: "/agents/synthetic-agent", factualLifecycle: "ACTIVE", presentationLifecycle: "VISIBLE",
        redirectTargetPath: null, publishedAt: timestamp, retiredAt: null, reservation: { publicUrlId } },
      { factType: "reservation", id: "private-reservation", subjectType: "AGENT", subjectUid: hidden, publicUrlId },
    ],
    redirects: [{ id: "private-redirect", urlEntryId: "private-entry", fromPath: "/agents/old",
      toPath: "/agents/synthetic-agent", code: 301, reason: "SLUG_CHANGE", createdAt: timestamp }],
    tombstones: [{ id: "private-tombstone", entityType: "AGENT", entityUid: hidden,
      canonicalPath: "/agents/retired", reason: "RETIRE", createdAt: timestamp, reservation: { publicUrlId } }],
    lifecycle: [{ id: "private-event", inventoryUid: inventory, type: "INACTIVATED", occurredAt: timestamp }],
  };
  return { facts, visible, hidden, publicUrlId, inventory };
}

describe("captured project-state public projectors", () => {
  it("projects six datasets with strict public fields, persistent IDs and declared references", () => {
    const data = fixture(); const receipt = input(data.facts); const before = structuredClone(receipt);
    const datasets = projectSnapshotProjectState(receipt);
    expect(datasets.map((dataset) => dataset.kind)).toEqual(["agents", "project/contacts", "editorial", "urls", "redirects", "lifecycle"]);
    expect(datasets.map((dataset) => dataset.records.length)).toEqual([1, 1, 1, 2, 1, 3]);
    expect(datasets[0]!.records[0]!.value).toMatchObject({ uid: data.visible, media: [] });
    expect(datasets[1]!.records[0]!.key).toBe("synthetic-project");
    expect(datasets[2]!.records[0]!.value).toMatchObject({ mediaOrder: ["b", "a"], isImageOrderChangeAllowed: true });
    expect(datasets[4]!.records[0]!.references).toEqual([{ kind: "urls", key: `entry:${data.publicUrlId}` }]);
    expect(JSON.stringify(datasets)).not.toMatch(/private-|Private Hidden|consent|feedPhoto|photoMediaId|presentationNotes|externalOfferId/u);
    expect(receipt).toEqual(before); expect(projectSnapshotProjectState(receipt)).toEqual(datasets);
  });
  it("emits empty datasets and rejects absent/foreign project metadata", () => {
    expect(projectSnapshotProjectState(input()).every((dataset) => dataset.records.length === 0)).toBe(true);
    expect(() => projectSnapshotProjectState(input({ project: [] }))).toThrow("SNAPSHOT_PROJECT_FACT_INVALID");
    expect(() => projectSnapshotProjectState(input({ project: [{ id: "foreign-project" }] }))).toThrow("SNAPSHOT_PROJECT_FACT_INVALID");
  });
  it("omits agent and personal editorial for every closed captured publication gate", () => {
    const data = fixture();
    const changes: Record<string, CanonicalJsonValue>[] = [{ status: "HIDDEN" }, { status: "DEPARTED" }, { showOnSite: false }, { consentConfirmedAt: null }];
    for (const change of changes) {
      const facts = { ...data.facts, agents: data.facts.agents!.map((row) => ({ ...(row as Record<string, CanonicalJsonValue>), ...change })) };
      const datasets = projectSnapshotProjectState(input(facts));
      expect(datasets[0]!.records).toEqual([]); expect(datasets[2]!.records).toEqual([]);
      expect(datasets[1]!.records).toHaveLength(1);
    }
  });
  it("uses captured media-order policy and rejects duplicate manual permutations", () => {
    const data = fixture(); const policy = data.facts["media-order"]![0] as Record<string, CanonicalJsonValue>;
    const changes: Record<string, CanonicalJsonValue>[] = [{ version: 3 }, { isImageOrderChangeAllowed: false }];
    for (const change of changes) {
      const datasets = projectSnapshotProjectState(input({ ...data.facts, "media-order": [{ ...policy, ...change }] }));
      expect(datasets[2]!.records[0]!.value).toMatchObject({ mediaOrder: ["a", "b"] });
    }
    const editorial = data.facts.editorial![0] as Record<string, CanonicalJsonValue>;
    expect(() => projectSnapshotProjectState(input({ ...data.facts, editorial: [{ ...editorial, mediaOrder: ["a", "a"] }] }))).toThrow();
  });
  it("declares verified media references without copying private assignment IDs", () => {
    const data = fixture(); const media = { ref: "c".repeat(64), kind: "IMAGE" as const, position: 0 };
    const datasets = projectSnapshotProjectState(input(data.facts), new Map([[data.visible, [media]]]));
    expect(datasets[0]!.records[0]!.value).toMatchObject({ media: [media] });
    expect(datasets[0]!.records[0]!.references).toEqual([{ kind: "media", key: `AGENT/${data.visible}/0` }]);
  });
  it("rejects missing reservation/redirect entry and invalid persisted URL state", () => {
    const data = fixture();
    expect(() => projectSnapshotProjectState(input({ ...data.facts, urls: [data.facts.urls![0]!] }))).toThrow("SNAPSHOT_REFERENCE_BROKEN");
    expect(() => projectSnapshotProjectState(input({ ...data.facts, urls: [data.facts.urls![1]!] }))).toThrow("SNAPSHOT_REFERENCE_BROKEN");
    const entry = data.facts.urls![0] as Record<string, CanonicalJsonValue>;
    expect(() => projectSnapshotProjectState(input({ ...data.facts, urls: [{ ...entry, redirectTargetPath: "/wrong" }, data.facts.urls![1]!] }))).toThrow();
    expect(() => projectSnapshotProjectState(input({ ...data.facts, urls: [{ ...entry, canonicalPath: "https://example.invalid" }, data.facts.urls![1]!] }))).toThrow();
  });
  it("rejects duplicate contacts/records and unsafe public HTML", () => {
    const data = fixture();
    expect(() => projectSnapshotProjectState(input({ ...data.facts, contacts: [...data.facts.contacts!, ...data.facts.contacts!] }))).toThrow();
    expect(() => projectSnapshotProjectState(input({ ...data.facts, redirects: [...data.facts.redirects!, ...data.facts.redirects!] }))).toThrow("SNAPSHOT_RECORD_DUPLICATE");
    const agent = data.facts.agents![0] as Record<string, CanonicalJsonValue>;
    expect(() => projectSnapshotProjectState(input({ ...data.facts, agents: [{ ...agent, fullName: "<script>bad</script>" }] }))).toThrow("SNAPSHOT_PRIVACY_RAW_HTML");
  });
  it("retains inactive lifecycle and tombstones without requiring live inventory", () => {
    const data = fixture(); const datasets = projectSnapshotProjectState(input(data.facts));
    expect(datasets[5]!.records.map((record) => record.value)).toContainEqual({ factType: "inventory-state", inventoryUid: data.inventory, status: "INACTIVE", effectiveAt: timestamp });
    expect(datasets[5]!.records.map((record) => record.value)).toContainEqual(expect.objectContaining({ factType: "url-tombstone", publicUrlId: data.publicUrlId }));
    expect(datasets[5]!.records.filter((record) => record.key.startsWith("event:"))[0]!.references).toEqual([]);
  });
});
