import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import { prepareSnapshotPublicationProjectAnchors } from "../src/modules/project-state/index.ts";

function input() {
  const uid = createUlid(); const inventoryUid = createUlid();
  const agent = { uid, version: 3, status: "ACTIVE", showOnSite: true, consentConfirmedAt: "2026-10-07T01:02:03.789Z",
    photoMediaId: "photo", feedPhotoMediaId: null, fullName: "synthetic-private-name", workPhone: "synthetic-private-phone" };
  return { project: [{ id: "project", status: "ACTIVE", serviceState: "ACTIVE", name: "private", version: 99 }],
    contacts: [{ version: 2, phone: "synthetic-private-phone" }], agents: [agent], links: [{ entityType: "agent-binding",
      inventoryUid, sourceId: "source", sourceRevisionId: "revision", recordHash: "a".repeat(64), agentUid: uid }],
    publishedAgentUids: new Set([uid]), publishedBindings: new Map([[inventoryUid, uid]]), requiresContact: false };
}
describe("value-free captured publication project anchors", () => {
  it("owns only graph/consent metadata, not personal fields or whole Project.version", () => {
    const raw = input(); const anchors = prepareSnapshotPublicationProjectAnchors(raw);
    expect(anchors.agents).toHaveLength(1); expect(anchors.bindings).toHaveLength(1);
    expect(anchors.contactVersion).toBe(2);
    expect(JSON.stringify(anchors)).not.toMatch(/private|fullName|workPhone|phone|name/u);
    raw.agents[0]!.photoMediaId = "changed"; expect(anchors.agents[0]!.photoMediaId).toBe("photo");
    expect(anchors).not.toHaveProperty("version");
  });
  it.each(["frozen-project", "missing-agent", "hidden-agent", "no-consent", "wrong-binding", "required-contact", "duplicate"])("rejects %s", (mode) => {
    const raw = input();
    if (mode === "frozen-project") raw.project[0]!.serviceState = "SUSPENDED";
    if (mode === "missing-agent") raw.publishedAgentUids.add(createUlid());
    if (mode === "hidden-agent") raw.agents[0]!.showOnSite = false;
    if (mode === "no-consent") raw.agents[0]!.consentConfirmedAt = "bad";
    if (mode === "wrong-binding") raw.publishedBindings.set(raw.links[0]!.inventoryUid, createUlid());
    if (mode === "required-contact") { raw.requiresContact = true; raw.contacts = []; }
    if (mode === "duplicate") raw.agents.push(raw.agents[0]!);
    expect(() => prepareSnapshotPublicationProjectAnchors(raw)).toThrow("SNAPSHOT_PUBLICATION_PROJECT_ANCHORS_INVALID");
  });
  it("supports an empty all-unbound graph only with its required captured contact", () => {
    const raw = input(); raw.agents = []; raw.links = []; raw.publishedAgentUids.clear(); raw.publishedBindings.clear(); raw.requiresContact = true;
    expect(prepareSnapshotPublicationProjectAnchors(raw)).toMatchObject({ contactVersion: 2, requiresContact: true, agents: [], bindings: [] });
  });
});
