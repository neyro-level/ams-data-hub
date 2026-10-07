import { describe, expect, it } from "vitest";
import { assertSnapshotProjectContact, snapshotRequiresProjectContact } from "../src/modules/snapshot-delivery/application/snapshot-project-contact.ts";
import type { SnapshotDatasetInput } from "../src/modules/snapshot-delivery/contracts.ts";

describe("captured listing fallback contact admission", () => {
  it.each([
    [[], [], false],
    [["one"], [], true],
    [["one"], [["one", "agent"]], false],
    [["one", "two"], [["one", "agent"]], true],
    [["one"], [["foreign", "agent"]], true],
  ] as const)("determines requirement from captured listings %j and eligible bindings %j", (uids, bindings, required) => {
    expect(snapshotRequiresProjectContact(uids, new Map(bindings))).toBe(required);
  });
  it("admits only the required project contact, without inventing fallback values", () => {
    const rows = (key: string): SnapshotDatasetInput[] => [{ kind: "project/contacts", records: [{ key, value: { phone: "+70000000077" } }] }];
    expect(() => assertSnapshotProjectContact(rows("project"), "project", true)).not.toThrow();
    expect(() => assertSnapshotProjectContact(rows("foreign"), "project", true)).toThrow("SNAPSHOT_PROJECT_CONTACT_REQUIRED");
    expect(() => assertSnapshotProjectContact([], "project", true)).toThrow("SNAPSHOT_PROJECT_CONTACT_REQUIRED");
    expect(() => assertSnapshotProjectContact([], "project", false)).not.toThrow();
  });
});
