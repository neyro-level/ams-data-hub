import { describe, expect, it } from "vitest";
import { resolveListingAgentBindings } from "../src/modules/project-state/application/listing-agent-matching.ts";
import { prepareSnapshotAgentBindings } from "../src/modules/snapshot-delivery/application/snapshot-agent-bindings.ts";
import type { SnapshotBuildInputReceipt } from "../src/modules/snapshot-delivery/application/snapshot-build-input.ts";
import type { SnapshotInventoryCapturedInput } from "../src/modules/snapshot-delivery/application/snapshot-inventory-input.ts";

const uid = "01J9ZK8G7Q5X6NP3V4A2B1C0DE"; const agentUid = "01J9ZK8G7Q5X6NP3V4A2B1C0DF";
const fact = { externalId: "one", inventoryUid: uid, recordHash: "a".repeat(64) };
describe("confirmed listing agent claims", () => {
  it("admits one resolved agent, deduplicates same agent and vetoes contradictory/unresolved claims", () => {
    const good = { agentUid, offerExternalIds: ["one"] };
    expect(resolveListingAgentBindings([fact], [good, good])).toEqual([{ inventoryUid: uid, recordHash: fact.recordHash, agentUid }]);
    for (const other of [null, "different-agent"]) expect(resolveListingAgentBindings([fact],
      [good, { agentUid: other, offerExternalIds: ["one"] }])).toEqual([]);
    expect(resolveListingAgentBindings([fact], [])).toEqual([]);
  });
  it("binds only exact captured facts and eligible agents, without live evidence", () => {
    const row = { entityType: "agent-binding", inventoryUid: uid, sourceId: "source", sourceRevisionId: "good",
      recordHash: fact.recordHash, agentUid };
    const receipt = (rows: unknown[]) => ({ parts: [{ kind: "listing-links", payload: rows }] }) as unknown as SnapshotBuildInputReceipt;
    const inventory = [{ pin: { uid, sourceId: "source", factRevisionId: "good", normalizedHash: fact.recordHash } }] as unknown as SnapshotInventoryCapturedInput[];
    expect(prepareSnapshotAgentBindings(receipt([row]), inventory, new Set([agentUid]))).toEqual(new Map([[uid, agentUid]]));
    expect(prepareSnapshotAgentBindings(receipt([row]), inventory, new Set())).toEqual(new Map());
    expect(prepareSnapshotAgentBindings(receipt([{ developmentUid: uid, status: "CONFIRMED" }]), inventory, new Set())).toEqual(new Map());
    for (const patch of [{ sourceId: "foreign" }, { sourceRevisionId: "other" }, { recordHash: "b".repeat(64) }, { phoneRaw: "private" }]) {
      expect(() => prepareSnapshotAgentBindings(receipt([{ ...row, ...patch }]), inventory, new Set([agentUid])))
        .toThrow("SNAPSHOT_AGENT_BINDING_INVALID");
    }
    expect(() => prepareSnapshotAgentBindings(receipt([row, row]), inventory, new Set([agentUid]))).toThrow("SNAPSHOT_AGENT_BINDING_INVALID");
  });
});
